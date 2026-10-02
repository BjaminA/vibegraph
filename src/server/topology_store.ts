// The DECLARED TOPOLOGY on disk (2026-10-02). `.vibegraph/topology/`:
//
//   sources.json      the registered generators: id, command, inputs
//   <id>.json         a generator's last output, validated, with the hash of
//                     its inputs at the time it ran
//
// A generator is a command the PROJECT owns (it reads its own catalogue
// arrays, transition tables, principals file) and prints the topology JSON on
// stdout. It runs only when a person asks (`topology run`, `export`) — never
// from a hook, never on parse. Staleness is a content hash of the inputs, so
// it works with or without git, and an output whose inputs changed is still
// READ (marked stale) rather than dropped: a stale map beats none, said as one.

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import type { Topology, TopologyModel, TopologySource, TopologyStatus } from "../shared/topology_types.ts";
import { TOPOLOGY_VERSION } from "../shared/topology_types.ts";
import { pathAllowed } from "../shared/path_match.ts";

export const TOPOLOGY_DIR = path.join(".vibegraph", "topology");
const SOURCES = path.join(TOPOLOGY_DIR, "sources.json");
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".vibegraph", "target", "__pycache__", ".venv", "venv"]);

const str = (x: unknown) => typeof x === "string" && x.length > 0 && x.length <= 400;
const strs = (x: unknown, max = 200) => Array.isArray(x) && x.length <= max && x.every(str);
const opt = (x: unknown, ok: (v: unknown) => boolean) => x === undefined || ok(x);
const CITE = /^[^\s:][^:]*:\d+$/;

/** null when the generator's output is a valid topology, else the reason. */
export function validateTopology(x: unknown): string | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return "the topology must be a JSON object";
  const t = x as Record<string, any>;
  if (t.version !== TOPOLOGY_VERSION) return `version must be "${TOPOLOGY_VERSION}"`;
  const items: Array<[string, (o: any) => string | null]> = [
    ["stores", (o) => (str(o.id) ? null : "id")],
    ["zones", (o) => (str(o.id) && str(o.store) && opt(o.holds, strs) ? null : "id, store and holds (a list)")],
    ["families", (o) => (str(o.id) && opt(o.zone, str) && opt(o.pattern, str) ? null : "id (zone, pattern optional)")],
    ["principals", (o) => (str(o.id) && opt(o.roles, strs) ? null : "id (roles a list)")],
    ["grants", (o) => (str(o.who) && str(o.zone) && (o.access === "read" || o.access === "write") ? null : "who, zone and access read|write")],
    ["routers", (o) => (str(o.function) && opt(o.zones, strs) && opt(o.file, str) ? null : "function (zones a list)")],
    ["stateMachines", (o) => (str(o.id) && Array.isArray(o.transitions) && o.transitions.every((tr: any) => str(tr?.from) && str(tr?.to) && opt(tr.roles, strs) && opt(tr.requires, strs)) ? null : "id and transitions [{from, to, roles?, requires?}]")],
    ["decisionTrees", (o) => (str(o.id) && str(o.root) && Array.isArray(o.nodes) && o.nodes.every((n: any) => str(n?.id) && opt(n.reads, strs) && opt(n.yes, str) && opt(n.no, str)) ? null : "id, root and nodes [{id, yes?, no?, outcome?, reads?}]")],
  ];
  for (const [k, check] of items) {
    if (t[k] === undefined) continue;
    if (!Array.isArray(t[k]) || t[k].length > 2000) return `${k} must be a list (at most 2000)`;
    for (const [i, o] of (t[k] as any[]).entries()) {
      if (!o || typeof o !== "object") return `${k}[${i}] must be an object`;
      const bad = check(o);
      if (bad) return `${k}[${i}] needs ${bad}`;
      if (o.cite !== undefined && !(typeof o.cite === "string" && CITE.test(o.cite))) return `${k}[${i}].cite must be file:line`;
    }
  }
  // Cross-references a reader relies on.
  const stores = new Set((t.stores ?? []).map((s: any) => s.id));
  const zones = new Set((t.zones ?? []).map((z: any) => z.id));
  for (const z of t.zones ?? []) if (stores.size && !stores.has(z.store)) return `zone ${z.id}: store "${z.store}" is not declared`;
  for (const g of t.grants ?? []) if (!zones.has(g.zone) && !String(g.zone).includes("*")) return `grant ${g.who} → ${g.zone}: zone not declared (a pattern needs a *)`;
  for (const d of t.decisionTrees ?? []) {
    const ids = new Set(d.nodes.map((n: any) => n.id));
    if (!ids.has(d.root)) return `decision tree ${d.id}: root "${d.root}" is not one of its nodes`;
    for (const n of d.nodes) for (const k of ["yes", "no"]) if (n[k] && !ids.has(n[k])) return `decision tree ${d.id}: node ${n.id}.${k} → "${n[k]}" is not one of its nodes`;
  }
  return null;
}

