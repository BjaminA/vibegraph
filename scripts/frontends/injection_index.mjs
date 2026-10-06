// INJECTED CAPABILITIES (2026-10-02, module 4). Pure logic often receives its
// I/O as an object: `handle(req, deps: Deps)` calls `deps.writeStatus(...)`,
// and the object that does the writing is built in another package —
// `function depsOnStore(...): Deps { return { writeStatus: async (...) => … } }`.
// Static linking stopped at `deps.writeStatus`: a call through a parameter
// typed by an interface reaches nothing.
//
// The rule, over IR facts only:
//   an INTERFACE    a TS `interface` with its member names, or a Python class
//                   based on Protocol / ABC with its methods;
//   an IMPLEMENTATION  an object literal a function returns when its declared
//                   return type is the interface, an object literal held by a
//                   constant typed (or `satisfies`) as it, or a class that names
//                   it as a base — each member function by name;
//   a CALL          `p.member(...)` where `p` is a parameter typed as the
//                   interface and `member` is one of its members.
// A call links to every implementation; test files' implementations are
// counted apart (fakes), never walked. Member values that are not functions
// (`readRecords: o.readRecords`) are FORWARDED: recorded, not linked.
//
// One module, two readers: the TS linker adds `viaInjection` reference edges
// from it (so threads walk into the implementation), and the data architecture
// reports it. Plain JS: it runs vendored, outside any TS loader.

/** The repository's test-path rule (src/shared/path_match.ts isTestFile). */
export function isTestPath(path) {
  const segs = path.split("/");
  const base = segs[segs.length - 1] ?? "";
  return segs.slice(0, -1).some((s) => s === "test" || s === "tests" || s === "__tests__")
    || /^test_/.test(base) || /\.(test|spec)\.[A-Za-z]+$/.test(base) || /_test\.[A-Za-z]+$/.test(base);
}

const PROTOCOL_BASES = /^(typing\.)?(Protocol|ABC|abc\.ABC)(\[.*\])?$/;
const bare = (t) => String(t ?? "").replace(/^Promise<(.*)>$/s, "$1").split("|")[0].trim().replace(/<.*>$/s, "").replace(/^Optional\[(.*)\]$/, "$1").trim();

