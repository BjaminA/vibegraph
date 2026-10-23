// The envelope cache (2026-09-28) — what makes `check` cheap enough to run
// after every edit. On a private production codebase (1,128 files) a full build is ~12 s of a
// 16.7 s `check`; a hook that paid that per edit would cost more than the
// orchestration it replaces. This keeps the answer IDENTICAL and pays only
// for what moved:
//
//   nothing moved   → the last envelope, read back.
//   files moved     → only those files re-parsed; link and discovery run in
//                     full (cheap, and they are whole-project by nature);
//                     only the threads that walk a file whose LINKED IR
//                     changed are re-extracted.
//   anything global → everything rebuilt: the tool itself, the set of paths
//                     (the TS parser probes for files, so a new file can
//                     change another file's parse), tsconfig / jsconfig /
//                     Cargo.toml, manual seeds, or a file's GLOBAL SIGNATURE.
//
// The global signature is the one subtle rule. extract_thread.py reads two
// things from every file, not only from the files a thread walks: the set of
// module paths, and every `Class.method` definition (resolve_project_method).
// So a changed file may leave every other thread alone only if neither moved;
// otherwise every thread is re-extracted. test:envelope-cache pins that the
// incremental envelope equals a full build byte for byte, including the case
// that needs this rule.
//
// Content hashes, not mtimes: an edit that keeps a file's size inside the
// same mtime tick must not read as "nothing moved". Hashing a private production codebase costs
// less than a tenth of a second.
//
// The system tier is NOT built here (it scans non-source files on its own
// walk): this serves check / affected / coverage / the hooks, which never read
// it. The cache lives outside the project, under ~/.cache, so it can never be
// committed. What is stored, and how an edit rewrites only what it changed, is
// scripts/envelope_store.mjs.

import { projectIgnore } from "../src/server/project_ignore.ts";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglotEnvelope } from "./regen_polyglot.mjs";
import { shouldSkipDir, mayBeSource } from "../src/server/languages.ts";
import { getBlob, pruneBlobs, putBlob, sha1, writeAtomic } from "./envelope_store.mjs";

// 2: one blob per parsed IR, linked IR and thread (envelope_store.mjs); a
// version-1 cache is rebuilt and its two whole-map files removed
// 3 (2026-10-22, RC2): the result carries the coverage ledger, and a `.js` or
// a page the walk admits by evidence is hashed like any source
const CACHE_VERSION = "3";
const LEGACY_FILES = ["envelope.json", "parsed.json"];
const HERE = fileURLToPath(import.meta.url);
// package.json too (2026-10-01): its `bin` and `scripts` make entry points.
// RC2 — and the run and deploy configs whose naming of a `.js` admits it
// (src/server/source_admission.ts RUN_CONFIGS); workflows are read below
const CONTEXT_FILE = /^(tsconfig.*\.json|jsconfig.*\.json|Cargo\.toml|package\.json|wrangler\.(toml|jsonc?)|Procfile|vercel\.json|netlify\.toml|fly\.toml|ecosystem\.config\.(c?js|json))$/;
const METHOD_ID = /^module\/[^/]+\.class\/[^/]+\.fn$/;

// cacheDirFor moved to cache_dir.mjs (the server's CommonJS bundle reads it
// without this module's pipeline); re-exported so every importer is unchanged.
export { cacheDirFor } from "./cache_dir.mjs";
import { cacheDirFor } from "./cache_dir.mjs";

/** Every file the pipeline's walk can see (the walk skips the same dirs). */
function walkAll(dir, root, out, ig = projectIgnore(root)) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join("/");
    if (entry.isDirectory()) { if (!shouldSkipDir(entry.name) && !ig.skipDir(rel)) walkAll(full, root, out, ig); continue; }
    if (!entry.isFile() || ig.skipFile(rel)) continue;
    out.push({ rel, full, name: entry.name });
  }
  return out;
}

/** The tool's own fingerprint: every script the pipeline runs, by size and
 *  mtime (a changed parser must never answer from an old parse). */
function toolFingerprint(scriptsDir, pipeline = {}) {
  // The interpreter is part of the tool: a parse by a Python that could not
  // load libcst is not the parse a working one gives.
  const py = pipeline.python ?? {};
  const parts = [CACHE_VERSION, process.version, pipeline.pythonBin ?? "python3", pipeline.pythonEnv?.PYTHONPATH ?? "", py.libcst ?? ""];
  const add = (p) => { try { const s = statSync(p); parts.push(`${p}:${s.size}:${s.mtimeMs}`); } catch { /* absent */ } };
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "__pycache__") walk(p); } else add(p);
    }
  };
  if (existsSync(scriptsDir)) walk(scriptsDir);
  add(HERE);
  const repo = dirname(dirname(HERE));
  for (const f of ["scripts/regen_polyglot.mjs", "src/server/languages.ts", "src/shared/languages.ts", "src/server/manual_seeds.ts"]) add(join(repo, f));
  return sha1(parts.join("\n"));
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

