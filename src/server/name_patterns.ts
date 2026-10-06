// NAME PATTERNS at call sites (2026-10-02, module 2). The parsers stamp a
// small pure builder with the pattern it returns (`returnsPattern`); this
// evaluates the NAME a call passes: the builder's pattern with each hole
// filled from the call's literal arguments, or kept as a typed hole named by
// the builder's parameter. It follows a value one step further when the code
// does: a local bound to a builder's result, a parameter filled by the
// function's callers, an unreducible function wrapped around a reducible name
// (`documentIdFor(requestPath(...))` — the family is the inner name's, the
// wrapper is recorded as a router). What cannot be reduced is said with the
// place it is computed.
//
// 2026-10-06 (direction review M6) — a hole filled by a LOOP VARIABLE over a
// literal table (`for (const [key, part] of PARTS) … entityPath(id, part)`)
// is every value the table gives that position: the name is all of them
// (`each`), one data operation per family they reach.

import type { NamePattern } from "../shared/data_arch_types.ts";

interface Node { id: string; type: string; parentId?: string | null; name?: string; line?: number; col?: number; funcName?: string; callTarget?: string; args?: string[]; params?: string[]; returnsPattern?: { pattern: string; params: string[]; transformed?: string[] }; nested?: boolean; valueKind?: string; preview?: string; target?: string; iterName?: string }
interface IrFile { nodes?: Node[]; edges?: Array<{ source: string; target: string; type: string; targetFile?: string }> }
type Files = Record<string, IrFile>;
type Resolve = (from: string, imp: Record<string, any>) => string | null;

export interface NameValue {
  /** the reduced name, holes `{param}` */
  pattern?: string;
  /** unreducible functions the name passed through (routers) */
  via?: string[];
  /** where an unreducible name is computed */
  computedAt?: string;
  /** every name the call passes, when a hole is a loop over a literal table */
  each?: string[];
}

const EACH_CAP = 24;
/** The literal elements of one table row: `"x"` → [x], `["a", "b"]` → [a, b]. */
const rowOf = (t: string): string[] | null => {
  const one = strLit(t);
  if (one !== null) return [one];
  const m = /^\s*\[(.*)\]\s*$/s.exec(t);
  if (!m) return null;
  const parts = m[1].split(",").map((x) => strLit(x));
  return parts.every((x): x is string => x !== null) ? parts : null;
};

