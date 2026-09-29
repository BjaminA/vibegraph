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
// committed.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglotEnvelope } from "./regen_polyglot.mjs";
import { shouldSkipDir, languageForFile } from "../src/server/languages.ts";

const CACHE_VERSION = "1";
const HERE = fileURLToPath(import.meta.url);
const CONTEXT_FILE = /^(tsconfig.*\.json|jsconfig.*\.json|Cargo\.toml)$/;
const METHOD_ID = /^module\/[^/]+\.class\/[^/]+\.fn$/;

const sha1 = (s) => createHash("sha1").update(s).digest("hex");

export function cacheDirFor(absRoot, env = process.env) {
  const base = env.VG_CACHE_DIR
    ?? join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "vibegraph-knowledge", "envelopes");
  return join(base, sha1(absRoot).slice(0, 16));
}

/** Every file the pipeline's walk can see (the walk skips the same dirs). */
function walkAll(dir, root, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { if (!shouldSkipDir(entry.name)) walkAll(full, root, out); continue; }
    if (!entry.isFile()) continue;
    out.push({ rel: relative(root, full).split(sep).join("/"), full, name: entry.name });
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

function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
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

  // ── fingerprints (content, not mtime) ──
  const all = walkAll(absRoot, absRoot, []).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const sources = {};
  const ctxParts = [];
  for (const f of all) {
    if (CONTEXT_FILE.test(f.name)) ctxParts.push(`${f.rel}\n${readFileSync(f.full, "utf-8")}`);
    if (languageForFile(f.name, f.full)) sources[f.rel] = sha1(readFileSync(f.full));
  }
  const seedsPath = join(absRoot, ".vibegraph", "manual_seeds.json");
  if (existsSync(seedsPath)) ctxParts.push(`seeds\n${readFileSync(seedsPath, "utf-8")}`);
  const key = {
    tool: toolFingerprint(scriptsDir, opts.pipeline ?? {}),
    paths: sha1(all.map((f) => f.rel).join("\n")),
    ctx: sha1(ctxParts.join("\n\0\n")),
  };

  const meta = readJson(join(dir, "meta.json"));
  const sameGlobal = !!meta && meta.version === CACHE_VERSION
    && meta.key.tool === key.tool && meta.key.paths === key.paths && meta.key.ctx === key.ctx;
  const movedSources = sameGlobal
    ? Object.keys(sources).filter((f) => meta.sources[f] !== sources[f])
    : null;

  if (sameGlobal && movedSources.length === 0) {
    const cached = readJson(join(dir, "envelope.json"));
    if (cached) return { ...cached, cache: { mode: "hit", parsed: 0, extracted: 0, reason: "nothing moved" } };
  }

  // ── build, reusing what is still valid ──
  const parsedPrev = sameGlobal ? (readJson(join(dir, "parsed.json")) ?? {}) : {};
  const prevEnv = sameGlobal ? readJson(join(dir, "envelope.json")) : null;
  const parsedNext = {};
  let parsedCount = 0;
  const parseCache = {
    lookup(rel, langId) {
      const p = parsedPrev[rel];
      if (p && p.hash === sources[rel] && p.lang === langId) { parsedNext[rel] = p; return p.ir; }
      return null;
    },
    store(rel, langId, ir) { parsedCount += 1; parsedNext[rel] = { hash: sources[rel], lang: langId, ir }; },
  };

  let extractedCount = 0;
  let reason = !meta ? "cold: no cache yet" : !sameGlobal ? "full: the tool, the file set or a parse-context file changed" : `incremental: ${movedSources.length} file(s) changed`;
  const linkedHash = {};
  const globalSig = {};
  const threadCache = {
    select(seeds, files) {
      for (const [f, ir] of Object.entries(files)) { linkedHash[f] = sha1(JSON.stringify(ir)); globalSig[f] = globalSignature(ir); }
      const all = { toExtract: seeds, cached: new Map() };
      if (!prevEnv || !meta?.linkedHash) { extractedCount = seeds.length; return all; }
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
      const prev = new Map(prevEnv.envelope.threads.map((t) => [`${t.entryPointId}\u0000${t.seed?.file}`, t]));
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
  const result = {
    envelope: built.envelope, parseErrors: built.parseErrors, partialParses: built.partialParses ?? {}, skippedDirs: built.skippedDirs,
    unresolvedSeeds: built.unresolvedSeeds, languages: built.languages,
  };
  try {
    mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, "envelope.json"), JSON.stringify(result));
    writeAtomic(join(dir, "parsed.json"), JSON.stringify(parsedNext));
    writeAtomic(join(dir, "meta.json"), JSON.stringify({ version: CACHE_VERSION, root: absRoot, key, sources, linkedHash, globalSig }));
    pruneGone(dirname(dir));
  } catch (e) {
    reason += `; cache not written (${e?.message ?? e})`;
  }
  return { ...result, cache: { mode: meta ? (sameGlobal ? "incremental" : "full") : "cold", parsed: parsedCount, extracted: extractedCount, reason } };
}