/** `resolveImport(fromFile, importNode) → project file | null` is supplied by the caller. */
export function injectionIndex(files, resolveImport) {
  // 1. interfaces
  const ifaces = new Map(); // `${file}::${name}` → { file, name, line, members: Set }
  for (const [file, ir] of Object.entries(files)) {
    const nodes = ir.nodes ?? [];
    for (const n of nodes) {
      if (n.parentId) continue;
      if (n.type === "interface_def" && n.members?.length) ifaces.set(`${file}::${n.name}`, { file, name: n.name, line: n.line, members: new Set(n.members), optional: new Set(n.optionalMembers ?? []) });
      if (n.type === "class_def" && (n.bases ?? []).some((b) => PROTOCOL_BASES.test(String(b).trim()))) {
        const members = nodes.filter((m) => m.type === "function_def" && m.parentId === n.id && !/^__.*__$/.test(m.name)).map((m) => m.name);
        if (members.length) ifaces.set(`${file}::${n.name}`, { file, name: n.name, line: n.line, members: new Set(members), optional: new Set(), protocol: true });
      }
    }
  }
  if (!ifaces.size) return { interfaces: [], entries: [] };

  // a type name written in a file → the interface it names, through one import
  const importsOf = new Map();
  const ifaceOf = (file, typeText) => {
    const name = bare(typeText);
    if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
    if (ifaces.has(`${file}::${name}`)) return ifaces.get(`${file}::${name}`);
    if (!importsOf.has(file)) importsOf.set(file, (files[file]?.nodes ?? []).filter((n) => n.type === "import_from" || n.type === "import"));
    for (const imp of importsOf.get(file)) {
      for (const raw of imp.names ?? []) {
        const [orig, local] = raw.includes(" as ") ? raw.split(" as ").map((s) => s.trim()) : [raw.trim(), raw.trim()];
        if (local !== name) continue;
        const target = resolveImport(file, imp);
        if (target && ifaces.has(`${target}::${orig}`)) return ifaces.get(`${target}::${orig}`);
      }
    }
    return null;
  };

  // 2. implementations
  const impls = new Map(); // iface key → [{ member, file, line, id|null, value?, test }]
  const add = (iface, impl) => { const k = `${iface.file}::${iface.name}`; if (!impls.has(k)) impls.set(k, []); impls.get(k).push(impl); };
  for (const [file, ir] of Object.entries(files)) {
    const nodes = ir.nodes ?? [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const test = isTestPath(file);
    const fnAt = (key, line) => nodes.find((n) => n.type === "function_def" && n.name === key && Math.abs((n.line ?? 0) - line) <= 1);
    const fromObject = (iface, props) => {
      for (const p of props ?? []) {
        if (!iface.members.has(p.key)) continue;
        const fn = p.fn ? fnAt(p.key, p.line) : null;
        add(iface, { member: p.key, file, line: p.line, id: fn?.id ?? null, ...(p.fn ? {} : { value: p.value }), test });
      }
    };
    for (const n of nodes) {
      if (n.type === "return_stmt" && n.objectProps) {
        let fn = byId.get(n.parentId);
        while (fn && fn.type !== "function_def") fn = byId.get(fn.parentId);
        const iface = fn?.returns ? ifaceOf(file, fn.returns) : null;
        if (iface) fromObject(iface, n.objectProps);
      } else if (n.type === "assignment" && n.objectProps) {
        // 2026-10-06 — `let ops: Ops | undefined;` then `ops = { … }`: the
        // object takes the type its name was DECLARED with in the same scope
        const scope = (x) => { let p = byId.get(x.parentId); while (p && p.type !== "function_def") p = byId.get(p.parentId); return p?.id ?? null; };
        const annotation = n.annotation ?? nodes.find((d) => d !== n && d.type === "assignment" && d.name === n.name && d.annotation && scope(d) === scope(n))?.annotation;
        const iface = annotation ? ifaceOf(file, annotation) : null;
        if (iface) fromObject(iface, n.objectProps);
      } else if (n.type === "class_def") {
        for (const b of n.bases ?? []) {
          const iface = ifaceOf(file, b);
          if (!iface || (iface.file === file && iface.name === n.name)) continue;
          for (const m of nodes.filter((x) => x.type === "function_def" && x.parentId === n.id && iface.members.has(x.name))) {
            add(iface, { member: m.name, file, line: m.line, id: m.id, test });
          }
        }
      }
    }
  }

  // 2b. STRUCTURAL implementations (2026-10-02, M5): a class with every required
  // member of an interface implements it, with or without saying so. Marked
  // `structural` — a name match, weaker than a declaration — and never linked
  // into threads; it only stops "nothing implements it" from being false.
  for (const iface of ifaces.values()) {
    const k = `${iface.file}::${iface.name}`;
    const required = [...iface.members].filter((m) => !iface.optional.has(m));
    if (!required.length || (impls.get(k) ?? []).some((i) => !i.test)) continue;
    for (const [file, ir] of Object.entries(files)) {
      const nodes = ir.nodes ?? [];
      for (const cls of nodes.filter((n) => n.type === "class_def" && !n.parentId && !(iface.file === file && iface.name === n.name))) {
        if ((cls.bases ?? []).some((b) => PROTOCOL_BASES.test(String(b).trim()))) continue; // another interface
        const methods = nodes.filter((m) => m.type === "function_def" && m.parentId === cls.id);
        const names = new Set(methods.map((m) => m.name));
        if (!required.every((m) => names.has(m))) continue;
        for (const m of methods.filter((x) => iface.members.has(x.name))) add(iface, { member: m.name, file, line: m.line, id: m.id, test: isTestPath(file), structural: cls.name });
      }
    }
  }

  // 3. calls through a parameter typed as an interface
  const calls = new Map(); // `${ifaceKey}::${member}` → [{ file, line, id }]
  for (const [file, ir] of Object.entries(files)) {
    const nodes = ir.nodes ?? [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const paramType = (fn, name) => {
      if (fn.paramTypes?.[name]) return fn.paramTypes[name];
      for (const p of fn.params ?? []) {
        const m = /^([A-Za-z_$][\w$]*)\??\s*:\s*(.+?)(?:\s*=.*)?$/.exec(String(p).trim());
        if (m && m[1] === name) return m[2];
      }
      return null;
    };
    for (const n of nodes) {
      const callee = String(n.type === "call" ? n.funcName ?? "" : (n.callTarget ?? "")).replace(/\?\./g, ".").replace(/\?$/, "").replace(/\.$/, "");
      const parts = callee.split(".");
      if (parts.length !== 2 || parts[0] === "this" || parts[0] === "self") continue;
      let fn = byId.get(n.parentId);
      let iface = null;
      while (fn && !iface) {
        if (fn.type === "function_def") { const t = paramType(fn, parts[0]); if (t) { iface = ifaceOf(file, t); break; } }
        fn = byId.get(fn.parentId);
      }
      if (!iface || !iface.members.has(parts[1])) continue;
      const k = `${iface.file}::${iface.name}::${parts[1]}`;
      if (!calls.has(k)) calls.set(k, []);
      if (!calls.get(k).some((c) => c.id === n.id)) calls.get(k).push({ file, line: n.line, id: n.id, callee });
    }
  }

  const entries = [];
  for (const [k, cs] of calls) {
    const [file, name, member] = k.split("::");
    const all = (impls.get(`${file}::${name}`) ?? []).filter((i) => i.member === member);
    entries.push({ iface: name, ifaceFile: file, property: member, calls: cs, implementations: all });
  }
  return { interfaces: [...ifaces.values()].map((i) => ({ file: i.file, name: i.name, line: i.line, members: [...i.members] })), entries };
}