const MAX_DEPTH = 3;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const strLit = (t: string) => { const m = /^\s*(["'])(.*)\1\s*$/s.exec(t); return m ? m[2] : null; };
/** A hole named by the root identifier of the expression that fills it. */
const hole = (expr: string) => `{${/[A-Za-z_$][\w$]*/.exec(expr)?.[0] ?? "?"}}`;
/** A template literal / f-string as a pattern. */
const tplLit = (t: string): string | null => {
  const js = /^\s*`(.*)`\s*$/s.exec(t);
  if (js) return js[1].replace(/\$\{([^}]*)\}/g, (_, x) => hole(x));
  const py = /^\s*f(["'])(.*)\1\s*$/s.exec(t);
  return py ? py[2].replace(/\{([^{}]*)\}/g, (_, x) => hole(x)) : null;
};

export class NameEvaluator {
  private byId = new Map<string, Map<string, Node>>();
  private children = new Map<string, Node[]>();
  private incoming = new Map<string, Array<{ file: string; source: string }>>();
  readonly files: Files;
  readonly resolveImport: Resolve;
  constructor(files: Files, resolveImport: Resolve) {
    this.files = files;
    this.resolveImport = resolveImport;
    for (const [f, ir] of Object.entries(files)) {
      const m = new Map<string, Node>();
      for (const n of ir.nodes ?? []) {
        m.set(n.id, n);
        if (n.parentId) { const k = `${f}::${n.parentId}`; if (!this.children.has(k)) this.children.set(k, []); this.children.get(k)!.push(n); }
      }
      this.byId.set(f, m);
      for (const e of ir.edges ?? []) {
        if (e.type !== "reference") continue;
        const k = `${e.targetFile ?? f}::${e.target}`;
        if (!this.incoming.has(k)) this.incoming.set(k, []);
        this.incoming.get(k)!.push({ file: f, source: e.source });
      }
    }
  }

  /** Every builder the parsers stamped. */
  patterns(): NamePattern[] {
    const out: NamePattern[] = [];
    for (const [file, ir] of Object.entries(this.files)) for (const n of ir.nodes ?? []) {
      if (n.type === "function_def" && n.returnsPattern) out.push({ pattern: n.returnsPattern.pattern, fn: n.name ?? "?", file, line: n.line ?? 0 });
    }
    return out;
  }

  private node(file: string, id: string | null | undefined) { return id ? this.byId.get(file)?.get(id) : undefined; }
  private kids(file: string, id: string) { return [...(this.children.get(`${file}::${id}`) ?? [])].sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.col ?? 0) - (b.col ?? 0)); }

  /** A function name used in `file` → its definition (same file, or through an import). */
  fnDef(file: string, name: string): { file: string; node: Node } | null {
    const nodes = this.files[file]?.nodes ?? [];
    const local = nodes.find((n) => n.type === "function_def" && n.name === name && !n.parentId);
    if (local) return { file, node: local };
    for (const imp of nodes.filter((n) => n.type === "import_from" || n.type === "import")) {
      for (const raw of (imp as any).names ?? []) {
        const [orig, as] = String(raw).includes(" as ") ? String(raw).split(" as ").map((s: string) => s.trim()) : [String(raw).trim(), String(raw).trim()];
        if (as !== name) continue;
        const target = this.resolveImport(file, imp);
        const def = target ? (this.files[target]?.nodes ?? []).find((n) => n.type === "function_def" && n.name === orig && !n.parentId) : undefined;
        if (def && target) return { file: target, node: def };
      }
    }
    return null;
  }

  /** The name a call (to a builder) produces. `call` carries funcName/callTarget and args. */
  ofCall(file: string, call: Node, depth = 0): NameValue | null {
    const callee = String(call.funcName ?? call.callTarget ?? "");
    if (!IDENT.test(callee) || depth > MAX_DEPTH) return null;
    const def = this.fnDef(file, callee);
    if (!def) return null;
    const rp = def.node.returnsPattern;
    if (rp) {
      const args = call.args ?? [];
      const pattern = rp.pattern.replace(/\{([^}]+)\}/g, (whole, p) => {
        const idx = rp.params.indexOf(p);
        const lit = idx >= 0 && args[idx] !== undefined ? strLit(args[idx]) : null;
        return lit !== null ? lit : whole;
      });
      // holes a loop over a literal table fills: one name per value
      let each = [pattern];
      for (const p of rp.params) {
        const a = args[rp.params.indexOf(p)];
        const vals = a !== undefined && IDENT.test(a.trim()) && pattern.includes(`{${p}}`) ? this.loopValues(file, call, a.trim()) : null;
        if (!vals) continue;
        each = each.flatMap((x) => vals.map((v) => x.split(`{${p}}`).join(v))).slice(0, EACH_CAP);
      }
      return each.length > 1 || each[0] !== pattern ? { pattern, each } : { pattern };
    }
    // an unreducible function around a reducible name: its argument's name, routed through it
    for (const k of this.kids(file, call.id)) {
      const inner = this.ofCall(file, k, depth + 1);
      if (inner?.pattern) return { pattern: inner.pattern, via: [...(inner.via ?? []), `${callee} (${def.file}:${def.node.line})`] };
    }
    return { computedAt: `${def.file}:${def.node.line}`, via: [callee] };
  }

  /** The values a loop variable takes, when its loop walks a literal table
   *  this file holds (`for (const [key, part] of PARTS)` → PARTS' column). */
  private loopValues(file: string, at: Node, ident: string): string[] | null {
    for (let p = this.node(file, at.parentId); p && p.type !== "function_def"; p = this.node(file, p.parentId)) {
      if (p.type !== "for_loop" || !p.target || !p.iterName || !IDENT.test(p.iterName)) continue;
      const t = p.target.trim();
      const names = t === ident ? null : /^\[(.*)\]$/.exec(t)?.[1].split(",").map((x) => x.trim());
      const col = t === ident ? -1 : names ? names.indexOf(ident) : -2;
      if (col === -2) continue;
      const table = (this.files[file]?.nodes ?? []).find((n) => n.type === "assignment" && n.name === p!.iterName && !n.parentId && n.valueKind === "list");
      const rows = (table?.args ?? []).map(rowOf);
      if (!rows.length || rows.some((r) => !r)) return null;
      const vals = rows.map((r) => (col === -1 ? (r!.length === 1 ? r![0] : null) : r![col] ?? null));
      return vals.every((v): v is string => v !== null) ? [...new Set(vals)] : null;
    }
    return null;
  }

  /** The enclosing function of a node. */
  private enclosingFn(file: string, n: Node): Node | undefined {
    let p = this.node(file, n.parentId);
    while (p && p.type !== "function_def") p = this.node(file, p.parentId);
    return p;
  }

  /** The name an argument text (as the IR spells it) carries, at node `at`. */
  ofArg(file: string, at: Node, argText: string, depth = 0): NameValue | null {
    if (depth > MAX_DEPTH) return null;
    const lit = strLit(argText);
    if (lit !== null) return { pattern: lit };
    const tpl = tplLit(argText);
    if (tpl !== null) return { pattern: tpl };
    // configuration: `process.env.V ?? "d"` is a typed hole with its default
    const env = /process\.env\.([A-Z_][A-Z0-9_]*)\s*(?:\?\?|\|\|)\s*(["'`])([^"'`]*)\2/.exec(argText) ?? /os\.environ\.get\(\s*["']([A-Z_][A-Z0-9_]*)["']\s*,\s*(["'])([^"']*)\2/.exec(argText);
    if (env) return { pattern: `{${env[1]}=${env[3]}}` };
    // a settings object's field (`settings.alias`) → its value, here or imported
    const member = /^\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*$/.exec(argText);
    if (member) {
      const v = this.objectProp(file, member[1], member[2]);
      if (v) return this.ofArg(v.file, v.node, v.value, depth + 1);
    }
    const call = /^\s*(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(argText);
    if (call) {
      const kid = this.kids(file, at.id).find((k) => (k.funcName ?? k.callTarget) === call[1]);
      if (kid) return this.ofCall(file, kid, depth + 1);
    }
    const id = argText.trim();
    if (!IDENT.test(id)) return null;
    const fn = this.enclosingFn(file, at);
    // a local bound to a builder's result
    const scopeNodes = (this.files[file]?.nodes ?? []).filter((n) => n.type === "assignment" && n.name === id && (n.line ?? 0) <= (at.line ?? 0) && this.enclosingFn(file, n)?.id === fn?.id);
    const bound = scopeNodes.sort((a, b) => (b.line ?? 0) - (a.line ?? 0))[0];
    if (bound) {
      if (bound.valueKind === "call") return this.ofCall(file, { ...bound, funcName: bound.callTarget }, depth + 1);
      if (bound.preview) return this.ofArg(file, bound, bound.preview, depth + 1);
      return null;
    }
    // a parameter: what its callers pass
    if (fn) {
      const pi = (fn.params ?? []).findIndex((p) => String(p).replace(/^\.\.\./, "").split(/[?:=\s]/)[0] === id);
      if (pi >= 0) {
        // every caller must agree: a parameter fed different names is a FUNNEL
        // (it serves every family), not an operation on one of them
        const seen = new Map<string, NameValue>();
        for (const c of this.callersOf(file, fn)) {
          const v = this.ofArg(c.file, c.node, c.node.args?.[pi] ?? "", depth + 1);
          if (!v?.pattern) return null;
          seen.set(v.pattern.replace(/\{[^}]*\}/g, "{}"), v);
        }
        return seen.size === 1 ? [...seen.values()][0] : null;
      }
    }
    return null;
  }

  /** `settings.key` → the value text of `key` in the object literal `settings` holds (here or imported). */
  private objectProp(file: string, obj: string, key: string): { file: string; node: Node; value: string } | null {
    const look = (f: string) => {
      const a = (this.files[f]?.nodes ?? []).find((n) => n.type === "assignment" && n.name === obj && !n.parentId && (n as any).objectProps);
      const p = (a as any)?.objectProps?.find((x: any) => x.key === key && x.value);
      return a && p ? { file: f, node: a, value: String(p.value) } : null;
    };
    const here = look(file);
    if (here) return here;
    for (const imp of (this.files[file]?.nodes ?? []).filter((n) => n.type === "import_from")) {
      if (!((imp as any).names ?? []).some((x: string) => x === obj || x.endsWith(` as ${obj}`))) continue;
      const target = this.resolveImport(file, imp);
      const hit = target ? look(target) : null;
      if (hit) return hit;
    }
    return null;
  }

  /** M2: a builder some call site feeds from configuration and a zone — the
   *  name each zone's resource carries (`{BUCKET_PREFIX=acme}-{zone}`). */
  resourceNaming(): { fn: string; file: string; line: number; pattern: string; zoneHole: string; chain?: string; cite: string } | null {
    for (const [file, ir] of Object.entries(this.files)) for (const def of ir.nodes ?? []) {
      const rp = def.returnsPattern as (Node["returnsPattern"] & { chains?: Record<string, string> }) | undefined;
      if (def.type !== "function_def" || !rp || rp.params.length < 2) continue;
      for (const c of this.callersOf(file, def)) {
        const holes: Record<string, string> = {};
        rp.params.forEach((p, i) => {
          const v = this.ofArg(c.file, c.node, c.node.args?.[i] ?? "");
          if (v?.pattern && /^\{[A-Z_][A-Z0-9_]*=[^}]*\}$/.test(v.pattern)) holes[p] = v.pattern;
        });
        const open = rp.params.filter((p) => !holes[p] && rp.pattern.includes(`{${p}}`));
        if (!Object.keys(holes).length || open.length !== 1) continue;
        const pattern = rp.pattern.replace(/\{([^}]+)\}/g, (w, p) => holes[p] ?? w);
        return { fn: def.name ?? "?", file, line: def.line ?? 0, pattern, zoneHole: open[0], ...(rp.chains?.[open[0]] ? { chain: rp.chains[open[0]] } : {}), cite: `${c.file}:${c.node.line}` };
      }
    }
    return null;
  }

  /** Call nodes that reach `fn`: linker edges, and same-file calls by name. */
  callersOf(file: string, fn: Node): Array<{ file: string; node: Node }> {
    const out: Array<{ file: string; node: Node }> = [];
    for (const r of this.incoming.get(`${file}::${fn.id}`) ?? []) { const n = this.node(r.file, r.source); if (n) out.push({ file: r.file, node: n }); }
    if (!out.length) for (const n of this.files[file]?.nodes ?? []) if ((n.funcName ?? n.callTarget) === fn.name && n.id !== fn.id) out.push({ file, node: n });
    return out;
  }

  /** The name a data operation call passes: its builder children first, then its arguments in order. */
  ofOperation(file: string, op: Node): NameValue | null {
    let computed: NameValue | null = null;
    for (const k of this.kids(file, op.id)) {
      const v = this.ofCall(file, k);
      if (v?.pattern) return v;
      if (v?.computedAt && !computed) computed = v;
    }
    for (const a of op.args ?? []) {
      const v = this.ofArg(file, op, a);
      if (v?.pattern) return v;
      if (v?.computedAt && !computed) computed = v;
    }
    return computed;
  }
}
