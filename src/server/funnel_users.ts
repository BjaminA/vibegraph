// Which importers of a funnel USE what it wraps (2026-10-20, the live setup
// run on a public Next.js app). A funnel module is often also the project's
// grab-bag: that app's `lib/utils.ts` exports `cn()` (class names) to 52
// files and `fetcher` (the fetch wrapper) to a handful, and counting every
// importer as a user of the wrapped tool made the direction census propose
// "Reach fetch through lib.utils — 52 files use fetch through lib/utils.ts".
// Importing a module is not using what one of its functions wraps.
//
// Zero tokens, IR only. A top-level binding of the funnel file WRAPS the
// tool when its body uses it: a call site the stack index keyed (`fetch`),
// or a call through the file's own import of the tool (`drizzle(client)`),
// or a call to another binding that already wraps it (`db.select()` after
// `const db = drizzle(client)`) — to a fixpoint. An importer USES the
// funnel's tool when it imports one of those bindings by name, or a
// reference edge (the linker's resolved call) lands inside one. A namespace
// import with no such edge says nothing either way and is not counted: the
// count is a claim, so it errs short.

export interface FunnelIrNode {
  id?: string;
  type?: string;
  parentId?: string | null;
  name?: unknown;
  names?: unknown;
  funcName?: unknown;
  callTarget?: unknown;
  args?: unknown;
  isDefaultExport?: unknown;
}

export interface FunnelImporter {
  file: string;
  /** the import nodes in this file that resolve to the funnel */
  imports: FunnelIrNode[];
  /** reference-edge targets (node ids in the funnel file) */
  refTargets: string[];
}

const topOf = (id: string) => id.split("/").slice(0, 2).join("/");

/** The local name an import entry binds: `x as y` → y, `default as X` → X,
 *  `* as ns` → ns, `type T` → T; Python `import a.b` binds `a`. */
export function boundName(entry: string): string {
  const e = entry.replace(/^type\s+/, "").trim();
  const as = /\s+as\s+(\S+)$/.exec(e);
  return as ? as[1] : e.split(".")[0];
}

/** The name an import entry asks the target module for: `x as y` → x. */
export function exportedName(entry: string): string {
  return entry.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
}

const calleeHead = (n: FunnelIrNode): string => {
  const c = typeof n.funcName === "string" ? n.funcName : typeof n.callTarget === "string" ? n.callTarget : "";
  return c.replace(/^(new|await)\s+/, "").split(/[.(<?[\s]/)[0];
};
// A wrapper passed as a VALUE is still used: `Artifact = memo(PureArtifact)`,
// `useSWR(key, fetcher)`. Only a bare identifier argument counts.
const argNames = (n: FunnelIrNode): string[] =>
  Array.isArray(n.args) ? n.args.filter((a): a is string => typeof a === "string" && /^[A-Za-z_$][\w$]*$/.test(a)) : [];

/** The funnel file's top-level bindings that wrap the tool. `seedIds` are
 *  the call sites the stack index keyed in this file; `seedNames` are the
 *  local names the file's own import of the tool binds. */
export function wrappingBindings(nodes: readonly FunnelIrNode[], seedIds: readonly string[], seedNames: readonly string[]): { names: Set<string>; tops: Set<string> } {
  const top = new Map<string, string>(); // top-level id → its binding name
  let defaultTop: string | null = null;
  for (const n of nodes) {
    if (n.parentId != null || typeof n.id !== "string" || typeof n.name !== "string") continue;
    if (n.type === "import" || n.type === "import_from") continue;
    top.set(n.id, n.name);
    if (n.isDefaultExport === true) defaultTop = n.id;
  }
  const calls = new Map<string, Set<string>>(); // top id → callee heads in its subtree
  for (const n of nodes) {
    if (typeof n.id !== "string") continue;
    const t = topOf(n.id);
    if (!top.has(t)) continue;
    for (const h of [calleeHead(n), ...argNames(n)]) if (h) (calls.get(t) ?? calls.set(t, new Set()).get(t)!).add(h);
  }
  const tops = new Set<string>();
  const names = new Set<string>(seedNames);
  for (const id of seedIds) { const t = topOf(id); if (top.has(t)) { tops.add(t); names.add(top.get(t)!); } }
  for (let grew = true; grew;) {
    grew = false;
    for (const [t, heads] of calls) {
      if (tops.has(t) || ![...heads].some((h) => names.has(h))) continue;
      tops.add(t); names.add(top.get(t)!); grew = true;
    }
  }
  // what an importer asks for: the binding's own name, and `default` for the default export
  const exported = new Set([...tops].map((t) => top.get(t)!));
  if (defaultTop && tops.has(defaultTop)) exported.add("default");
  return { names: exported, tops };
}

/** The importers that use what the funnel wraps, sorted. */
export function funnelUsers(wrapping: { names: Set<string>; tops: Set<string> }, importers: readonly FunnelImporter[]): string[] {
  const out = new Set<string>();
  for (const imp of importers) {
    const named = imp.imports.some((n) => Array.isArray(n.names)
      && n.names.some((x) => typeof x === "string" && wrapping.names.has(exportedName(x))));
    const called = imp.refTargets.some((id) => wrapping.tops.has(topOf(id)));
    if (named || called) out.add(imp.file);
  }
  return [...out].sort();
}
