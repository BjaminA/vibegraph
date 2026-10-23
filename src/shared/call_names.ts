// A CALL'S FULL NAME through its file's imports (2026-10-22, the root-cause
// handoff RC4: "compute wraps from the funnel's calls, with full dotted names").
// A call is written as its file imported it: `urlopen(…)` after `from
// urllib.request import urlopen`, `rq.post(…)` after `import requests as rq`.
// A check on `urllib.request.urlopen` and a funnel's list of what it calls must
// both mean the function, whatever the spelling. Webview-safe, pure.

interface ImportNodeLike { type?: string; names?: unknown; module?: unknown }

/** `urlopen` → `urllib.request.urlopen`, `rq.post` → `requests.post`; null for
 *  a call through no import (a local, a builtin, a project function). */
export function fullCallName(callee: string, nodes: ReadonlyArray<ImportNodeLike>): string | null {
  const c = callee.trim().replace(/\(.*$/, "");
  const head = c.split(".")[0];
  if (!head) return null;
  const rest = c.slice(head.length);
  for (const n of nodes) {
    const names = Array.isArray(n.names) ? n.names.filter((x): x is string => typeof x === "string") : [];
    if (n.type === "import") {
      for (const entry of names) {
        const [spec, alias] = entry.split(" as ").map((s) => s.trim());
        if (alias ? alias === head : spec.split(".")[0] === head) return alias ? `${spec}${rest}` : c;
      }
    } else if (n.type === "import_from" && typeof n.module === "string" && n.module) {
      for (const entry of names) {
        const [name, alias] = entry.split(" as ").map((s) => s.trim());
        if ((alias ?? name) !== head) continue;
        // a default or namespace import binds the module itself
        return name === "default" || name === "*" ? `${n.module}${rest}` : `${n.module}.${name}${rest}`;
      }
    }
  }
  return null;
}

/** The package a full call name belongs to: its first segment, or a scoped
 *  npm package's two (`@scope/pkg.fn` → `@scope/pkg`). */
export function packageOfCall(full: string): string {
  if (full.startsWith("@")) { const [scope, rest = ""] = full.split("/"); return `${scope}/${rest.split(".")[0]}`; }
  return full.split(".")[0].replace(/^node:/, "");
}