/** The stored envelope a manifest names, or null when any part is missing. */
function readStored(dir, meta) {
  try {
    const result = getBlob(dir, meta.shell);
    result.envelope.files = Object.fromEntries(Object.entries(meta.files).map(([f, name]) => [f, getBlob(dir, name)]));
    result.envelope.threads = meta.threads.map((name) => getBlob(dir, name));
    return result;
  } catch { return null; }
}

/** The previous threads, each remembered with its blob name (a reused thread
 *  is written again under the name it was read from). Null when unreadable. */
function readThreads(dir, meta, names) {
  try {
    return meta.threads.map((name) => { const t = getBlob(dir, name); names.set(t, name); return t; });
  } catch { return null; }
}

/** Drop the cache of any project that no longer exists (temp copies, test
 *  fixtures): an envelope can be tens of MB, and nothing else ever frees it. */
function pruneGone(base) {
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const meta = readJson(join(base, e.name, "meta.json"));
    if (meta?.root && !existsSync(meta.root)) rmSync(join(base, e.name), { recursive: true, force: true });
  }
}

/** What extract_thread.py reads from a file whatever thread is walking. */
function globalSignature(ir) {
  const methods = (ir?.nodes ?? []).filter((n) => METHOD_ID.test(n.id)).map((n) => n.id).sort();
  return sha1(`${ir?.modulePath ?? ""}\n${methods.join("\n")}`);
}

/**
 * The envelope for check / affected / coverage / hooks, from the cache when
 * nothing that decides it moved. Same return shape as buildPolyglotEnvelope
 * (without `system`), plus `cache: {mode, parsed, extracted, reason}`.
 */
