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
// NAMED LIMITS (v1): default-import and namespace-member calls don't
// link (they classify honestly downstream); re-export chains resolve
// zero hops (the direct file only); no subprocess-style default — an
// unresolved JS identifier is a genuine gap (`unresolved`), unlike
// bash where an unresolved bare word IS an external command.

function posixDir(p) {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function normalize(p) {
  const abs = p.startsWith("/");
  const parts = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { parts.pop(); continue; }
    parts.push(seg);
  }
  return (abs ? "/" : "") + parts.join("/");
}

const PROBES = ["", ".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx",
  "/index.ts", "/index.tsx", "/index.mjs", "/index.cjs", "/index.js", "/index.jsx"];

function probeBase(base, files) {
  for (const probe of PROBES) {
    const candidate = base + probe;
    if (candidate in files) return candidate;
    // "./db.js" written for ESM output often means db.ts on disk
    if (probe === "" && /\.[cm]?js$/.test(base)) {
      const tsish = base.replace(/\.[cm]?js$/, ".ts");
      if (tsish in files) return tsish;
    }
  }
  return null;
}

/**
 * @param tsPaths the alias map the PARSER stamped onto this file's IR
 *   (M-CMD.1). A bare specifier is external UNLESS an alias claims it, and
 *   an alias that expands to nothing on disk stays external — resolution is
 *   still by what exists, never by the pattern alone.
 */
function resolveSpecifier(fromFile, spec, files, aliasTarget) {
  if (!spec.startsWith("./") && !spec.startsWith("../")) {
    // M-CMD.1 — a bare specifier is external UNLESS the PARSER already
    // resolved it through a tsconfig alias and probed it on disk.
    return aliasTarget && aliasTarget in files ? aliasTarget : null;
  }
  const dir = posixDir(fromFile);
  // Top-level relative keys have an empty dirname — joining through
  // "/" would fabricate an absolute path ("/db") that matches nothing.
  return probeBase(normalize(dir ? `${dir}/${spec}` : spec), files);
}

export function linkFiles(files) {
  const fnIndex = new Map(); // path → Map(fnName → nodeId)
  for (const [rel, ir] of Object.entries(files)) {
    const m = new Map();
    for (const n of ir.nodes ?? []) {
      if (n.type === "function_def" && n.parentId === null) {
        m.set(n.name, n.id);
        // M-FLOW.5 — `import X from "./f"` binds X to f's DEFAULT export,
        // whatever that function is called (the builder spells the import
        // `default as X`, so `exportedName` arrives here as "default").
        if (n.isDefaultExport && !m.has("default")) m.set("default", n.id);
      }
    }
    fnIndex.set(rel, m);
  }

  for (const [rel, ir] of Object.entries(files)) {
    if (ir.language !== "jsts") continue; // frontend isolation
    const nodes = ir.nodes ?? [];
    const edges = ir.edges ?? [];

    // localName → {file, exportedName}
    const bindings = new Map();
    for (const n of nodes) {
      if (n.type !== "import_from") continue;
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
    for (const { id, callee } of callShapes) {
      if (hasRef.has(id)) continue; // idempotence + same-file pass owns those
      if (callee.includes(".")) continue;
      const binding = bindings.get(callee);
      if (!binding) continue;
      const fnId = fnIndex.get(binding.file)?.get(binding.exportedName);
      if (!fnId) continue;
      edges.push({
        source: id,
        target: fnId,
        type: "reference",
        targetFile: binding.file,
        qualifiedTarget: `${files[binding.file].modulePath ?? binding.file}:${binding.exportedName}`,
      });
    }
  }
  return files;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) raw += chunk;
  const { files } = JSON.parse(raw);
  process.stdout.write(JSON.stringify({ files: linkFiles(files ?? {}) }));
}
