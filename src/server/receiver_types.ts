// What a call's RECEIVER is, from the IR alone (2026-10-02, module 3). A
// platform SDK is reached through an object — `client.SaveAccess(...)`,
// `s3.put_object(...)` — and the object's origin is written down somewhere the
// parser already records: an import binding, a typed parameter
// (`client: StoreClient`), a constructor (`new Kafka()`), a factory whose
// declared return type names the SDK's class (`connect(): Promise<StoreClient>`),
// a call on another such object (`kafka.producer()`, `boto3.client("s3")`), or
// a class field's declared type and its method's return type
// (`this.#session.ready()`).
//
// Bounded (a few hops), deterministic, and silent when it cannot tell: the
// answer is a tool and HOW it was reached, or nothing. Never a guess from a
// receiver's name.

interface Node { id: string; type: string; parentId?: string | null; name?: string; params?: string[]; paramTypes?: Record<string, string>; returns?: string | null; annotation?: string; valueKind?: string; callTarget?: string; preview?: string; fieldTypes?: Record<string, string>; module?: string; names?: string[]; aliasTarget?: string; line?: number }
interface IrFile { nodes?: Node[] }
export type Files = Record<string, IrFile>;
export interface Binding { binding: string; spec: string; project?: boolean }

export interface Resolved { tool: string; how: string }
/** A project class, so its fields and methods can be followed. */
interface ClassRef { classFile: string; className: string }
type TypeAnswer = Resolved | ClassRef | null;

const MAX_HOPS = 5;

export class ReceiverResolver {
  readonly byId = new Map<string, Map<string, Node>>();
  readonly files: Files;
  /** file → import bindings (the stack index's importsByFile) */
  readonly imports: Record<string, Binding[]>;
  /** a non-project import spec → the tool it belongs to, or null */
  readonly toolOfSpec: (spec: string) => string | null;
  constructor(files: Files, imports: Record<string, Binding[]>, toolOfSpec: (spec: string) => string | null) {
    this.files = files;
    this.imports = imports;
    this.toolOfSpec = toolOfSpec;
    for (const [f, ir] of Object.entries(files)) this.byId.set(f, new Map((ir.nodes ?? []).map((n) => [n.id, n])));
  }

  private node(file: string, id: string | null | undefined) { return id ? this.byId.get(file)?.get(id) : undefined; }

  /** The project file an import spec names, probing the usual extensions. */
  projectFile(fromFile: string, b: Binding & { aliasTarget?: string }): string | null {
    const base = fromFile.split("/").slice(0, -1);
    const target = b.aliasTarget ?? b.spec;
    const parts = target.startsWith(".") ? [...base, ...target.split("/")] : target.replace(/\./g, "/").split("/");
    const out: string[] = [];
    for (const p of parts) { if (p === "." || p === "") continue; if (p === "..") out.pop(); else out.push(p); }
    const stem = out.join("/");
    const noExt = stem.replace(/\.(m|c)?[jt]sx?$/, "");
    for (const c of [stem, `${noExt}.ts`, `${noExt}.tsx`, `${noExt}.mts`, `${noExt}.js`, `${noExt}.mjs`, `${noExt}/index.ts`, `${stem}.py`, `${stem}/__init__.py`]) if (this.files[c]) return c;
    return null;
  }

  private bindingOf(file: string, name: string): Binding | undefined {
    return (this.imports[file] ?? []).find((b) => b.binding === name || b.binding === `* as ${name}` || b.binding.endsWith(` as ${name}`));
  }