export function buildEnvelopeCached(root, opts = {}) {
  const absRoot = resolve(root);
  const dir = opts.cacheDir ?? cacheDirFor(absRoot);
  const scriptsDir = opts.pipeline?.scriptsDir ?? dirname(HERE);
  // optional stage timings (ms): the cache's own reads, hashes and writes,
  // beside the pipeline's parse / link / discover / extract
  const timings = opts.timings ?? null;
  let tMark = Date.now();
  const lap = (name) => { if (timings) { const now = Date.now(); timings[`cache:${name}`] = (timings[`cache:${name}`] ?? 0) + now - tMark; tMark = now; } };

  // ── fingerprints (content, not mtime) ──
  const all = walkAll(absRoot, absRoot, []).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const sources = {};
  const ctxParts = [];
  for (const f of all) {
    if (CONTEXT_FILE.test(f.name)) ctxParts.push(`${f.rel}\n${readFileSync(f.full, "utf-8")}`);
    if (mayBeSource(f.name, f.full)) sources[f.rel] = sha1(readFileSync(f.full));
  }
  const workflows = join(absRoot, ".github", "workflows");
  if (existsSync(workflows)) for (const w of readdirSync(workflows).sort()) ctxParts.push(`workflow ${w}\n${readFileSync(join(workflows, w), "utf-8")}`);
  const seedsPath = join(absRoot, ".vibegraph", "manual_seeds.json");
  if (existsSync(seedsPath)) ctxParts.push(`seeds\n${readFileSync(seedsPath, "utf-8")}`);
  const key = {
    tool: toolFingerprint(scriptsDir, opts.pipeline ?? {}),
    paths: sha1(all.map((f) => f.rel).join("\n")),
    ctx: sha1(ctxParts.join("\n\0\n")),
  };

  lap("fingerprint");
  const meta = readJson(join(dir, "meta.json"));
  lap("read meta");
  const sameGlobal = !!meta && meta.version === CACHE_VERSION
    && meta.key.tool === key.tool && meta.key.paths === key.paths && meta.key.ctx === key.ctx;
  const movedSources = sameGlobal
    ? Object.keys(sources).filter((f) => meta.sources[f] !== sources[f])
    : null;

  if (sameGlobal && movedSources.length === 0) {
    const cached = readStored(dir, meta);
    lap("read envelope");
    if (cached) return { ...cached, cache: { mode: "hit", parsed: 0, extracted: 0, reason: "nothing moved" } };
  }

  // ── build, reusing what is still valid ──
  // A parse is read from its blob only when it is reused, the threads only
  // when select() can reuse some; a thread keeps the name it was read from, so
  // an unchanged one is never written again.
  const parsedPrev = sameGlobal ? (meta.parsed ?? {}) : {};
  const threadNames = new Map();
  const parsedNext = {};
  let parsedCount = 0;
  const parseCache = {
    lookup(rel, langId) {
      const p = parsedPrev[rel];
      if (!p || p.hash !== sources[rel] || p.lang !== langId) return null;
      let ir;
      try { ir = getBlob(dir, p.blob); } catch { return null; } // unreadable: parsed again
      parsedNext[rel] = { ...p, ir };
      return ir;
    },
    store(rel, langId, ir) { parsedCount += 1; parsedNext[rel] = { hash: sources[rel], lang: langId, ir }; },
  };

  let extractedCount = 0;
  let reason = !meta ? "cold: no cache yet" : !sameGlobal ? "full: the tool, the file set or a parse-context file changed" : `incremental: ${movedSources.length} file(s) changed`;
  const linkedHash = {};
  const globalSig = {};
  const threadCache = {
    select(seeds, files) {
      const t0 = Date.now();
      for (const [f, ir] of Object.entries(files)) { linkedHash[f] = sha1(JSON.stringify(ir)); globalSig[f] = globalSignature(ir); }
      if (timings) timings["cache:hash linked IR (inside extract)"] = Date.now() - t0;
      const all = { toExtract: seeds, cached: new Map() };
      if (!sameGlobal || !meta.linkedHash) { extractedCount = seeds.length; return all; }
      const changed = new Set();
      for (const f of new Set([...Object.keys(linkedHash), ...Object.keys(meta.linkedHash)])) {
        if (linkedHash[f] === meta.linkedHash[f]) continue;
        changed.add(f);
        // A module path or a Class.method that appeared, vanished or moved is
        // read by EVERY thread's extraction: nothing can be reused.
        if (globalSig[f] !== meta.globalSig?.[f]) {
          reason += `; ${f} changed a module path or a method definition, so every thread was re-extracted`;
          extractedCount = seeds.length;
          return all;
        }
      }
      const t1 = Date.now();
      const prevThreads = readThreads(dir, meta, threadNames);
      if (timings) timings["cache:read threads (inside extract)"] = Date.now() - t1;
      if (!prevThreads) {
        reason += "; the stored threads could not be read, so every thread was re-extracted";
        extractedCount = seeds.length;
        return all;
      }
      const prev = new Map(prevThreads.map((t) => [`${t.entryPointId}\u0000${t.seed?.file}`, t]));
      const cached = new Map();
      const toExtract = [];
      for (const s of seeds) {
        const k = `${s.entryPointId}\u0000${s.seedFile}`;
        const t = prev.get(k);
        if (t && t.seed?.irNodeId === s.seedId && !changed.has(s.seedFile) && !(t.filesReached ?? []).some((f) => changed.has(f))) cached.set(k, t);
        else toExtract.push(s);
      }
      extractedCount = toExtract.length;
      return { toExtract, cached };
    },
  };

  const built = buildPolyglotEnvelope(absRoot, { ...(opts.pipeline ?? {}), parseCache, threadCache, skipSystem: true, timings: opts.timings });
  tMark = Date.now();
  const result = {
    envelope: built.envelope, parseErrors: built.parseErrors, partialParses: built.partialParses ?? {}, skippedDirs: built.skippedDirs, ledger: built.ledger,
    unresolvedSeeds: built.unresolvedSeeds, languages: built.languages,
  };
  try {
    mkdirSync(dir, { recursive: true });
    // blobs first, the manifest last (envelope_store.mjs). What was read keeps
    // its name and is written again only if a concurrent run pruned it; a
    // linked file's name is the hash select() already took of its text.
    // Nothing touches the parses, the linked files or the reused threads
    // between where they were named and here.
    const parsed = {};
    for (const [rel, p] of Object.entries(parsedNext)) {
      parsed[rel] = { hash: p.hash, lang: p.lang, blob: putBlob(dir, () => JSON.stringify(p.ir), p.blob ?? null) };
    }
    const env = result.envelope;
    const files = {};
    for (const [f, ir] of Object.entries(env.files)) files[f] = putBlob(dir, () => JSON.stringify(ir), linkedHash[f] ?? null);
    const threads = env.threads.map((t) => putBlob(dir, () => JSON.stringify(t), threadNames.get(t) ?? null));
    const shell = putBlob(dir, JSON.stringify({ ...result, envelope: { ...env, files: null, threads: null } }));
    writeAtomic(join(dir, "meta.json"), JSON.stringify({ version: CACHE_VERSION, root: absRoot, key, sources, linkedHash, globalSig, parsed, files, threads, shell }));
    lap("write");
    pruneBlobs(dir, new Set([...Object.values(parsed).map((p) => p.blob), ...Object.values(files), ...threads, shell]));
    for (const f of LEGACY_FILES) rmSync(join(dir, f), { force: true });
    pruneGone(dirname(dir));
    lap("prune");
  } catch (e) {
    reason += `; cache not written (${e?.message ?? e})`;
  }
  return { ...result, cache: { mode: meta ? (sameGlobal ? "incremental" : "full") : "cold", parsed: parsedCount, extracted: extractedCount, reason } };
}