export function validateSource(x: unknown): string | null {
  const s = x as Record<string, unknown>;
  if (!s || typeof s !== "object") return "a source must be an object";
  if (typeof s.id !== "string" || !ID_RE.test(s.id) || s.id === "sources" || s.id === "live") return "id must be a short lower-case name (not `sources` or `live`)";
  if (!str(s.generator)) return "generator must be the command that prints the topology JSON";
  if (!strs(s.inputs, 20) || !(s.inputs as string[]).length || (s.inputs as string[]).some((i) => i.includes(".."))) return "inputs must list 1–20 files, folders (trailing /) or globs inside the project";
  return null;
}

export function loadSources(root: string): TopologySource[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, SOURCES), "utf-8"));
    return (Array.isArray(raw?.sources) ? raw.sources : []).filter((s: unknown) => validateSource(s) === null);
  } catch { return []; }
}

export function saveSources(root: string, sources: TopologySource[]): void {
  const file = path.join(root, SOURCES);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: "1", sources }, null, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
}

/** The project files a source's inputs name, sorted (posix, relative). */
export function inputFiles(root: string, inputs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), r); }
      else if (pathAllowed(r, inputs) || inputs.some((i) => i.replace(/\/$/, "") === r)) out.push(r);
    }
  };
  walk(root, "");
  return out.sort();
}

export function inputsHash(root: string, inputs: string[]): { hash: string; files: number } {
  const h = crypto.createHash("sha256");
  const files = inputFiles(root, inputs);
  for (const f of files) { h.update(f); h.update("\0"); h.update(fs.readFileSync(path.join(root, f))); h.update("\0"); }
  return { hash: h.digest("hex").slice(0, 16), files: files.length };
}

interface Output { generatedAt: string; inputsHash: string; topology: Topology; error?: string }

const outPath = (root: string, id: string) => path.join(root, TOPOLOGY_DIR, `${id}.json`);
function readOutput(root: string, id: string): Output | null {
  try { return JSON.parse(fs.readFileSync(outPath(root, id), "utf-8")); } catch { return null; }
}

/** Run one generator in the project root and store what it printed — when it
 *  is a valid topology. A failure is recorded, and the last good output kept. */
