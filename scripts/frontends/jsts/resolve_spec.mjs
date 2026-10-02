// Where a JS/TS import specifier points inside the project (extracted from
// link_jsts.mjs on 2026-10-02 so readers outside the linker — the injection
// index, the data architecture — can resolve imports without importing the
// linker's stdin entry point, which the CommonJS server bundle cannot hold).

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
export function resolveSpecifier(fromFile, spec, files, aliasTarget) {
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
