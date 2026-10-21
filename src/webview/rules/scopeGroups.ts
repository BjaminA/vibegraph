// What a rule's scope can be picked FROM, grouped (2026-10-19, PLAN-M-RULES
// M1). The form used to show every tool the stack index knows as one flat
// wall of grey chips — 100+ on a large project — with threads not offered at
// all and files typed by hand. Each group here is read from a fact the
// envelope already carries; a group with no facts is not drawn, and nothing
// is guessed. Pure and webview-safe.
//
//   Architecture  the map's processes (clusters) and the groups a person stated
//   Threads       entry points by kind and framework — routes, MCP tools, CLIs…
//   Scripts       shell / command / package scripts, and the folders they sit in
//   Protocols     tools a boundary leaves through, by role (HTTP, database, model…)
//   Code          the project's own funnel modules and its folders
//   Libraries     other third-party tools (frameworks, UI, parsing…) — folded
//   Runtime       the standard library and shell builtins — folded
//
// A chip adds to one of the three scope lists the server routes by
// (entryPointIds / files / stack), so a picked scope means exactly what the
// stored rule will mean; `reachOf` previews it with the server's predicate.

import type { KindId } from "../../shared/kinds.ts";
import type { ArchModelRecord, EntryPoint, StackIndexRecord, StackToolRecord } from "../../shared/protocol.ts";
import { scopeReaches, type RuleScope } from "../../shared/scope_route.ts";

export type ScopeGroupId = "architecture" | "threads" | "scripts" | "protocols" | "code" | "libraries" | "runtime";

export interface ScopeOption {
  /** unique across groups: `ep:<id>` · `files:<path>` · `stack:<tool>` · `arch:<node id>` */
  key: string;
  kind: KindId;
  label: string;
  /** hover text: what it is, and what picking it adds */
  title: string;
  adds: RuleScope;
  /** threads this option alone reaches */
  reaches: number;
}
export interface ScopeSubgroup { label: string; options: ScopeOption[] }
export interface ScopeGroup { id: ScopeGroupId; label: string; hint: string; folded: boolean; subgroups: ScopeSubgroup[]; count: number }

export interface ScopeInput {
  entryPoints: ReadonlyArray<Pick<EntryPoint, "id" | "kind" | "file" | "label" | "framework" | "irNodeId" | "metadata">>;
  threads: ReadonlyArray<{ entryPointId: string | null; filesReached: string[] }>;
  stack: Pick<StackIndexRecord, "tools" | "byThread"> | null;
  architecture?: Pick<ArchModelRecord, "nodes" | "groups"> | null;
  files?: readonly string[];
}

// tools a boundary can leave the project through, by role (ROLE_EFFECT's rows, plus the ones that cross without an effect)
const PROTOCOL_ROLES: Record<string, string> = {
  "http-client": "HTTP", "model-api": "Model APIs", platform: "Platform SDKs", "agent-protocol": "Agent protocol (MCP)",
  db: "Databases", cache: "Caches", queue: "Queues", cloud: "Cloud SDKs", remote: "Remote access", process: "Subprocesses", device: "Hardware I/O",
};
const LIBRARY_ROLES: Record<string, string> = {
  "web-framework": "Web frameworks", frontend: "Frontend", tensor: "Tensor programs", data: "Data and numerics", infra: "Infrastructure",
  test: "Testing", build: "Build", utility: "In-process libraries", unknown: "Unclassified",
};
const ROLE_KIND: Record<string, KindId> = { db: "store", cache: "store", queue: "external", "http-client": "external", "model-api": "external", platform: "external", "agent-protocol": "external", cloud: "external", remote: "external" };
const SCRIPT_FRAMEWORK = /^(shell|command|node|package-script|package-bin)$/;

const threadsReached = (scope: RuleScope, input: ScopeInput) => input.threads.filter((t) => scopeReaches(scope, {
  entryPointId: t.entryPointId, filesReached: t.filesReached, stack: t.entryPointId ? input.stack?.byThread?.[t.entryPointId] : undefined,
}));

/** The threads a scope reaches, by the rule the server routes by. */
export function reachOf(scope: RuleScope, input: ScopeInput): Array<{ entryPointId: string | null; filesReached: string[] }> {
  return threadsReached(scope, input);
}

const isScript = (e: ScopeInput["entryPoints"][number]) =>
  SCRIPT_FRAMEWORK.test(String(e.framework ?? "")) || /\.(sh|bash)$/.test(e.file) || (e.irNodeId === "module" && e.kind === "cli");

