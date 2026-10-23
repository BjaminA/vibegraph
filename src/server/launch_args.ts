// FOLLOWING A LAUNCH'S FIRST ARGUMENT (2026-10-22, the root-cause handoff RC3).
// process_launches.ts finds the launches; this says which program each runs,
// from the IR alone, following the value as far as the code says it:
//
//   a literal          "gh"   ["gh", "api", …]   "git status" (a shell string: its first word)
//   a constant         GIT = "git"   (module level, or in the launching function)
//   an env default     os.environ.get("X", "gh")   process.env.X ?? "gh"
//   a lookup           shutil.which("git") or "git"
//   a parameter        `def sh(args): run(args)` called as sh(["gh", …]): each
//                      call that fills it (its default when it has one)
//   an attribute       `self.binary` set in the class, from a constructor
//                      parameter: each construction that fills it
//   a factory          `binary = find_binary(…)`: what that function returns
//
// At most three hops; anything else is unresolved, never guessed.

export interface IrNode {
  id: string; type: string; line?: number; parentId?: string | null; name?: string;
  funcName?: string; callTarget?: string; args?: string[]; argKeys?: unknown; preview?: string; literals?: string[];
  module?: string; names?: string[]; params?: string[];
}
export interface ArgEnvLike { files: Record<string, { language?: string; nodes?: IrNode[] }> }
export type LaunchFrom = "literal" | "constant" | "env-default" | "which" | "default" | "caller" | "unresolved";
export interface ArgHit { word: string; from: LaunchFrom; via?: { file: string; nodeId: string; line?: number } }

