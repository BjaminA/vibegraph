// FILE STORES on the architecture map (2026-09-24): a directory that several
// processes share through the filesystem — a private production codebase's `output_cache/`, which
// the dispatcher's scripts write and the MCP tools and the web app read.
// Archify's agent drew it by reading; the stack index cannot, because a
// directory is not a package. It is found here from facts alone:
//
//   1. a PATH VARIABLE: an environment variable bound to a directory — a
//      `.env.example` line (`CACHE_ROOT=./output_cache`, read by
//      infra_manifests.ts) or an UPPER_CASE assignment in the code whose
//      value ends in a path segment (`export CACHE_ROOT="${ROOT}/output_cache"`);
//   2. its USERS: every file whose IR reads the variable (`process.env.X`,
//      `$X`, `os.environ["X"]`, `getenv("X")`) or spells `…/<dir>` after a
//      variable;
//   3. a store only when files in TWO OR MORE clusters use it — a directory
//      one process keeps to itself is its own business, not architecture.
//
// Category: `cache` when the authors named it one (the directory or a
// variable says "cache"), else `storage`. The name is theirs; the reading
// is stated on the node. Excluded: system directories, directories that
// hold parsed source (they are code, not a store), names with a file
// extension.

import type { ArchEdgeRecord, ArchModelRecord, ArchNodeRecord, ArchRef } from "../shared/protocol.ts";
import type { InfraFact } from "./infra_manifests.ts";

const SYSTEM_DIRS = new Set(["tmp", "home", "opt", "dev", "usr", "var", "etc", "proc", "sys", "root", "mnt", "bin", "lib", "srv", "run", "Users", "Library"]);
const MAX_REFS = 8;

interface StoreInputs {
  files: Record<string, { nodes?: Array<Record<string, unknown>> }>;
  infra: InfraFact[];
  threads: Array<{ entryPointId?: string | null; filesReached?: string[] }>;
  model: ArchModelRecord;
}

/** The strings an IR node carries: its preview, args, literals and names. */
function textsOf(n: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ["preview", "callTarget", "value"]) if (typeof n[k] === "string") out.push(n[k] as string);
  for (const k of ["args", "literals"]) {
    const v = n[k];
    if (Array.isArray(v)) for (const x of v) out.push(typeof x === "string" ? x : JSON.stringify(x));
  }
  return out;
}

