// WHO A PROCESS SIGNS IN AS (2026-10-02, "the location split", M6). On a
// platform where the store checks identities, which identity a process uses is
// decided where it builds its client: `connect("svc.config.json")`,
// `new Session(settings.configPath)` with `configPath: process.env.CFG ??
// "app.json"`, or `new Session(person.config)` once per person. This reads it
// from the IR:
//
//   a CLIENT MAKER  a project function whose declared return type is a tool's
//                   class, or a project class with a method returning one;
//   its IDENTITY    the maker's first argument: a literal, an env variable with
//                   its default, a settings object's field, or a local bound to
//                   one; a loop variable or a parameter → acts as MANY;
//   a LAUNCH        an env assignment for that variable in a package.json
//                   script, or a documented launch line in the entry's header
//                   comment (`VAR=value tsx bin/x.ts`) — said as such;
//   a WRITE         the client a write goes through, followed back through the
//                   locals that wrap it (`store ← boundaries ← session`).
//
// An identity is a NAME (the config file's stem); mapping it to a planned
// principal is the plan's business, and a process's `runsAs` is only ever
// PROPOSED from it.

import * as fs from "fs";
import * as path from "path";
import { ReceiverResolver, type Binding } from "./receiver_types.ts";
import { specToTool, type StackLike } from "./sdk_effects.ts";

interface Node { id: string; type: string; parentId?: string | null; name?: string; line?: number; endLine?: number; funcName?: string; callTarget?: string; args?: string[]; preview?: string; returns?: string | null; valueKind?: string; params?: string[]; objectProps?: Array<{ key: string; value?: string }>; names?: string[]; module?: string }
type Files = Record<string, { nodes?: Node[] }>;

export interface Identity { id: string; source: string; env?: string; cite: string }
export interface IdentityAnswer { identity?: Identity; many?: string }