  /** A type name, written in `file`, to a tool or a project class. */
  resolveType(typeText: string, file: string, hops = 0): TypeAnswer {
    if (hops > MAX_HOPS) return null;
    const t = typeText.replace(/^Promise<(.*)>$/s, "$1").replace(/^Awaitable\[(.*)\]$/, "$1")
      .split("|").map((x) => x.trim()).filter((x) => x && !/^(null|undefined|None|void)$/.test(x))[0]?.replace(/<.*>$/s, "").replace(/\[\]$/, "").replace(/^Optional\[(.*)\]$/, "$1");
    if (!t || !/^[A-Za-z_$][\w$.]*$/.test(t)) return null;
    const head = t.split(".")[0];
    const local = (this.files[file]?.nodes ?? []).find((n) => (n.type === "class_def" || n.type === "interface_def") && n.name === t && !n.parentId);
    if (local) return { classFile: file, className: t };
    const b = this.bindingOf(file, head);
    if (!b) return null;
    if (!b.project) { const tool = this.toolOfSpec(b.spec); return tool ? { tool, how: `typed ${t} from ${b.spec}` } : null; }
    const target = this.projectFile(file, b);
    return target ? this.resolveType(t.includes(".") ? t.split(".").slice(1).join(".") : t, target, hops + 1) : null;
  }

  /** Enclosing scopes of a node, innermost first: functions, then the module. */
  private scopes(file: string, n: Node): Node[] {
    const out: Node[] = [];
    let p = this.node(file, n.parentId);
    while (p) { if (p.type === "function_def" || p.type === "class_def") out.push(p); p = this.node(file, p.parentId); }
    return out;
  }

  private paramType(fn: Node, name: string): string | null {
    if (fn.paramTypes?.[name]) return fn.paramTypes[name];
    for (const p of fn.params ?? []) {
      const m = /^(?:readonly\s+|private\s+|public\s+|protected\s+)*([A-Za-z_$][\w$]*)\??\s*:\s*(.+?)(?:\s*=.*)?$/.exec(p);
      if (m && m[1] === name) return m[2];
    }
    return null;
  }

  /** The assignment that binds `name` in a scope (the function's own body, or the module). */
  private localAssign(file: string, scopeId: string | null, name: string, before: number): Node | undefined {
    const ir = this.files[file];
    let best: Node | undefined;
    for (const n of ir?.nodes ?? []) {
      if (n.type !== "assignment" || n.name !== name) continue;
      let p = n.parentId ? this.node(file, n.parentId) : undefined;
      while (p && p.type !== "function_def" && p.type !== "class_def") p = this.node(file, p.parentId);
      if ((p?.id ?? null) !== scopeId) continue;
      if ((n.line ?? 0) <= before && (!best || (n.line ?? 0) > (best.line ?? 0))) best = n;
    }
    return best;
  }

  /** What a receiver expression written at node `at` refers to. */
  typeOf(expr: string, file: string, at: Node, hops = 0): TypeAnswer {
    if (hops > MAX_HOPS) return null;
    const segs = expr.replace(/\?\./g, ".").replace(/!/g, "").split(".");
    let cur: TypeAnswer = this.headType(segs[0], file, at, hops);
    for (const seg of segs.slice(1)) {
      if (!cur || "tool" in cur) break; // a tool's sub-object is still the tool
      cur = this.memberType(cur, seg, hops + 1);
    }
    return cur;
  }

  private headType(head: string, file: string, at: Node, hops: number): TypeAnswer {
    const scopes = this.scopes(file, at);
    if (head === "this" || head === "self") {
      const cls = scopes.find((s) => s.type === "class_def");
      return cls?.name ? { classFile: file, className: cls.name } : null;
    }
    for (const s of [...scopes.filter((x) => x.type === "function_def"), null]) {
      if (s) { const t = this.paramType(s, head); if (t) return this.resolveType(t, file, hops + 1); }
      const a = this.localAssign(file, s?.id ?? null, head, at.line ?? Infinity);
      if (a) return this.valueType(a, file, hops + 1);
    }
    const b = this.bindingOf(file, head);
    if (b && !b.project) { const tool = this.toolOfSpec(b.spec); return tool ? { tool, how: `imported from ${b.spec}` } : null; }
    return null;
  }

