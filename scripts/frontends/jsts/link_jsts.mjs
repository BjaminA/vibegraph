#!/usr/bin/env node
// M-LANG3 (PLAN-M-LANG.md) — the JS/TS cross-file linker. Speaks
// cross_file_link.py's stdin/stdout contract over JSTS per-file IRs:
//   stdin {files: {path: IR}} → stdout {files: {…}}.  IDEMPOTENT.
//
// Resolution, per file:
//   1. import_from nodes with RELATIVE specifiers ("./db", "../x")
//      resolve with extension probing (.ts/.tsx/.js/.jsx + /index.*)
//      against the map keys (absolute or relative — leading "/" is
//      preserved; the bash linker's normalize() bug taught that).
//      Bare specifiers ("express", "node:fs") are external: no link.
//   2. Every call-shaped node (call.funcName / assignment.callTarget /
//      return_stmt.callTarget) whose BARE name is an imported binding
//      that names a function in the resolved file gains a reference
//      edge {targetFile, qualifiedTarget: "<moduleId>:<name>"}.
//
//   3. (2026-09-30) RE-EXPORTS are followed — `export { x } from`, renamed,
//      `export *` — up to REEXPORT_HOPS, cycle-safe; two `export *` offering
//      one name link to neither (JS makes it undefined). And CLASS INSTANCES:
//      `const w = new C(); w.m()` and a parameter typed `w: C` link to C.m —
//      a name assigned twice, a type some project class extends, and
//      `this.m()` stay unlinked (which m runs is decided at run time).
//
// NAMED LIMITS: namespace-member calls (`import * as ns`, `export * as ns`)
// don't link; an inherited method (defined on a base class) doesn't link;
// no subprocess-style default — an unresolved JS identifier is a genuine gap
// (`unresolved`), unlike bash where an unresolved bare word IS an external
// command.

import { injectionIndex } from "../injection_index.mjs";
import { resolveSpecifier } from "./resolve_spec.mjs";

export { resolveSpecifier };

const REEXPORT_HOPS = 5;

