// THE SERVER'S PIPELINE CACHE (2026-10-07, from `view` on a 58-file project:
// every start and every external save ran the WHOLE pipeline — all files
// re-parsed, every thread re-extracted, 24–41 s a pass — while another session
// edited four files). The CLI's envelope cache (scripts/envelope_cache.mjs)
// already paid only for what moved; this is the same rule for the server's
// async pipeline, kept in memory between passes and on disk between starts:
//
//   parse    a file whose CONTENT hash is unchanged reuses its parse; the
//            tool (the parser scripts, the interpreter), the set of paths
//            and the parse-context files (tsconfig / jsconfig / package.json
//            / Cargo.toml / manual seeds) changing parses everything again
//            (the TypeScript parser probes for files, so a new path can
//            change another file's parse).
//   threads  a thread whose seed file and every file it walks have the same
//            LINKED IR keeps its extraction — unless some file's module path
//            or Class.method set moved, which every extraction reads.
//
// Linking, discovery, the system tier and everything after them run in full:
// they are whole-project by nature and cheap beside parse + extraction.
// Content hashes, not mtimes or git: an uncommitted edit is exactly what the
// watcher reports. The cache lives under ~/.cache, never in the project.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const VERSION = 1;
const CONTEXT_FILE = /^(tsconfig.*\.json|jsconfig.*\.json|Cargo\.toml|package\.json)$/;
const METHOD_ID = /^module\/[^/]+\.class\/[^/]+\.fn$/;
const sha1 = (s: string | Buffer) => createHash("sha1").update(s).digest("hex");

type IR = { nodes?: Array<{ id: string }>; modulePath?: string; [k: string]: unknown };
type Thread = { entryPointId: string; seed?: { file?: string; irNodeId?: string }; filesReached?: string[]; [k: string]: unknown };
type Seed = { id: string; file: string; irNodeId: string };

interface Meta { version: number; root: string; key: { tool: string; paths: string; ctx: string }; sources: Record<string, string>; linkedHash?: Record<string, string>; globalSig?: Record<string, string> }

export function serverCacheDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = env.VG_CACHE_DIR ? path.join(env.VG_CACHE_DIR, "server")
    : path.join(env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "vibegraph-knowledge", "server");
  return path.join(base, sha1(path.resolve(root)).slice(0, 16));
}

const globalSignature = (ir: IR | undefined) =>
  sha1(`${ir?.modulePath ?? ""}\n${(ir?.nodes ?? []).filter((n) => METHOD_ID.test(n.id)).map((n) => n.id).sort().join("\n")}`);

export class PipelineCache {
  readonly root: string;
  readonly dir: string;
  private meta: Meta | null;
  private parsed: Record<string, { hash: string; ir: IR }>;
  private threads: Thread[] | null;
  private key: Meta["key"] = { tool: "", paths: "", ctx: "" };
  private sources: Record<string, string> = {};
  private linkedHash: Record<string, string> = {};
  private globalSig: Record<string, string> = {};
  private sameGlobal = false;

  private toolParts: string[];

  constructor(root: string, toolParts: string[], dir = serverCacheDir(root)) {
    this.toolParts = toolParts;
    this.root = root;
    this.dir = dir;
    this.meta = readJson(path.join(dir, "meta.json"));
    this.parsed = this.meta?.version === VERSION ? readJson(path.join(dir, "parsed.json")) ?? {} : {};
    this.threads = this.meta?.version === VERSION ? readJson(path.join(dir, "threads.json")) : null;
  }

  private rel(abs: string) { return path.relative(this.root, abs).split(path.sep).join("/"); }

  /** Which files must be parsed, and the parses that still hold (keyed as given). */
  beginParse(absFiles: string[], manualSeedsFile?: string): { reuse: Record<string, IR>; toParse: string[]; reason: string } {
    this.sources = {};
    for (const f of absFiles) { try { this.sources[this.rel(f)] = sha1(fs.readFileSync(f)); } catch { /* vanished: parsed again, and dropped */ } }
    const ctx: string[] = [];
    const dirs = new Set<string>();
    for (const f of absFiles) for (let d = path.dirname(f); d.startsWith(this.root); d = path.dirname(d)) { if (dirs.has(d)) break; dirs.add(d); if (d === this.root) break; }
    for (const d of [...dirs].sort()) {
      let names: string[] = [];
      try { names = fs.readdirSync(d).filter((n) => CONTEXT_FILE.test(n)).sort(); } catch { names = []; }
      for (const n of names) { try { ctx.push(`${this.rel(path.join(d, n))}\n${fs.readFileSync(path.join(d, n), "utf-8")}`); } catch { /* unreadable */ } }
    }
    if (manualSeedsFile) { try { ctx.push(`seeds\n${fs.readFileSync(manualSeedsFile, "utf-8")}`); } catch { /* none */ } }
    this.key = { tool: sha1(this.toolParts.join("\n")), paths: sha1(Object.keys(this.sources).sort().join("\n")), ctx: sha1(ctx.join("\n\0\n")) };
    const m = this.meta;
    this.sameGlobal = !!m && m.version === VERSION && m.key.tool === this.key.tool && m.key.paths === this.key.paths && m.key.ctx === this.key.ctx;
    const reuse: Record<string, IR> = {};
    const toParse: string[] = [];
    for (const f of absFiles) {
      const r = this.rel(f);
      const p = this.parsed[r];
      if (this.sameGlobal && p && p.hash === this.sources[r]) reuse[f] = structuredClone(p.ir);
      else toParse.push(f);
    }
    const reason = !m ? "cold: no cache yet" : !this.sameGlobal ? "full: the tool, the file set or a parse-context file changed" : `${toParse.length} of ${absFiles.length} file(s) changed`;
    return { reuse, toParse, reason };
  }