function epLabel(e: ScopeInput["entryPoints"][number]): string {
  const route = typeof e.metadata?.route === "string" ? e.metadata.route : null;
  if (route) return `${typeof e.metadata?.method === "string" ? `${e.metadata.method} ` : ""}${route}`;
  if (e.irNodeId === "module") return e.file.split("/").pop() ?? e.file;
  return e.label;
}

function threadSubgroup(e: ScopeInput["entryPoints"][number]): string {
  const fw = e.framework ? String(e.framework) : "";
  if (fw === "mcp") return "MCP tools";
  if (e.kind === "route") return fw ? `Routes · ${fw}` : "Routes";
  if (e.kind === "test") return "Tests";
  if (e.kind === "cli") return fw && fw !== "argparse" ? `Programs · ${fw}` : "Programs";
  if (e.kind === "model") return "Models";
  if (e.kind === "public_api") return "Public API";
  return "Named by hand";
}

/** "a/b/c.ts" → ["a/", "a/b/"] */
const foldersOf = (f: string) => { const p = f.split("/"); return p.slice(0, -1).map((_, i) => `${p.slice(0, i + 1).join("/")}/`); };
const shortTool = (t: StackToolRecord) => (t.home ? t.home.split("/").slice(-2).join("/") : t.tool.split(".").slice(-2).join("."));

function bySub(options: Array<ScopeOption & { sub: string }>): ScopeSubgroup[] {
  const m = new Map<string, ScopeOption[]>();
  for (const { sub, ...o } of options) (m.get(sub) ?? m.set(sub, []).get(sub)!).push(o);
  return [...m].map(([label, opts]) => ({ label, options: opts.sort((a, b) => b.reaches - a.reaches || a.label.localeCompare(b.label)) }))
    .sort((a, b) => b.options.length - a.options.length || a.label.localeCompare(b.label));
}