export function runSource(root: string, s: TopologySource, now: Date = new Date()): { ok: boolean; detail: string } {
  const r = spawnSync(s.generator, { cwd: root, shell: true, encoding: "utf-8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  if (r.error || r.status !== 0) return { ok: false, detail: `the generator failed (${r.error?.message ?? `exit ${r.status}`}): ${String(r.stderr ?? "").trim().slice(0, 400)}` };
  let parsed: unknown;
  try { parsed = JSON.parse(String(r.stdout)); } catch (e: any) { return { ok: false, detail: `the generator's output is not JSON: ${e.message}` }; }
  const bad = validateTopology(parsed);
  if (bad) return { ok: false, detail: `the generator's output is not a valid topology: ${bad}` };
  const out: Output = { generatedAt: now.toISOString(), inputsHash: inputsHash(root, s.inputs).hash, topology: parsed as Topology };
  fs.mkdirSync(path.join(root, TOPOLOGY_DIR), { recursive: true });
  fs.writeFileSync(outPath(root, s.id), JSON.stringify(out, null, 2) + "\n");
  const t = parsed as Topology;
  return { ok: true, detail: `${(t.zones ?? []).length} zone(s), ${(t.principals ?? []).length} principal(s), ${(t.grants ?? []).length} grant(s), ${(t.stateMachines ?? []).length + (t.decisionTrees ?? []).length} decision structure(s)` };
}

export function sourceStatus(root: string, s: TopologySource): TopologyStatus {
  const out = readOutput(root, s.id);
  if (!out) return { source: s, state: "never-run", detail: `not generated yet — vibegraph-knowledge topology run ${s.id}` };
  const now = inputsHash(root, s.inputs);
  if (!now.files) return { source: s, state: "stale", generatedAt: out.generatedAt, detail: `its inputs (${s.inputs.join(", ")}) match no file now` };
  return now.hash === out.inputsHash
    ? { source: s, state: "fresh", generatedAt: out.generatedAt, detail: `generated ${out.generatedAt.slice(0, 16)}; inputs unchanged since` }
    : { source: s, state: "stale", generatedAt: out.generatedAt, detail: `inputs changed since it was generated (${out.generatedAt.slice(0, 16)}) — re-run: vibegraph-knowledge topology run ${s.id}` };
}

/** The derived layer as a source (data_arch.ts): never run, never stale — it is the code as parsed. */
export const DERIVED_SOURCE: TopologySource = { id: "derived-from-code", generator: "(VibeGraph reads the code)", inputs: [] };

const KEYS = ["stores", "zones", "families", "principals", "grants", "routers", "stateMachines", "decisionTrees"] as const;
const keyOf = (k: string, o: any) => (k === "grants" ? `${o.who}|${o.zone}|${o.access}` : k === "routers" ? o.function : o.id);

/** Every generated source, merged. Two sources declaring one id differently
 *  is a conflict, said — the first is kept. */
export function loadTopology(root: string, derived?: Topology): TopologyModel {
  const status = loadSources(root).map((s) => sourceStatus(root, s));
  const topology: Topology = { version: TOPOLOGY_VERSION };
  const conflicts: string[] = [];
  const seen = new Map<string, { src: string; json: string }>();
  // 2026-10-02 — the topology DERIVED from the code (data_arch.ts) is one more
  // source, read LAST: a project's own generator declares, and wins wherever
  // both speak; the derived layer fills what no generator says.
  const outputs: Array<{ id: string; topology: Topology | undefined }> = status.map((st) => ({ id: st.source.id, topology: readOutput(root, st.source.id)?.topology }));
  const hasDerived = derived && KEYS.some((k) => ((derived as any)[k] ?? []).length);
  if (hasDerived) {
    outputs.push({ id: DERIVED_SOURCE.id, topology: derived });
    status.push({ source: DERIVED_SOURCE, state: "fresh", detail: "read from the code's literal tables, names and calls by VibeGraph (data-architecture.md)" });
  }
  for (const out of outputs) {
    if (!out.topology) continue;
    const st = { source: { id: out.id } };
    for (const k of KEYS) for (const item of (out.topology as any)[k] ?? []) {
      const key = `${k}:${keyOf(k, item)}`;
      const json = JSON.stringify({ ...item, cite: undefined });
      const was = seen.get(key);
      // a generator's word stands over the derived reading, without a conflict
      if (was) { if (was.json !== json && st.source.id !== DERIVED_SOURCE.id) conflicts.push(`${k} ${keyOf(k, item)}: ${was.src} and ${st.source.id} declare it differently — ${was.src}'s is used`); continue; }
      seen.set(key, { src: st.source.id, json });
      ((topology as any)[k] ??= []).push(item);
    }
  }
  return { topology, status, conflicts };
}

/** Re-run every source whose inputs changed (or that never ran). */
export function refreshTopology(root: string): string[] {
  const lines: string[] = [];
  for (const s of loadSources(root)) {
    const st = sourceStatus(root, s);
    if (st.state === "fresh") continue;
    const r = runSource(root, s);
    lines.push(`${s.id}: ${r.ok ? `regenerated — ${r.detail}` : r.detail}`);
  }
  return lines;
}