  /** Remember fresh parses (before linking — the linker adds edges in place). */
  storeParsed(fresh: Record<string, IR>): void {
    const keep: Record<string, { hash: string; ir: IR }> = {};
    for (const r of Object.keys(this.sources)) if (this.parsed[r]?.hash === this.sources[r]) keep[r] = this.parsed[r];
    for (const [f, ir] of Object.entries(fresh)) { const r = this.rel(f); if (this.sources[r]) keep[r] = { hash: this.sources[r], ir: structuredClone(ir) }; }
    this.parsed = keep;
  }

  /** Which seeds need extracting, given the LINKED, project-relative files. */
  selectThreads(relFiles: Record<string, IR>, seeds: Seed[]): { toExtract: Seed[]; cached: Map<string, Thread>; reason: string } {
    this.linkedHash = {};
    this.globalSig = {};
    for (const [f, ir] of Object.entries(relFiles)) { this.linkedHash[f] = sha1(JSON.stringify(ir)); this.globalSig[f] = globalSignature(ir); }
    const none = { toExtract: seeds, cached: new Map<string, Thread>() };
    const m = this.meta;
    if (!this.threads || !m?.linkedHash) return { ...none, reason: "every thread: none kept yet" };
    const changed = new Set<string>();
    for (const f of new Set([...Object.keys(this.linkedHash), ...Object.keys(m.linkedHash)])) {
      if (this.linkedHash[f] === m.linkedHash[f]) continue;
      changed.add(f);
      if (this.globalSig[f] !== m.globalSig?.[f]) return { ...none, reason: `every thread: ${f} changed a module path or a method definition` };
    }
    const prev = new Map(this.threads.map((t) => [`${t.entryPointId}\u0000${t.seed?.file}`, t]));
    const cached = new Map<string, Thread>();
    const toExtract: Seed[] = [];
    for (const s of seeds) {
      const t = prev.get(`${s.id}\u0000${s.file}`);
      if (t && t.seed?.irNodeId === s.irNodeId && !changed.has(s.file) && !(t.filesReached ?? []).some((f) => changed.has(f))) cached.set(s.id, t);
      else toExtract.push(s);
    }
    return { toExtract, cached, reason: `${toExtract.length} of ${seeds.length} thread(s) walk a changed file` };
  }

  /** The kept and the freshly extracted threads, in the seeds' order. */
  mergeThreads(seeds: Seed[], cached: Map<string, Thread>, fresh: Thread[]): Thread[] {
    const byId = new Map(fresh.map((t) => [t.entryPointId, t]));
    const out = seeds.map((s) => cached.get(s.id) ?? byId.get(s.id)).filter((t): t is Thread => !!t);
    this.threads = out;
    return out;
  }

  /** Persist (atomic writes); a failure only costs the next start its head start. */
  save(): void {
    this.meta = { version: VERSION, root: this.root, key: this.key, sources: this.sources, linkedHash: this.linkedHash, globalSig: this.globalSig };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      writeAtomic(path.join(this.dir, "parsed.json"), JSON.stringify(this.parsed));
      writeAtomic(path.join(this.dir, "threads.json"), JSON.stringify(this.threads ?? []));
      writeAtomic(path.join(this.dir, "meta.json"), JSON.stringify(this.meta));
    } catch { /* the cache is a convenience */ }
  }
}

/** The last project message the server sent, for the next start: a tab that
 *  connects while the boot pass runs is shown it at once, and the fresh one
 *  replaces it when the pass ends (the "re-linking…" pulse shows meanwhile). */
export function lastMessagePath(root: string): string { return path.join(serverCacheDir(root), "last-project-update.json"); }
export function readLastMessage(root: string): string | null {
  try { return fs.readFileSync(lastMessagePath(root), "utf-8"); } catch { return null; }
}
export function writeLastMessage(root: string, msg: string): void {
  const p = lastMessagePath(root);
  const tmp = `${p}.${process.pid}.tmp`;
  fs.promises.mkdir(path.dirname(p), { recursive: true })
    .then(() => fs.promises.writeFile(tmp, msg)).then(() => fs.promises.rename(tmp, p))
    .catch(() => { /* a convenience */ });
}

/** The tool's fingerprint: the parser scripts and frontends, the Node, the Python. */
export function toolParts(scriptsDir: string, extra: string[]): string[] {
  const parts = [`v${VERSION}`, process.version, ...extra];
  const walk = (d: string, depth = 0) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 4 && e.name !== "node_modules" && e.name !== "__pycache__") walk(p, depth + 1); continue; }
      if (!/\.(py|mjs|js|wasm)$/.test(e.name)) continue;
      try { const s = fs.statSync(p); parts.push(`${path.relative(scriptsDir, p)}:${s.size}:${s.mtimeMs}`); } catch { /* gone */ }
    }
  };
  walk(scriptsDir);
  return parts;
}

function readJson<T>(p: string): T | null { try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; } }
function writeAtomic(p: string, text: string) { const tmp = `${p}.${process.pid}.tmp`; fs.writeFileSync(tmp, text); fs.renameSync(tmp, p); }
