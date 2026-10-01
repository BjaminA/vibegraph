// WORKSPACE PACKAGES by name (2026-10-01). In a multi-package repository an
// app imports its sibling by NAME — `import { classify } from "@acme/rules"`
// — and that was read as a third-party package: the linker never followed it
// (every thread stopped at the package boundary) and the stack index listed
// the project's own package as a dependency. A workspace package is project
// code by construction, so the parser resolves it the way it resolves a
// tsconfig alias: into the `aliasTarget` fact the linker, the stack index and
// the import graph already read. One implementation: src/server/import_graph.ts
// enumerates packages through this file too.
//
// Resolution, nothing guessed past it:
//   - the workspace root is the nearest ancestor with a package.json that has
//     `workspaces`, or a pnpm-workspace.yaml (else the analysed root itself);
//   - every package.json under it (depth 4, never node_modules) gives a name
//     and a folder;
//   - `@acme/rules` → that folder's entry: `source`, `types`, `module`,
//     `main`, `exports["."]`, each mapped from build output back to the
//     source it was built from (dist/build/lib/out → src, .js/.d.ts → .ts),
//     then src/index, then index; `@acme/rules/sub` → `exports["./sub"]`,
//     src/sub, sub. Every candidate is PROBED on disk: a name that maps to
//     nothing that exists stays unresolved.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".vibegraph", "target", "__pycache__", ".venv", "venv", "coverage"]);
const EXT = ["", ".ts", ".tsx", ".mts", ".cts", "/index.ts", "/index.tsx", ".js", ".mjs", ".jsx", "/index.js"];
const cache = new Map();

/** Every package.json `name` under a folder (depth 4), with its folder relative to `base`. */
export function workspacePackages(base, under = "") {
  const out = [];
  const walk = (rel, depth) => {
    try {
      const j = JSON.parse(readFileSync(join(base, rel, "package.json"), "utf-8"));
      if (typeof j.name === "string" && j.name) out.push({ dir: rel, name: j.name, manifest: j });
    } catch { /* no manifest, or unreadable: nothing to name */ }
    if (depth >= 4) return;
    let ents = [];
    try { ents = readdirSync(join(base, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith(".")) walk(rel ? `${rel}/${e.name}` : e.name, depth + 1);
  };
  walk(under, 0);
  return out;
}

/** The workspace root above a file: an ancestor declaring workspaces; else "". */
function workspaceRoot(relFile, base) {
  let dir = posix.dirname(relFile);
  for (;;) {
    const at = (p) => join(base, dir === "." ? "" : dir, p);
    try {
      if (existsSync(at("pnpm-workspace.yaml"))) return dir === "." ? "" : dir;
      const j = JSON.parse(readFileSync(at("package.json"), "utf-8"));
      if (j.workspaces) return dir === "." ? "" : dir;
    } catch { /* keep walking */ }
    if (dir === "." || dir === "" || dir === "/") return "";
    dir = posix.dirname(dir);
  }
}

function packagesOf(root, base) {
  const key = `${base}\u0000${root}`;
  if (!cache.has(key)) cache.set(key, workspacePackages(base, root));
  return cache.get(key);
}

const toSource = (p) => {
  let s = p.replace(/^\.\//, "");
  s = s.replace(/^(dist|build|lib|out)\//, "src/").replace(/\.d\.ts$/, ".ts").replace(/\.(mjs|cjs|js|jsx)$/, ".ts");
  return s;
};

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

function firstExisting(base, cands) {
  for (const c of cands) {
    if (!c) continue;
    for (const e of EXT) if (isFile(join(base, c + e))) return c + e;
  }
  return null;
}

/** `@acme/rules[/sub]` → the project-relative source file it means, or null. */
export function resolveWorkspaceTarget(spec, relFile, base) {
  if (!spec || spec.startsWith(".") || spec.startsWith("/")) return null;
  const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  const pkg = packagesOf(workspaceRoot(relFile, base), base).find((p) => p.name === name);
  if (!pkg) return null;
  const sub = spec.slice(name.length).replace(/^\//, "");
  const m = pkg.manifest ?? {};
  const dir = pkg.dir ? `${pkg.dir}/` : "";
  const exp = (key) => {
    const e = typeof m.exports === "string" && key === "." ? m.exports : m.exports?.[key];
    if (typeof e === "string") return [e];
    return e && typeof e === "object" ? [e.source, e.types, e.import, e.default, e.require].filter((x) => typeof x === "string") : [];
  };
  const fields = sub
    ? [...exp(`./${sub}`), `src/${sub}`, sub]
    : [m.source, m.types, m.typings, m.module, m.main, ...exp("."), "src/index", "index"].filter((x) => typeof x === "string");
  return firstExisting(base, fields.map((f) => `${dir}${toSource(f)}`).flatMap((c) => [c.replace(/\.ts$/, ""), c]));
}

/** Test seam: the package cache is per process. */
export function _clearWorkspaceCache() { cache.clear(); }
