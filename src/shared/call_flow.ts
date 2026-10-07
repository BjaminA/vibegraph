// WHAT AN ARROW CARRIES (2026-10-07, Ben: make the arrows in the code view
// and the thread view mean more — "what comes back" and "data flow lines").
// Pure and webview-safe; both views read a call site through this one module
// so they cannot say different things.
//
//   callIO      a call site's arguments (what goes in) and the names its
//               result is bound to (what comes back): `train_x, train_y, …
//               = load()` binds five names; `model = build_model()` one;
//               a bare `print(x)` none. From the IR only — `targets` for an
//               unpacking (parse_cst / the jsts builder), `name` otherwise.
//   dataFlows   inside ONE function, a later call whose arguments use names
//               an earlier call's result was bound to: load() ⇢
//               run_training(model, train_x, train_y) via train_x, train_y.
//               The latest earlier binding of a name wins (a rebinding in
//               between takes the flow); names read inside an argument
//               expression count (`train_x[batch]` reads train_x), an
//               attribute after a dot does not (`x.shape` reads x only).

export interface CallNodeLike {
  id: string; type: string; parentId?: string | null; line?: number;
  name?: string; targets?: string[]; args?: string[]; callTarget?: string; funcName?: string; valueKind?: string;
}

export interface CallIO { args: string[]; binds: string[] }

export function callIO(n: CallNodeLike | undefined): CallIO {
  if (!n) return { args: [], binds: [] };
  const args = (n.args ?? []).map((a) => String(a).replace(/\s+/g, " ").trim()).filter(Boolean);
  const binds = n.type !== "assignment" ? []
    : n.targets?.length ? n.targets.map((t) => t.replace(/^\*/, ""))
      : n.name && n.name !== "?" && !n.name.includes(".") ? [n.name] : [];
  return { args, binds };
}

const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** One label for an arrow: what goes in, then what comes back. */
export function ioLabel(io: CallIO, max = 44): string {
  const inn = io.args.join(", ");
  const out = io.binds.join(", ");
  if (!inn && !out) return "";
  if (!out) return short(inn, max);
  if (!inn) return `→ ${short(out, max - 2)}`;
  const half = Math.max(12, Math.floor((max - 3) / 2));
  return `${short(inn, half)} → ${short(out, half)}`;
}

const KEYWORDS = new Set(["None", "True", "False", "and", "or", "not", "in", "is", "if", "else", "for", "lambda", "await",
  "null", "undefined", "true", "false", "new", "this", "self", "typeof", "void", "of", "await", "async"]);

/** The plain names an argument expression reads (`train_x[batch]` → train_x; `x.shape` → x; `k=v` → v). */
export function namesRead(arg: string): string[] {
  const text = arg.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, " ").replace(/^\s*\*{1,2}/, "").replace(/^\s*[A-Za-z_]\w*\s*=(?!=)/, " ");
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)/g)) if (!KEYWORDS.has(m[1])) out.add(m[1]);
  return [...out];
}

export interface FlowSite { key: string; scope: string; line: number; io: CallIO }
export interface DataFlow { from: string; to: string; names: string[] }

/** Earlier call results reaching later calls' arguments, one function at a time. */
export function dataFlows(sites: FlowSite[]): DataFlow[] {
  const out = new Map<string, DataFlow>();
  const byScope = new Map<string, FlowSite[]>();
  for (const s of sites) byScope.set(s.scope, [...(byScope.get(s.scope) ?? []), s]);
  for (const list of byScope.values()) {
    const ordered = [...list].sort((a, b) => a.line - b.line);
    for (const later of ordered) {
      const reads = new Set(later.io.args.flatMap(namesRead));
      if (!reads.size) continue;
      for (const name of reads) {
        // the latest earlier site that binds this name
        let src: FlowSite | null = null;
        for (const s of ordered) if (s.line < later.line && s.io.binds.includes(name)) src = s;
        if (!src || src.key === later.key) continue;
        const k = `${src.key}->${later.key}`;
        const f = out.get(k) ?? { from: src.key, to: later.key, names: [] };
        if (!f.names.includes(name)) f.names.push(name);
        out.set(k, f);
      }
    }
  }
  return [...out.values()];
}

/** The function a node belongs to: the nearest function_def ancestor, or the module. */
export function scopeOf(id: string, byId: Map<string, CallNodeLike>): string {
  let p = byId.get(id);
  while (p && p.type !== "function_def") p = p.parentId ? byId.get(p.parentId) : undefined;
  return p?.id ?? "module";
}