  /** The type of an assignment's value. */
  valueType(a: Node, file: string, hops: number): TypeAnswer {
    if (a.annotation) { const t = this.resolveType(a.annotation, file, hops + 1); if (t) return t; }
    if (a.valueKind !== "call" || !a.callTarget) return null;
    const callee = a.callTarget;
    // `new Kafka({...}).admin()`: a method on a fresh instance
    const onNew = /^new\s+([A-Za-z_$][\w$.]*)\s*\(.*\)\s*\.\s*([A-Za-z_$][\w$]*)$/s.exec(callee);
    if (onNew) {
      const made = this.resolveType(onNew[1], file, hops + 1);
      if (!made) return null;
      if ("tool" in made) return { tool: made.tool, how: `${a.name} = new ${onNew[1]}(…).${onNew[2]}(…) on ${made.tool}` };
      return this.methodReturns(made, onNew[2], hops + 1);
    }
    const isNew = /^\s*(await\s+)?new\s/.test(a.preview ?? "");
    if (isNew) return this.resolveType(callee, file, hops + 1);
    const dot = callee.lastIndexOf(".");
    if (dot < 0) return this.callReturns(callee, file, hops + 1);
    const recv = this.typeOf(callee.slice(0, dot), file, a, hops + 1);
    if (!recv) return null;
    if ("tool" in recv) return { tool: recv.tool, how: `${a.name} = ${callee}(…) on ${recv.tool}` };
    return this.methodReturns(recv, callee.slice(dot + 1), hops + 1);
  }

  /** A bare function's declared return type, through its import when it lives elsewhere. */
  private callReturns(fnName: string, file: string, hops: number): TypeAnswer {
    const local = (this.files[file]?.nodes ?? []).find((n) => n.type === "function_def" && n.name === fnName && !n.parentId);
    if (local) return local.returns ? this.resolveType(local.returns, file, hops + 1) : null;
    const b = this.bindingOf(file, fnName);
    if (!b) return null;
    if (!b.project) { const tool = this.toolOfSpec(b.spec); return tool ? { tool, how: `returned by ${fnName} from ${b.spec}` } : null; }
    const target = this.projectFile(file, b);
    return target ? this.callReturns(fnName, target, hops + 1) : null;
  }

  private classNode(c: ClassRef): Node | undefined {
    return (this.files[c.classFile]?.nodes ?? []).find((n) => n.type === "class_def" && n.name === c.className);
  }

  private memberType(c: ClassRef, member: string, hops: number): TypeAnswer {
    const cls = this.classNode(c);
    const ft = cls?.fieldTypes?.[member] ?? cls?.fieldTypes?.[member.replace(/^#/, "")];
    return ft ? this.resolveType(ft, c.classFile, hops + 1) : null;
  }

  private methodReturns(c: ClassRef, method: string, hops: number): TypeAnswer {
    const cls = this.classNode(c);
    if (!cls) return null;
    const m = (this.files[c.classFile]?.nodes ?? []).find((n) => n.type === "function_def" && n.parentId === cls.id && n.name === method);
    return m?.returns ? this.resolveType(m.returns, c.classFile, hops + 1) : null;
  }

  /** Whether a receiver's origin is UNKNOWN (an untyped parameter, an opaque
   *  value, a name bound nowhere visible) rather than known not to be a tool. */
  originUnknown(callee: string, file: string, at: Node): boolean {
    const head = callee.replace(/\?\./g, ".").split(".")[0];
    if (head === "this" || head === "self" || this.bindingOf(file, head)) return false;
    const scopes = this.scopes(file, at).filter((s) => s.type === "function_def");
    for (const s of [...scopes, null]) {
      if (s && (s.params ?? []).some((p) => p.replace(/^\.\.\./, "").split(/[?:=\s]/)[0] === head)) return !this.paramType(s, head);
      const a = this.localAssign(file, s?.id ?? null, head, at.line ?? Infinity);
      if (a) return a.valueKind === "other" && !a.annotation;
    }
    return true;
  }

  /** The tool a call `recv.method(...)` written at node `at` goes to. */
  toolOfCall(callee: string, file: string, at: Node): Resolved | null {
    const dot = callee.lastIndexOf(".");
    if (dot < 0) return null;
    const r = this.typeOf(callee.slice(0, dot), file, at);
    return r && "tool" in r ? r : null;
  }
}
