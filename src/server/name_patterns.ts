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

import type { NamePattern } from "../shared/data_arch_types.ts";

interface Node { id: string; type: string; parentId?: string | null; name?: string; line?: number; col?: number; funcName?: string; callTarget?: string; args?: string[]; params?: string[]; returnsPattern?: { pattern: string; params: string[]; transformed?: string[] }; nested?: boolean; valueKind?: string; preview?: string }
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
}

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
      return { pattern };
    }
    // an unreducible function around a reducible name: its argument's name, routed through it
    for (const k of this.kids(file, call.id)) {
      const inner = this.ofCall(file, k, depth + 1);
      if (inner?.pattern) return { pattern: inner.pattern, via: [...(inner.via ?? []), `${callee} (${def.file}:${def.node.line})`] };
    }
    return { computedAt: `${def.file}:${def.node.line}`, via: [callee] };
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