const MAX_HOPS = 3;
const QUOTED = /^\s*[rbfu]{0,2}(["'`])((?:\\.|(?!\1).)*)\1\s*$/s;
export function literalOf(text: string | undefined): string | null {
  const m = QUOTED.exec(text ?? "");
  return m && !/\$\{|\{[A-Za-z_]/.test(m[2]) ? m[2] : null;
}

/** The first element of an argv list's text, or the text itself. */
export function firstArg(text: string): { first: string; list: boolean } {
  const t = text.trim();
  if (!t.startsWith("[")) return { first: t, list: false };
  const inner = t.slice(1);
  let depth = 0, quote = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (depth === 0) return { first: inner.slice(0, i), list: true }; depth--; }
    else if (c === "," && depth === 0) return { first: inner.slice(0, i), list: true };
  }
  return { first: inner, list: true };
}

/** A value written in an expression: a literal, an env default, a `which()` lookup. */
function inlineValue(text: string, ct?: string, args?: string[]): { value: string; from: LaunchFrom } | null {
  const lit = literalOf(text);
  if (lit !== null) return { value: lit, from: "constant" };
  if (ct && /^(os\.environ\.get|os\.getenv|environ\.get|getenv)$/.test(ct)) {
    const d = literalOf(args?.[1]);
    if (d !== null) return { value: d, from: "env-default" };
  }
  const env = /\b(?:os\.environ\.get|os\.getenv)\(\s*["'][^"']+["']\s*,\s*["']([^"']+)["']\s*\)/.exec(text);
  if (env) return { value: env[1], from: "env-default" };
  const js = /process\.env(?:\.\w+|\[["'][^"']+["']\])\s*(?:\?\?|\|\|)\s*["'`]([^"'`$]+)["'`]/.exec(text);
  if (js) return { value: js[1], from: "env-default" };
  const which = /\bwhich\(\s*["']([^"']+)["']\s*\)(?:\s*(?:or|\|\||\?\?)\s*["']([^"']+)["'])?/.exec(text);
  if (which) return { value: which[2] ?? which[1], from: "which" };
  return null;
}

/** A name's value in a file: a string constant, an env default, or a `which()`
 *  lookup, bound in the given function or at module level (also how
 *  service_inventory.ts follows a URL held in a constant). */
export function valueOf(name: string, nodes: IrNode[], within: string | null): { value: string; from: LaunchFrom } | null {
  const scoped = bindingOf(name, nodes, within);
  if (!scoped) return null;
  const v = inlineValue(scoped.preview ?? "", scoped.callTarget, scoped.args);
  if (v) return v;
  if (/process\.env\.\w+\s*(\?\?|\|\|)/.test(scoped.preview ?? "") && scoped.literals?.length === 1) return { value: scoped.literals[0], from: "env-default" };
  return null;
}

/** Where a name is bound: anywhere in the given function (inside an `if` or a
 *  loop too), else at module level. */
function bindingOf(name: string, nodes: IrNode[], within: string | null): IrNode | null {
  const binds = nodes.filter((n) => n.type === "assignment" && n.name === name);
  return binds.find((n) => within && (n.parentId === within || n.id.startsWith(`${within}/`))) ?? binds.find((n) => !n.parentId) ?? null;
}

interface Scope { file: string; nodes: IrNode[]; fn: IrNode | null; cls: IrNode | null }

/** The function and class a node sits in. */
export function scopeOf(file: string, nodes: IrNode[], node: IrNode): Scope {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let fn: IrNode | null = null, cls: IrNode | null = null;
  for (let p = node.parentId ? byId.get(node.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
    if (!fn && p.type === "function_def") fn = p;
    if (!cls && p.type === "class_def") cls = p;
  }
  return { file, nodes, fn, cls };
}

const paramName = (p: string) => p.replace(/^[*]+/, "").split(/[=:]/)[0].trim();
const calleeOf = (n: IrNode) => (n.type === "call" ? n.funcName ?? "" : n.callTarget ?? "");
const isCall = (n: IrNode) => n.type === "call" || ((n.type === "assignment" || n.type === "return_stmt") && !!n.callTarget);

/** A call's arguments read from its text (`f(a, b=1)`), for a node that keeps
 *  the call only as text (a returned call's `value`): [{ kw?, text }]. */
export function argsOfCallText(text: string): Array<{ kw?: string; text: string }> {
  const open = text.indexOf("(");
  if (open < 0) return [];
  const out: Array<{ kw?: string; text: string }> = [];
  let depth = 0, quote = "", start = open + 1;
  const push = (end: number) => {
    const a = text.slice(start, end).trim();
    if (!a) return;
    const kw = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
    out.push(kw ? { kw: kw[1], text: kw[2] } : { text: a });
  };
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (depth === 0) { push(i); return out; } depth--; }
    else if (c === "," && depth === 0) { push(i); start = i + 1; }
  }
  return out;
}
interface ValueNode extends IrNode { value?: string }

/** The text a call passes for a parameter: by keyword, else by position. */
function argFor(call: IrNode, name: string, index: number): string | null {
  if (!call.args) {
    const parsed = argsOfCallText((call as ValueNode).value ?? call.preview ?? "");
    return parsed.find((a) => a.kw === name)?.text ?? parsed.filter((a) => !a.kw)[index]?.text ?? null;
  }
  const keys = Array.isArray(call.argKeys) ? (call.argKeys as unknown[][]) : null;
  const kw = keys?.findIndex((g) => Array.isArray(g) && g[0] === name) ?? -1;
  if (kw >= 0) return call.args?.[kw] ?? null;
  if (keys && Array.isArray(keys[index]) && keys[index].length) return null; // that position holds a keyword
  return call.args?.[index] ?? null;
}

/** The calls that fill a function's parameters: a constructor's across the project, a method's through `self`/`this` in its file, a function's in its file. */
function callersOf(fn: IrNode, scope: Scope, env: ArgEnvLike): Array<{ file: string; nodes: IrNode[]; call: IrNode }> {
  const out: Array<{ file: string; nodes: IrNode[]; call: IrNode }> = [];
  const name = fn.name ?? "";
  if ((name === "__init__" || name === "constructor") && scope.cls?.name) {
    const C = scope.cls.name;
    for (const [file, ir] of Object.entries(env.files)) for (const n of ir.nodes ?? []) {
      const c = calleeOf(n);
      if (isCall(n) && (c === C || c.endsWith(`.${C}`))) out.push({ file, nodes: ir.nodes ?? [], call: n });
    }
    return out;
  }
  const wanted = scope.cls ? [`self.${name}`, `this.${name}`] : [name];
  for (const n of scope.nodes) if (isCall(n) && wanted.includes(calleeOf(n))) out.push({ file: scope.file, nodes: scope.nodes, call: n });
  return out;
}

/** What a project function returns, as text with its scope: the function in
 *  this file of that name, else every project function of that name (at most
 *  three, so a common name cannot fan out). */
function returnsOf(callee: string, scope: Scope, env: ArgEnvLike): Array<{ text: string; scope: Scope }> {
  const name = callee.split(".").pop() ?? callee;
  const defs = (file: string, nodes: IrNode[]) => nodes.filter((n) => n.type === "function_def" && n.name === name).map((fn) => ({ file, nodes, fn }));
  let found = defs(scope.file, scope.nodes);
  if (!found.length) found = Object.entries(env.files).flatMap(([f, ir]) => defs(f, ir.nodes ?? [])).slice(0, 3);
  return found.flatMap(({ file, nodes, fn }) => nodes.filter((n) => n.type === "return_stmt" && n.id.startsWith(`${fn.id}/`))
    .map((r) => ({ text: (r as ValueNode).value ?? "", scope: scopeOf(file, nodes, r) })));
}

/** The program word(s) an argv expression names; null when the code does not say. */
export function resolveLaunchArg(text: string, scope: Scope, shell: boolean, env: ArgEnvLike, hops = 0): ArgHit[] | null {
  const { first, list } = firstArg(text);
  const t = first.trim();
  const shellWord = shell && !list;
  const word = (v: string) => (shellWord ? v.trim().split(/\s+/)[0] ?? "" : v);
  const lit = literalOf(t);
  if (lit !== null) return [{ word: word(lit), from: "literal" }];
  if (shellWord) {
    const m = /^\s*[rbfu]{0,2}["'`]([A-Za-z0-9][\w./+-]*)\s/.exec(t);
    if (m) return [{ word: m[1], from: "literal" }];
  }
  const inline = inlineValue(t);
  if (inline) return [{ word: word(inline.value), from: inline.from }];
  // a name: bound in this function or the module, else a parameter of the function
  if (/^[A-Za-z_$][\w$]*$/.test(t)) {
    const v = valueOf(t, scope.nodes, scope.fn?.id ?? null);
    if (v) return [{ word: word(v.value), from: v.from }];
    // bound to what a project function returns (`binary = find_binary(…)`): its returns
    const bound = bindingOf(t, scope.nodes, scope.fn?.id ?? null);
    if (bound?.callTarget && hops < MAX_HOPS) {
      const got = returnsOf(bound.callTarget, scope, env).flatMap((r) => resolveLaunchArg(r.text, r.scope, shell, env, hops + 1) ?? []);
      if (got.length) return got.map((h) => ({ ...h, from: h.from === "literal" ? "constant" : h.from }));
    }
    const params = (scope.fn?.params ?? []).map((p) => p.trim());
    const at = params.findIndex((p) => paramName(p) === t);
    if (at < 0) return null;
    const dflt = literalOf(params[at].split("=").slice(1).join("="));
    if (dflt !== null) return [{ word: word(dflt), from: "default" }];
    if (hops >= MAX_HOPS) return null;
    const index = params.filter((p) => !["self", "cls"].includes(paramName(p))).findIndex((p) => paramName(p) === t);
    const hits: ArgHit[] = [];
    for (const c of callersOf(scope.fn!, scope, env)) {
      const arg = argFor(c.call, t, index);
      const got = arg === null ? null : resolveLaunchArg(arg, scopeOf(c.file, c.nodes, c.call), shell, env, hops + 1);
      for (const h of got ?? []) hits.push({ ...h, from: h.from === "literal" ? "caller" : h.from, via: h.via ?? { file: c.file, nodeId: c.call.id, ...(c.call.line ? { line: c.call.line } : {}) } });
    }
    return hits.length ? hits : null;
  }
  // an attribute the class sets: `self.binary = …`
  const attr = /^(self|this)\.([A-Za-z_$][\w$]*)$/.exec(t);
  if (attr && scope.cls && hops < MAX_HOPS) {
    const prefix = scope.cls.id + "/";
    const set = scope.nodes.find((n) => n.type === "assignment" && n.name === t && n.id.startsWith(prefix));
    if (!set) return null;
    return resolveLaunchArg(set.preview ?? "", scopeOf(scope.file, scope.nodes, set), shell, env, hops + 1);
  }
  return null;
}