/** The last directory segment of a path-shaped value, or null. */
export function dirOfPathValue(v: string): string | null {
  const s = v.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  if (!s || /\s/.test(s) || /^[a-z]+:\/\//i.test(s) || /^\d+$/.test(s)) return null;
  // Expansions are variables (`${ROOT}`, `$HOME`, `${X:-/dev/null}`): drop
  // them, then anything left that is not path characters is not a path —
  // a regex literal (`/…/i`), a call, a quoted concatenation. a private production codebase's
  // first run read `ENTITY_RE = /…/i` as a directory named `i`.
  const bare = s.replace(/\$\{[^}]*\}/g, "V").replace(/\$[A-Za-z_]\w*/g, "V");
  if (/[\\[\](){}^*+?|<>=,;`"'!&]/.test(bare)) return null;
  // An absolute path under a system root (`/dev/null`, `/tmp/x`) is the
  // machine's, never the project's store.
  if (bare.startsWith("/") && SYSTEM_DIRS.has(bare.split("/")[1] ?? "")) return null;
  const seg = bare.slice(bare.lastIndexOf("/") + 1);
  if (seg.length < 3 || !/^[A-Za-z_][\w.-]*$/.test(seg) || /\.[A-Za-z0-9]{1,5}$/.test(seg)) return null;
  // A bare word is a directory only when it was written as a path (`./x`,
  // `a/x`) or the key says so; the caller passes keys it trusts.
  return seg;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function deriveFileStores(input: StoreInputs): { nodes: ArchNodeRecord[]; edges: ArchEdgeRecord[]; notes: string[] } {
  const codeDirs = new Set<string>();
  for (const f of Object.keys(input.files)) for (const seg of f.split("/").slice(0, -1)) codeDirs.add(seg);
  const okDir = (d: string | null): d is string => !!d && !SYSTEM_DIRS.has(d) && !codeDirs.has(d);

  // 1. path variables → directory, with the evidence that binds them
  const dirOfVar = new Map<string, { dir: string; refs: ArchRef[] }>();
  const bind = (name: string, dir: string, ref: ArchRef) => {
    const cur = dirOfVar.get(name);
    if (cur && cur.dir !== dir) return; // two directories for one name: keep the first, never merge
    if (!cur) dirOfVar.set(name, { dir, refs: [ref] });
    else if (cur.refs.length < MAX_REFS) cur.refs.push(ref);
  };
  for (const f of input.infra) {
    if (f.kind !== "env" || !f.detail) continue;
    const d = dirOfPathValue(f.detail);
    if (okDir(d)) bind(f.name, d, { file: f.file, text: `line ${f.line}: ${f.name}=${f.detail}` });
  }
  for (const [file, ir] of Object.entries(input.files)) {
    for (const n of ir.nodes ?? []) {
      if (n.type !== "assignment" || typeof n.name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(n.name)) continue;
      const v = typeof n.preview === "string" ? n.preview : "";
      if (!v.includes("/")) continue; // an assignment is a path only when it is spelled as one
      const d = dirOfPathValue(v);
      if (okDir(d)) bind(n.name, d, { file, nodeId: n.id as string, text: `${n.name}=${v}`.slice(0, 160) });
    }
  }
  if (!dirOfVar.size) return { nodes: [], edges: [], notes: [] };

  // 2. users: files that read a variable, or spell `…/<dir>` after one
  const byDir = new Map<string, { vars: Set<string>; files: Map<string, ArchRef> }>();
  const note = (dir: string, v: string | null, file: string, ref: ArchRef) => {
    let s = byDir.get(dir);
    if (!s) byDir.set(dir, s = { vars: new Set(), files: new Map() });
    if (v) s.vars.add(v);
    if (!s.files.has(file)) s.files.set(file, ref);
  };
  const readers = [...dirOfVar].map(([name, b]) => ({
    name, dir: b.dir,
    re: new RegExp(`process\\.env\\.${esc(name)}\\b|process\\.env\\[["']${esc(name)}["']\\]|\\$\\{?${esc(name)}\\b|environ(?:\\.get)?\\(?\\[?["']${esc(name)}["']|getenv\\(["']${esc(name)}["']`),
  }));
  const dirs = [...new Set([...dirOfVar.values()].map((b) => b.dir))];
  const afterVar = dirs.map((d) => ({ dir: d, re: new RegExp(`(?:\\$\\{?\\w+\\}?|\\$\\{[^}]+\\}|\\))/${esc(d)}\\b`) }));
  for (const [file, ir] of Object.entries(input.files)) {
    for (const n of ir.nodes ?? []) {
      const texts = textsOf(n);
      if (!texts.length) continue;
      const joined = texts.join("\n");
      const ref = (t: string): ArchRef => ({ file, nodeId: n.id as string, text: t.slice(0, 160) });
      for (const r of readers) if (r.re.test(joined)) note(r.dir, r.name, file, ref(texts.find((t) => r.re.test(t)) ?? joined));
      for (const a of afterVar) if (a.re.test(joined)) note(a.dir, null, file, ref(texts.find((t) => a.re.test(t)) ?? joined));
    }
  }

  // 3. which clusters use it: the clusters whose threads reach the file
  const clustersOfFile = new Map<string, Set<string>>();
  const threadFiles = new Map(input.threads.filter((t) => t.entryPointId).map((t) => [t.entryPointId as string, t.filesReached ?? []]));
  for (const c of input.model.nodes) {
    if (c.kind !== "cluster") continue;
    for (const ep of c.threads) for (const f of threadFiles.get(ep) ?? []) {
      if (!clustersOfFile.has(f)) clustersOfFile.set(f, new Set());
      clustersOfFile.get(f)!.add(c.id);
    }
  }
  // A dispatcher's own file speaks for the dispatcher, not its whole cluster.
  for (const h of input.model.nodes) {
    const f = h.kind === "hub" ? h.refs[0]?.file : undefined;
    if (f) clustersOfFile.set(f, new Set([h.id]));
  }

  const nodes: ArchNodeRecord[] = [];
  const edges: ArchEdgeRecord[] = [];
  const notes: string[] = [];
  for (const [dir, s] of [...byDir].sort((a, b) => a[0].localeCompare(b[0]))) {
    const perCluster = new Map<string, ArchRef[]>();
    let unreached = 0;
    for (const [file, ref] of s.files) {
      const cs = clustersOfFile.get(file);
      if (!cs?.size) { unreached++; continue; }
      for (const c of cs) perCluster.set(c, [...(perCluster.get(c) ?? []), ref]);
    }
    if (perCluster.size < 2) continue;
    const vars = [...new Set([...s.vars, ...[...dirOfVar].filter(([, b]) => b.dir === dir).map(([n]) => n)])].sort();
    const isCache = /cache/i.test(dir) || vars.some((v) => /cache/i.test(v));
    const id = `tool:${dir}/`;
    const bindings = [...dirOfVar].filter(([, b]) => b.dir === dir).flatMap(([, b]) => b.refs);
    nodes.push({
      id, kind: "tool", label: `${dir}/`,
      sublabel: `${isCache ? "file cache" : "file store"} · ${vars.join(", ")}`,
      category: isCache ? "cache" : "storage", source: "derived",
      tool: `${dir}/`, role: "fs", origin: "project",
      threads: [], refs: bindings.slice(0, MAX_REFS),
      notes: [
        `A directory ${perCluster.size} processes share through the filesystem, bound by ${vars.join(", ")}.`,
        isCache ? "Classified a cache by its own name (the directory or a variable says so)." : "No name calls it a cache; drawn as a file store.",
        ...(unreached ? [`${unreached} file(s) that use it are on no cluster's thread and are not drawn.`] : []),
      ],
    });
    for (const [cid, refs] of [...perCluster].sort((a, b) => a[0].localeCompare(b[0]))) {
      edges.push({
        id: `${cid}->${id}:uses:files`, from: cid, to: id, kind: "uses", protocol: "files",
        protocolBasis: `the code reads ${vars.join(" / ")}, which ${bindings.length ? `is bound to ${dir}/ (${bindings[0].file}${bindings[0].text ? `: ${bindings[0].text}` : ""})` : `names ${dir}/`}`,
        count: refs.length, threads: [], confidence: "called", refs: refs.slice(0, MAX_REFS), source: "derived",
      });
    }
    notes.push(`${dir}/ is a file store ${perCluster.size} clusters share (${vars.join(", ")}).`);
  }
  return { nodes, edges, notes };
}
