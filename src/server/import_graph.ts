// The project's IMPORT GRAPH, file to file (2026-10-01). Three plan checks
// need the same answer — which project file does this import reach, and on
// which line — so it is answered once: a planned STORE reached through a
// project folder, a planned MODULE's members, and a LAYER rule ("module M may
// import only …"). Read from the IR's import nodes, never from source text.
//
// Resolution, in order, and nothing guessed past it:
//   - a tsconfig alias the parser already resolved (`aliasTarget`);
//   - a relative specifier, probed with the extensions the linker probes;
//   - a WORKSPACE package by name (`@acme/store-client`, `@acme/x/sub`) →
//     its folder, read from that folder's package.json `name`;
//   - a Python dotted module, matched against each file's `modulePath`.
// Anything else is EXTERNAL (third-party or standard): `to` null, `pkg` its
// package name. An import the IR does not record is not in the graph — said
// in IMPORT_GRAPH_LIMITS.

import * as path from "path";
import { workspacePackages as wsPackages } from "../../scripts/frontends/jsts/workspace.mjs";

export const IMPORT_GRAPH_LIMITS = [
  "imports are read from the IR's import nodes: a dynamic `import()` / `require` of a computed path, and an import the parser could not read, are not in the graph",
];

export interface ImportEdge {
  from: string;
  /** the project file it resolves to; null = external */
  to: string | null;
  /** the workspace package folder it resolves into, when it went by package name */
  workspace?: string;
  /** the external package's name (`yjs`, `@acme/sdk`), when `to` is null */
  pkg?: string;
  spec: string;
  line: number;
}

export interface WorkspacePackage { dir: string; name: string }

/** Every package.json `name` under the root (depth 4), with its folder —
 *  the parser's own enumeration (workspace.mjs), so the two never disagree. */
export function workspacePackages(absRoot: string): WorkspacePackage[] {
  return wsPackages(absRoot).map((p: { dir: string; name: string }) => ({ dir: p.dir, name: p.name }));
}

const EXTS = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js", ".py", "/__init__.py"];
const norm = (p: string) => {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop(); else out.push(seg);
  }
  return out.join("/");
};
function probe(base: string, files: Set<string>): string | null {
  for (const e of EXTS) if (files.has(base + e)) return base + e;
  const ts = base.replace(/\.[cm]?js$/, ".ts");
  return ts !== base && files.has(ts) ? ts : null;
}
const pkgNameOf = (spec: string) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

export function importGraph(files: Record<string, any>, packages: WorkspacePackage[] = []): ImportEdge[] {
  const set = new Set(Object.keys(files));
  const byModule = new Map<string, string>();
  for (const [f, ir] of Object.entries(files)) if (typeof ir?.modulePath === "string") byModule.set(ir.modulePath, f);
  const byPkg = new Map(packages.map((p) => [p.name, p.dir]));
  const edges: ImportEdge[] = [];
  for (const [file, ir] of Object.entries(files)) {
    const python = file.endsWith(".py");
    for (const n of (ir?.nodes ?? []) as any[]) {
      if (n.type !== "import_from" && n.type !== "import") continue;
      if (n.reexport && !n.module) continue;
      const specs: string[] = n.type === "import" && !n.module ? (n.names ?? []).map((x: string) => String(x).split(" as ")[0]) : [String(n.module ?? "")];
      for (const spec of specs) {
        if (!spec) continue;
        const line = Number(n.line) || 0;
        if (n.aliasTarget && set.has(n.aliasTarget)) { edges.push({ from: file, to: n.aliasTarget, spec, line }); continue; }
        if (!python && (spec.startsWith("./") || spec.startsWith("../"))) {
          const to = probe(norm(`${path.posix.dirname(file)}/${spec}`), set);
          edges.push(to ? { from: file, to, spec, line } : { from: file, to: null, spec, line, pkg: spec });
          continue;
        }
        if (python) {
          // `from pkg import mod` may name a submodule; the dotted module itself otherwise.
          const cands = [...(n.names ?? []).map((x: string) => `${spec}.${String(x).split(" as ")[0]}`), spec];
          const to = cands.map((c) => byModule.get(c)).find(Boolean) ?? null;
          edges.push(to ? { from: file, to, spec, line } : { from: file, to: null, spec, line, pkg: spec.split(".")[0] });
          continue;
        }
        const name = pkgNameOf(spec);
        const dir = byPkg.get(name);
        if (dir !== undefined) {
          const sub = spec.slice(name.length).replace(/^\//, "");
          const base = dir ? `${dir}/` : "";
          const to = (sub ? probe(`${base}src/${sub}`, set) ?? probe(`${base}${sub}`, set) : null)
            ?? probe(`${base}src/index`, set) ?? probe(`${base}index`, set);
          edges.push({ from: file, to, workspace: dir, spec, line });
          continue;
        }
        edges.push({ from: file, to: null, spec, line, pkg: name });
      }
    }
  }
  return edges;
}

/** Does this edge land in (a file under) the folder? */
export function edgeInto(e: ImportEdge, folder: string): boolean {
  const pre = folder.replace(/^\.\//, "").replace(/\/?$/, "/");
  return (e.to !== null && e.to.startsWith(pre)) || (e.workspace !== undefined && `${e.workspace}/`.startsWith(pre));
}