const CONFIG_EXT = /\.(config\.)?(json|ya?ml|toml|pem|key|cfg|conf|ini|env)$/i;
const stem = (v: string) => path.basename(v).replace(CONFIG_EXT, "").replace(/\.config$/, "");
const lit = (t: string) => { const m = /^\s*(["'`])([^"'`$]*)\1\s*$/.exec(t); return m ? m[2] : null; };
const envDefault = (t: string) => { const m = /process\.env\.([A-Z_][A-Z0-9_]*)\s*(?:\?\?|\|\|)\s*(["'`])([^"'`]*)\2/.exec(t) ?? /os\.environ\.get\(\s*["']([A-Z_][A-Z0-9_]*)["']\s*,\s*(["'])([^"']*)\2/.exec(t); return m ? { env: m[1], value: m[3] } : null; };

export class IdentityIndex {
  private byId = new Map<string, Map<string, Node>>();
  private makers = new Set<string>(); // `${file}::${name}` of functions / classes that make a client
  private resolver: ReceiverResolver;
  readonly files: Files;
  readonly root: string | null;
  private launchMemo = new Map<string, Record<string, { value: string; cite: string }>>();
  constructor(files: Files, stack: StackLike, root: string | null) {
    this.files = files;
    this.root = root;
    this.resolver = new ReceiverResolver(files as never, stack.importsByFile ?? {}, specToTool(stack.tools ?? []));
    for (const [f, ir] of Object.entries(files)) {
      const m = new Map<string, Node>();
      for (const n of ir.nodes ?? []) m.set(n.id, n);
      this.byId.set(f, m);
      for (const n of ir.nodes ?? []) {
        if (n.parentId && !String(n.parentId).endsWith(".class")) continue;
        const toolType = (t?: string | null) => { if (!t) return false; const r = this.resolver.resolveType(t, f); return !!r && "tool" in r; };
        if (n.type === "function_def" && !n.parentId && toolType(n.returns)) this.makers.add(`${f}::${n.name}`);
        if (n.type === "function_def" && n.parentId && toolType(n.returns)) {
          const cls = m.get(n.parentId) ?? (ir.nodes ?? []).find((x) => x.id === n.parentId);
          if (cls?.name) this.makers.add(`${f}::${cls.name}`);
        }
      }
    }
  }

  private node(file: string, id?: string | null) { return id ? this.byId.get(file)?.get(id) : undefined; }

  /** Is this callee (as written in `file`) a client maker? */
  private isMaker(file: string, callee: string): boolean {
    const name = callee.replace(/^new\s+/, "").split(".").pop() ?? "";
    if (this.makers.has(`${file}::${name}`)) return true;
    for (const imp of (this.files[file]?.nodes ?? []).filter((n) => n.type === "import_from")) {
      if (!(imp.names ?? []).some((x) => x === name || x.endsWith(` as ${name}`))) continue;
      const target = this.resolver.projectFile(file, { binding: name, spec: imp.module ?? "", project: true } as Binding);
      if (target && this.makers.has(`${target}::${name}`)) return true;
    }
    return false;
  }

  /** Env assignments a launch of `entry` makes: package.json scripts, and its header comment. */
  launchEnv(entry: string): Record<string, { value: string; cite: string }> {
    if (this.launchMemo.has(entry)) return this.launchMemo.get(entry)!;
    const out: Record<string, { value: string; cite: string }> = {};
    const base = path.basename(entry);
    if (this.root) {
      try {
        const lines = fs.readFileSync(path.join(this.root, entry), "utf-8").split("\n").slice(0, 30);
        lines.forEach((l, i) => {
          if (!/^\s*(\/\/|#|\*)/.test(l) || !l.includes(base.replace(/\.[^.]+$/, ""))) return;
          for (const m of l.matchAll(/\b([A-Z_][A-Z0-9_]*)=([^\s'"]+)/g)) out[m[1]] ??= { value: m[2], cite: `${entry}:${i + 1} (a documented launch line — a comment, not enforced)` };
        });
      } catch { /* unreadable */ }
      for (let dir = path.dirname(entry); ; dir = path.dirname(dir)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(this.root, dir, "package.json"), "utf-8"));
          for (const [name, cmd] of Object.entries(pkg.scripts ?? {}) as Array<[string, string]>) {
            if (!cmd.includes(path.relative(dir, entry)) && !cmd.includes(base)) continue;
            for (const m of cmd.matchAll(/\b([A-Z_][A-Z0-9_]*)=([^\s'"]+)/g)) out[m[1]] = { value: m[2], cite: `${path.join(dir, "package.json")} script "${name}"` };
          }
        } catch { /* no manifest here */ }
        if (dir === "." || dir === "/" || dir === "") break;
      }
    }
    this.launchMemo.set(entry, out);
    return out;
  }

  /** The identity a maker's first argument names, read where the call is written. */
  private argIdentity(file: string, at: Node, text: string, entry: string | null, depth = 0): IdentityAnswer | null {
    if (depth > 4) return null;
    const t = text.replace(/!$/, "").trim();
    const l = lit(t);
    if (l !== null) return { identity: { id: stem(l), source: l, cite: `${file}:${at.line}` } };
    const e = envDefault(t);
    if (e) {
      const launch = entry ? this.launchEnv(entry)[e.env] : undefined;
      return launch
        ? { identity: { id: stem(launch.value), source: `${launch.value} via ${e.env}`, env: e.env, cite: launch.cite } }
        : { identity: { id: stem(e.value), source: `${e.value} (the default of ${e.env})`, env: e.env, cite: `${file}:${at.line}` } };
    }
    const member = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(t);
    const fn = this.enclosingFn(file, at);
    const root = member?.[1] ?? (/^[A-Za-z_$][\w$]*$/.test(t) ? t : null);
    if (!root) return null;
    // a loop variable or a parameter: one identity per item
    if (fn && (fn.params ?? []).some((p) => String(p).split(/[?:=\s]/)[0] === root)) return { many: `${t} (a parameter of ${fn.name}, at ${file}:${at.line})` };
    if (this.inLoopOver(file, at, root)) return { many: `${t} (per item of a loop, at ${file}:${at.line})` };
    // a settings object's field: `settings.configPath` → its property's value
    if (member) {
      const obj = this.objectProp(file, member[1], member[2]);
      if (obj) return this.argIdentity(obj.file, obj.node, obj.value, entry, depth + 1);
    }
    const bound = (this.files[file]?.nodes ?? []).filter((n) => n.type === "assignment" && n.name === root && (n.line ?? 0) <= (at.line ?? 0)).sort((a, b) => (b.line ?? 0) - (a.line ?? 0))[0];
    if (bound?.preview) return this.argIdentity(file, bound, bound.preview, entry, depth + 1);
    return null;
  }

  private enclosingFn(file: string, n: Node): Node | undefined {
    let p = this.node(file, n.parentId);
    while (p && p.type !== "function_def") p = this.node(file, p.parentId);
    return p;
  }

  private inLoopOver(file: string, n: Node, name: string): boolean {
    let p = this.node(file, n.parentId);
    while (p) {
      if (p.type === "for_loop" && new RegExp(`\\b${name}\\b`).test(JSON.stringify([(p as any).target, (p as any).iter, (p as any).iterName, (p as any).header, (p as any).preview]))) return true;
      p = this.node(file, p.parentId);
    }
    return false;
  }

  /** `settings.configPath` → the value text of `configPath` in the object `settings` holds (here or imported). */
  private objectProp(file: string, obj: string, key: string): { file: string; node: Node; value: string } | null {
    const look = (f: string) => {
      const a = (this.files[f]?.nodes ?? []).find((n) => n.type === "assignment" && n.name === obj && !n.parentId && n.objectProps);
      const p = a?.objectProps?.find((x) => x.key === key && x.value);
      return a && p ? { file: f, node: a, value: p.value! } : null;
    };
    const here = look(file);
    if (here) return here;
    for (const imp of (this.files[file]?.nodes ?? []).filter((n) => n.type === "import_from")) {
      if (!(imp.names ?? []).some((x) => x === obj || x.endsWith(` as ${obj}`))) continue;
      const target = this.resolver.projectFile(file, { binding: obj, spec: imp.module ?? "", project: true } as Binding);
      const hit = target ? look(target) : null;
      if (hit) return hit;
    }
    return null;
  }

  /** Every client an entry point's own file makes, and the identities they name. */
  entryIdentities(entry: string): { identities: Identity[]; many: string[] } {
    const identities: Identity[] = [];
    const many: string[] = [];
    for (const n of this.files[entry]?.nodes ?? []) {
      const callee = String(n.funcName ?? n.callTarget ?? "");
      if (!callee || !this.isMaker(entry, callee) || !n.args?.length) continue;
      const a = this.argIdentity(entry, n, n.args[0], entry);
      if (a?.identity && !identities.some((x) => x.id === a.identity!.id)) identities.push(a.identity);
      if (a?.many) many.push(a.many);
    }
    return { identities, many };
  }

  /** The identity a write at file:line goes through: its receiver, followed back to the client it wraps. */
  siteIdentity(file: string, line: number, entry: string | null): IdentityAnswer | null {
    const nodes = this.files[file]?.nodes ?? [];
    const op = nodes.find((n) => n.line === line && (n.funcName || n.callTarget));
    if (!op) return null;
    let root = /^[\s(]*(?:await\s+)?(?:new\s+)?([A-Za-z_$][\w$]*)/.exec(String(op.funcName ?? op.callTarget))?.[1];
    let at: Node = op;
    for (let hop = 0; root && hop < 5; hop++) {
      const bound = nodes.filter((n) => n.type === "assignment" && n.name === root && (n.line ?? 0) <= (at.line ?? 0)).sort((a, b) => (b.line ?? 0) - (a.line ?? 0))[0];
      const ctor = bound?.callTarget ?? null;
      if (!bound || !ctor) return null;
      if (this.isMaker(file, ctor) && bound.args?.length) return this.argIdentity(file, bound, bound.args[0], entry);
      // a wrapper built around another local (`new Store(boundaries)`): follow its first local argument
      const next = (bound.args ?? []).map((x) => x.trim()).find((x) => /^[A-Za-z_$][\w$]*$/.test(x) && nodes.some((n) => n.type === "assignment" && n.name === x));
      root = next;
      at = bound;
    }
    return null;
  }
}