export function buildScopeGroups(input: ScopeInput): ScopeGroup[] {
  const reach = (adds: RuleScope) => threadsReached(adds, input).length;
  const groups: ScopeGroup[] = [];
  const push = (id: ScopeGroupId, label: string, hint: string, subgroups: ScopeSubgroup[], folded = false) => {
    const count = subgroups.reduce((n, s) => n + s.options.length, 0);
    if (count) groups.push({ id, label, hint, folded, subgroups, count });
  };
  const epIds = new Set(input.entryPoints.map((e) => e.id));

  // Architecture — the map's processes and the stated groups over them
  const arch = input.architecture;
  if (arch) {
    const clusters = arch.nodes.filter((n) => n.kind === "cluster" && n.entryPoints?.some((id) => epIds.has(id)));
    const opts: Array<ScopeOption & { sub: string }> = clusters.map((n) => {
      const adds = { entryPointIds: n.entryPoints!.filter((id) => epIds.has(id)) };
      return { sub: "Processes", key: `arch:${n.id}`, kind: "process", label: n.root ? `${n.label} · ${n.root}` : n.label, title: `the ${n.label} process${n.root ? ` under ${n.root}/` : ""}: its ${adds.entryPointIds.length} entry point(s)`, adds, reaches: reach(adds) };
    });
    const clusterEps = new Map(clusters.map((n) => [n.id, n.entryPoints!.filter((id) => epIds.has(id))]));
    for (const g of arch.groups ?? []) {
      if (g.source !== "stated") continue;
      const ids = [...new Set(g.wraps.flatMap((w) => clusterEps.get(w) ?? []))];
      if (!ids.length) continue;
      const adds = { entryPointIds: ids };
      opts.push({ sub: "Stated groups", key: `arch:${g.id}`, kind: "process", label: g.label, title: `the stated ${g.kind} "${g.label}": the entry points of the processes it holds`, adds, reaches: reach(adds) });
    }
    push("architecture", "Architecture", "a whole process or a group a person stated", bySub(opts));
  }

  // Threads and scripts — entry points
  const threadOpts: Array<ScopeOption & { sub: string }> = [];
  const scriptOpts: Array<ScopeOption & { sub: string }> = [];
  for (const e of input.entryPoints) {
    const adds = { entryPointIds: [e.id] };
    const o = { key: `ep:${e.id}`, kind: "process" as KindId, label: epLabel(e), title: `${e.id} — this thread only`, adds, reaches: reach(adds) };
    if (isScript(e)) scriptOpts.push({ ...o, sub: e.framework === "package-script" || e.framework === "package-bin" ? "Package scripts" : /\.(sh|bash)$/.test(e.file) || e.framework === "shell" ? "Shell scripts" : "Scripts run by another file" });
    else threadOpts.push({ ...o, sub: threadSubgroup(e) });
  }
  push("threads", "Threads", "one entry point and everything it reaches", bySub(threadOpts));
  // a folder that holds two or more scripts: "every script under ops/"
  const scriptFiles = input.entryPoints.filter(isScript).map((e) => e.file);
  const dirCount = new Map<string, number>();
  for (const f of scriptFiles) for (const d of foldersOf(f)) dirCount.set(d, (dirCount.get(d) ?? 0) + 1);
  for (const [d, n] of dirCount) {
    if (n < 2) continue;
    const adds = { files: [d] };
    scriptOpts.push({ sub: "Script folders", key: `files:${d}`, kind: "path", label: d, title: `every file under ${d} (${n} scripts)`, adds, reaches: reach(adds) });
  }
  push("scripts", "Scripts", "scripts, one at a time or by folder", bySub(scriptOpts));

  // Tools: protocols, the project's own funnels, libraries, runtime
  const proto: Array<ScopeOption & { sub: string }> = [], code: Array<ScopeOption & { sub: string }> = [];
  const libs: Array<ScopeOption & { sub: string }> = [], runtime: Array<ScopeOption & { sub: string }> = [];
  for (const t of input.stack?.tools ?? []) {
    if (t.roleSource === "stated" && t.role === "unknown") continue;
    const adds = { stack: [t.tool] };
    const base = { key: `stack:${t.tool}`, adds, reaches: reach(adds) };
    const used = `${t.threads.length} thread(s) reach a file using it${t.calledOn?.length ? `, ${t.calledOn.length} leave through it` : ""}`;
    if (t.origin === "project") {
      code.push({ ...base, sub: "Project modules (funnels)", kind: "module", label: shortTool(t), title: `${t.tool} — the project's own module${t.wraps?.length ? ` wrapping ${t.wraps.join(", ")}` : ""}; ${used}` });
    } else if (PROTOCOL_ROLES[t.role]) {
      // role before origin: sqlite3 and fetch ship with the language and are still a database and an HTTP client
      proto.push({ ...base, sub: PROTOCOL_ROLES[t.role], kind: ROLE_KIND[t.role] ?? "module", label: t.tool, title: `${t.tool} — ${t.role}${t.origin === "stdlib" ? ", standard library" : ""}; ${used}` });
    } else if (t.origin === "stdlib" || t.role === "runtime") {
      runtime.push({ ...base, sub: "Standard library and builtins", kind: "module", label: t.tool, title: `${t.tool} — standard library; ${used}` });
    } else {
      libs.push({ ...base, sub: LIBRARY_ROLES[t.role] ?? t.role, kind: "module", label: t.tool, title: `${t.tool} — ${t.role}; ${used}` });
    }
  }
  push("protocols", "Protocols", "every thread that uses the tool — follows the code as it changes", bySub(proto));
  // the project's folders: top level, and second level under a large one
  const files = input.files ?? [];
  const folderFiles = new Map<string, number>();
  for (const f of files) for (const d of foldersOf(f)) folderFiles.set(d, (folderFiles.get(d) ?? 0) + 1);
  for (const [d, n] of folderFiles) {
    const depth = d.split("/").length - 1;
    const parent = depth === 2 ? `${d.split("/")[0]}/` : null;
    if (depth > 2 || n < 2 || (parent && (folderFiles.get(parent) ?? 0) < 30)) continue;
    const adds = { files: [d] };
    code.push({ sub: depth === 1 ? "Folders" : "Sub-folders", key: `files:${d}`, kind: "path", label: d, title: `every file under ${d} (${n} parsed)`, adds, reaches: reach(adds) });
  }
  push("code", "Code", "the project's own modules and folders", bySub(code));
  push("libraries", "Libraries", "other third-party tools, by role", bySub(libs), true);
  push("runtime", "Runtime", "standard library and shell builtins — rarely a rule's scope", bySub(runtime), true);
  return groups;
}

/** The scope the picked options add up to (each list de-duplicated, order kept). */
export function scopeOfPicked(options: ReadonlyArray<ScopeOption>): RuleScope {
  const out: RuleScope = {};
  for (const o of options) {
    for (const k of ["entryPointIds", "files", "stack"] as const) {
      const v = o.adds[k];
      if (v?.length) out[k] = [...new Set([...(out[k] ?? []), ...v])];
    }
  }
  return out;
}