export function linkFiles(files) {
  const fnIndex = new Map(); // path → Map(fnName → nodeId)
  const classIndex = new Map(); // path → Map(className → { id, methods: Map(name → nodeId) })
  const reexports = new Map(); // path → [{ target, names }]
  const subclassed = new Set(); // class NAMES some project class extends
  for (const [rel, ir] of Object.entries(files)) {
    const m = new Map();
    const classes = new Map();
    for (const n of ir.nodes ?? []) {
      if (n.type === "function_def" && n.parentId === null) {
        m.set(n.name, n.id);
        // M-FLOW.5 — `import X from "./f"` binds X to f's DEFAULT export,
        // whatever that function is called (the builder spells the import
        // `default as X`, so `exportedName` arrives here as "default").
        if (n.isDefaultExport && !m.has("default")) m.set("default", n.id);
      }
      if (n.type === "class_def" && n.parentId === null) {
        classes.set(n.name, { id: n.id, methods: new Map() });
        for (const b of n.bases ?? []) subclassed.add(String(b).replace(/<.*$/, "").trim());
      }
    }
    for (const n of ir.nodes ?? []) {
      if (n.type !== "function_def") continue;
      const cls = [...classes.values()].find((c) => c.id === n.parentId);
      if (cls) cls.methods.set(n.name, n.id);
    }
    fnIndex.set(rel, m);
    classIndex.set(rel, classes);
    if (ir.language === "jsts") {
      const list = [];
      for (const n of ir.nodes ?? []) {
        if (n.type !== "import_from" || !n.reexport) continue;
        const target = resolveSpecifier(rel, n.module ?? "", files, n.aliasTarget);
        if (target) list.push({ target, names: n.names ?? [] });
      }
      reexports.set(rel, list);
    }
  }

  // 2026-09-30 — follow a name through RE-EXPORTS (barrel files) to where it
  // is written: named ones first (`export { a as b } from`), then `export *`.
  // Two `export *` sources offering the same name is ambiguous — JS itself
  // makes that name undefined — so nothing is linked, never a guess. Bounded
  // hops, cycle-safe. → { kind: "fn"|"class", file, id | cls } or null.
  function resolveExport(file, name, depth = 0, seen = new Set()) {
    const key = `${file}::${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const fn = fnIndex.get(file)?.get(name);
    if (fn) return { kind: "fn", file, id: fn };
    const cls = classIndex.get(file)?.get(name);
    if (cls) return { kind: "class", file, cls };
    if (depth >= REEXPORT_HOPS) return null;
    const stars = [];
    for (const r of reexports.get(file) ?? []) {
      for (const raw of r.names) {
        if (raw === "*") { stars.push(r.target); continue; }
        if (raw.startsWith("* as ")) continue; // a namespace object: NAMED LIMIT
        const [orig, alias] = raw.includes(" as ") ? raw.split(" as ").map((s) => s.trim()) : [raw.trim(), raw.trim()];
        if (alias === name) return resolveExport(r.target, orig, depth + 1, seen);
      }
    }
    const found = stars.map((t) => resolveExport(t, name, depth + 1, new Set(seen))).filter(Boolean);
    return found.length === 1 ? found[0] : null;
  }

  for (const [rel, ir] of Object.entries(files)) {
    if (ir.language !== "jsts") continue; // frontend isolation
    const nodes = ir.nodes ?? [];
    const edges = ir.edges ?? [];

    // localName → {file, exportedName}
    const bindings = new Map();
    for (const n of nodes) {
      if (n.type !== "import_from" || n.reexport) continue; // a re-export binds no local name
      const target = resolveSpecifier(rel, n.module ?? "", files, n.aliasTarget);
      if (!target) continue;
      for (const raw of n.names ?? []) {
        if (raw.startsWith("* as ")) continue; // namespace: NAMED LIMIT
        const [exported, local] = raw.includes(" as ")
          ? raw.split(" as ").map((s) => s.trim())
          : [raw.trim(), raw.trim()];
        bindings.set(local, { file: target, exportedName: exported });
      }
    }

    // 2026-09-29 — `const { a, b: c } = await import("./x")`: the dynamic
    // form `vi.resetModules()` forces in tests (a private production codebase: 263 of them, 185
    // into project files). A name bound twice to different targets, or also
    // bound statically, is refused: the file does not say which one runs.
    const dynamicBound = new Map();
    const refused = new Set();
    for (const n of nodes) {
      if (n.type !== "assignment" || n.callTarget !== "import") continue;
      const m = /^\s*(["'`])([^"'`$]*)\1\s*$/.exec(n.args?.[0] ?? "");
      const pattern = /^\s*\{([^}]*)\}\s*$/.exec(n.name ?? "");
      if (!m || !pattern) continue;
      const target = resolveSpecifier(rel, m[2], files, n.aliasTarget);
      if (!target) continue;
      for (const part of pattern[1].split(",")) {
        const p = part.trim().replace(/\s*=.*$/, "");
        if (!p || p.startsWith("...")) continue;
        const [exported, local] = p.includes(":") ? p.split(":").map((x) => x.trim()) : [p, p];
        const prev = dynamicBound.get(local);
        if (bindings.has(local) || (prev && (prev.file !== target || prev.exportedName !== exported))) { refused.add(local); continue; }
        dynamicBound.set(local, { file: target, exportedName: exported });
      }
    }
    for (const [local, b] of dynamicBound) if (!refused.has(local)) bindings.set(local, b);

    const hasRef = new Set(edges.filter((e) => e.type === "reference").map((e) => e.source));
    const callShapes = [];
    for (const n of nodes) {
      if (n.type === "call" && n.funcName) callShapes.push({ id: n.id, callee: n.funcName });
      else if (n.type === "assignment" && n.valueKind === "call" && n.callTarget) {
        callShapes.push({ id: n.id, callee: n.callTarget });
      } else if ((n.type === "return_stmt" || n.type === "raise_stmt") && n.callTarget) {
        callShapes.push({ id: n.id, callee: n.callTarget });
      }
    }
    const receivers = instanceReceivers(nodes);
    const classFor = (name) => {
      const local = classIndex.get(rel)?.get(name);
      if (local) return { file: rel, cls: local };
      const b = bindings.get(name);
      const r = b ? resolveExport(b.file, b.exportedName) : null;
      return r?.kind === "class" ? { file: r.file, cls: r.cls } : null;
    };
    for (const { id, callee } of callShapes) {
      if (hasRef.has(id)) continue; // idempotence + same-file pass owns those
      if (callee.includes(".")) {
        // 2026-09-30 — `writer.write()` where `writer` holds ONE instance of a
        // project class (see instanceReceivers) → that class's method.
        const parts = callee.split(".");
        if (parts.length === 3 && parts[0] === "this") {
          // 2026-10-01 — `this.codec.toJson()` inside a class whose field
          // `codec` names ONE class: declared `codec: Codec` (when nothing
          // extends Codec — a subclass instance could override toJson), or
          // assigned exactly once in the class, `this.codec = new Codec(…)`
          // (when nothing extends the OWNER — a subclass could reassign it).
          const k = fieldClass(nodes, id, parts[1], subclassed);
          const c = k ? classFor(k) : null;
          const methodId = c?.cls.methods.get(parts[2]);
          if (methodId) {
            edges.push({
              source: id, target: methodId, type: "reference", targetFile: c.file,
              qualifiedTarget: `${files[c.file].modulePath ?? c.file}:${k}.${parts[2]}`,
            });
          }
          continue;
        }
        if (parts.length !== 2 || parts[0] === "this") continue; // this.m(): a subclass may override — stays dynamic
        const recv = receiverFor(receivers, id, parts[0]);
        if (!recv || (recv.typed && subclassed.has(recv.className))) continue;
        const c = classFor(recv.className);
        const methodId = c?.cls.methods.get(parts[1]);
        if (!methodId) continue;
        edges.push({
          source: id, target: methodId, type: "reference", targetFile: c.file,
          qualifiedTarget: `${files[c.file].modulePath ?? c.file}:${recv.className}.${parts[1]}`,
        });
        continue;
      }
      const binding = bindings.get(callee);
      if (!binding) continue;
      // Through any barrel files, to where the function is written.
      const r = resolveExport(binding.file, binding.exportedName);
      if (r?.kind !== "fn") continue;
      edges.push({
        source: id,
        target: r.id,
        type: "reference",
        targetFile: r.file,
        qualifiedTarget: `${files[r.file].modulePath ?? r.file}:${binding.exportedName}`,
      });
    }
  }
  linkInjections(files);
  return files;
}

