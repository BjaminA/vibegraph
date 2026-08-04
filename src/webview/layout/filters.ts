import type { AstNode } from "../types";
import type { NodeFilters } from "../FiltersPanel";

// ── filter pipeline (hide individual nodes + bulk filters) ───────────────────

function isDunderName(name?: string): boolean {
  if (!name) return false;
  return name.startsWith("__") && name.endsWith("__");
}

export function nodePassesFilter(n: AstNode, f: NodeFilters): boolean {
  if (!f.showImports && (n.type === "import" || n.type === "import_from")) return false;
  if (!f.showAssignments && n.type === "assignment") return false;
  if (!f.showCalls && n.type === "call") return false;
  if (!f.showReturns && (n.type === "return_stmt" || n.type === "raise_stmt")) return false;
  if (!f.showDunders && n.type === "function_def" && isDunderName((n as any).name)) return false;
  return true;
}

// Returns the set of node IDs that should be excluded — either explicitly hidden,
// failing a filter, or whose ancestor is excluded (so we don't render orphans).
export function computeExcluded(astNodes: AstNode[], hiddenIds: Set<string>, filters: NodeFilters): Set<string> {
  const excluded = new Set<string>();
  for (const n of astNodes) {
    if (hiddenIds.has(n.id) || !nodePassesFilter(n, filters)) {
      excluded.add(n.id);
    }
  }
  // Propagate: if a node's parent chain hits an excluded ancestor, exclude it too.
  const byId = new Map(astNodes.map((n) => [n.id, n]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of astNodes) {
      if (excluded.has(n.id)) continue;
      let p = n.parentId ? byId.get(n.parentId) : undefined;
      while (p) {
        if (excluded.has(p.id)) { excluded.add(n.id); changed = true; break; }
        p = p.parentId ? byId.get(p.parentId) : undefined;
      }
    }
  }
  return excluded;
}

export function applyFilters(astNodes: AstNode[], hiddenIds: Set<string>, filters: NodeFilters): AstNode[] {
  const excluded = computeExcluded(astNodes, hiddenIds, filters);
  return astNodes.filter((n) => !excluded.has(n.id));
}