/** 2026-10-02 — calls through a parameter typed by an interface reach every
 *  production implementation of the member (scripts/frontends/injection_index.mjs),
 *  marked `viaInjection` with the interface's name. Test fakes are not linked. */
function linkInjections(files) {
  const jsts = Object.fromEntries(Object.entries(files).filter(([, ir]) => ir.language === "jsts"));
  const { entries } = injectionIndex(jsts, (from, imp) => resolveSpecifier(from, imp.module ?? "", files, imp.aliasTarget));
  for (const e of entries) {
    for (const c of e.calls) {
      const ir = files[c.file];
      if (!ir) continue;
      ir.edges ??= [];
      for (const impl of e.implementations) {
        if (impl.test || !impl.id || impl.structural) continue; // a structural match is reported, never walked
        if (ir.edges.some((x) => x.source === c.id && x.target === impl.id)) continue;
        ir.edges.push({
          source: c.id, target: impl.id, type: "reference", targetFile: impl.file, viaInjection: e.iface,
          qualifiedTarget: `${files[impl.file].modulePath ?? impl.file}:${e.iface}.${e.property}`,
        });
      }
    }
  }
}

/** The function scope a node sits in (its id up to the last `.fn`), or "module". */
function scopeOf(id) {
  const segs = id.split("/");
  for (let k = segs.length - 2; k >= 0; k--) if (segs[k].endsWith(".fn")) return segs.slice(0, k + 1).join("/");
  return "module";
}

/** 2026-09-30 — names that hold an instance of a class, per function scope:
 *  `const w = new Writer(…)` assigned ONCE in that scope (assigned twice, the
 *  file does not say which instance a call reaches — refused), and a
 *  parameter typed as a class (`w: Writer`; used only when no project class
 *  extends it, since a subclass could override the method). → Map(scope →
 *  Map(name → { className, typed } | null)), null = refused. */
function instanceReceivers(nodes) {
  const byScope = new Map();
  const put = (scope, name, v) => {
    if (!byScope.has(scope)) byScope.set(scope, new Map());
    const m = byScope.get(scope);
    m.set(name, m.has(name) ? null : v);
  };
  for (const n of nodes) {
    if (n.type === "assignment" && typeof n.name === "string" && /^\w+$/.test(n.name)) {
      const isNew = n.valueKind === "call" && /^new\s/.test(n.preview ?? "") && typeof n.callTarget === "string" && /^[A-Za-z_$][\w$]*$/.test(n.callTarget);
      put(scopeOf(n.id), n.name, isNew ? { className: n.callTarget, typed: false } : null);
    }
    if (n.type === "function_def") {
      for (const p of n.params ?? []) {
        const m = /^(\w+)\??\s*:\s*([A-Za-z_$][\w$]*)$/.exec(String(p).trim());
        if (m) put(n.id, m[1], { className: m[2], typed: true });
      }
    }
  }
  return byScope;
}

/** The class a `this.<field>` holds, for a call inside a class (see the call
 *  site), or null when the class does not pin it down. */
function fieldClass(nodes, callId, field, subclassed) {
  const segs = callId.split("/");
  const k = segs.findIndex((s) => s.endsWith(".class"));
  if (k < 0) return null;
  const ownerId = segs.slice(0, k + 1).join("/");
  const owner = nodes.find((n) => n.id === ownerId && n.type === "class_def");
  if (!owner) return null;
  const declared = owner.fieldTypes?.[field];
  if (declared) return subclassed.has(declared) ? null : declared;
  if (subclassed.has(owner.name)) return null;
  const sets = nodes.filter((n) => n.type === "assignment" && n.name === `this.${field}` && n.id.startsWith(`${ownerId}/`));
  if (sets.length !== 1) return null;
  const s = sets[0];
  const isNew = s.valueKind === "call" && /^new\s/.test(s.preview ?? "") && /^[A-Za-z_$][\w$]*$/.test(s.callTarget ?? "");
  return isNew ? s.callTarget : null;
}

/** The receiver a call's name refers to: its own scope first, then the
 *  enclosing ones, out to the module. */
function receiverFor(byScope, id, name) {
  let scope = scopeOf(id);
  for (;;) {
    const m = byScope.get(scope);
    if (m?.has(name)) return m.get(name);
    if (scope === "module") return null;
    scope = scopeOf(scope);
  }
}

// Main guard by this file's NAME: the pipeline imports linkFiles in-process,
// and inside the packaged bundle import.meta.url IS argv[1].
if (process.argv[1] && /link_jsts\.mjs$/.test(process.argv[1])) {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) raw += chunk;
  const { files } = JSON.parse(raw);
  process.stdout.write(JSON.stringify({ files: linkFiles(files ?? {}) }));
}
