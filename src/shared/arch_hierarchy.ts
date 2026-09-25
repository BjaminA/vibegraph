// The architecture model's HIERARCHY (2026-09-24): one tree, resolved once,
// stamped on the model so every reader (the map, the HTML artifact, the
// Archify adapter, an agent reading the IR) sees the same nesting.
//
//   group  → its parent group: the explicit `parent` when valid, else the
//            SMALLEST other group that wraps it (a host inside a trust zone,
//            not the zone inside the host). Cycles are cut.
//   node   → `group`: the innermost group that holds it — wrapped directly,
//            or, for a DISPATCHER, the group of the cluster it runs in
//            (job_orchestrator.sh sits in the command host, under the
//            Volt mesh, because its backend cluster does; no statement
//            wrapped the hub itself, and it fell out of every box).
//            `parent`: a dispatcher's cluster, else its group.
//
// Stated groups need not form a tree (a private production codebase's store wraps one host in two
// "Volt mesh" groups, and one MCP server in two hosts). A node in several
// groups takes the DEEPEST, then the smallest, then the first; every other
// wrapping is kept on the group record, only the tree picks one.

import type { ArchGroupRecord, ArchModelRecord } from "./protocol.ts";

export interface ArchHierarchy {
  /** group id → parent group id (absent = top level). */
  groupParent: Map<string, string>;
  /** node id → innermost group id (absent = no group). */
  nodeGroup: Map<string, string>;
  /** node id → parent: a dispatcher's cluster, else its group. */
  nodeParent: Map<string, string>;
  /** a group's depth (0 = top level). */
  depth: (groupId: string) => number;
  /** outermost → innermost group ids holding a node. */
  chainOf: (nodeId: string) => string[];
}

export function resolveHierarchy(model: ArchModelRecord): ArchHierarchy {
  const groups = model.groups ?? [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  // Transitive member count, for "smallest wrapper".
  const sizeMemo = new Map<string, number>();
  const size = (g: ArchGroupRecord, seen = new Set<string>()): number => {
    if (sizeMemo.has(g.id)) return sizeMemo.get(g.id)!;
    if (seen.has(g.id)) return 0;
    seen.add(g.id);
    let n = 0;
    for (const w of g.wraps) { const k = byId.get(w); n += k ? size(k, seen) : 1; }
    sizeMemo.set(g.id, n);
    return n;
  };

  // A group's NODE members, transitively — for subset nesting.
  const membersMemo = new Map<string, Set<string>>();
  const members = (g: ArchGroupRecord, seen = new Set<string>()): Set<string> => {
    if (membersMemo.has(g.id)) return membersMemo.get(g.id)!;
    const out = new Set<string>();
    if (seen.has(g.id)) return out;
    seen.add(g.id);
    for (const w of g.wraps) { const k = byId.get(w); if (k) for (const m of members(k, seen)) out.add(m); else out.add(w); }
    membersMemo.set(g.id, out);
    return out;
  };
  const strictSubset = (a: Set<string>, b: Set<string>) => a.size < b.size && [...a].every((x) => b.has(x));

  const groupParent = new Map<string, string>();
  for (const g of groups) {
    const explicit = g.parent && byId.has(g.parent) && g.parent !== g.id ? g.parent : null;
    const wrappers = groups.filter((p) => p.id !== g.id && p.wraps.includes(g.id));
    // Nobody wraps it: a group whose members all sit inside a bigger group
    // is inside it (a private production codebase's "pm2 process" = the MCP server + its
    // scripts, all of which the "pm2 app host" wraps).
    const containers = wrappers.length || explicit ? [] : groups.filter((p) => p.id !== g.id && strictSubset(members(g), members(p)));
    const pick = explicit
      ?? [...wrappers, ...containers].sort((a, b) => size(a) - size(b) || groups.indexOf(a) - groups.indexOf(b))[0]?.id;
    if (pick) groupParent.set(g.id, pick);
  }
  // Cut cycles: walk up; a repeat drops the edge that closed it.
  for (const g of groups) {
    const seen = new Set<string>([g.id]);
    let cur = g.id;
    while (groupParent.has(cur)) {
      const p = groupParent.get(cur)!;
      if (seen.has(p)) { groupParent.delete(cur); break; }
      seen.add(p);
      cur = p;
    }
  }
  const depthMemo = new Map<string, number>();
  const depth = (id: string): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    let d = 0;
    for (let p = groupParent.get(id); p && d < 16; p = groupParent.get(p)) d++;
    depthMemo.set(id, d);
    return d;
  };

  const nodeGroup = new Map<string, string>();
  for (const n of model.nodes) {
    const holders = groups.filter((g) => g.wraps.includes(n.id));
    const best = holders.sort((a, b) => depth(b.id) - depth(a.id) || size(a) - size(b) || groups.indexOf(a) - groups.indexOf(b))[0];
    if (best) nodeGroup.set(n.id, best.id);
  }
  const nodeParent = new Map<string, string>();
  for (const n of model.nodes) {
    if (n.kind === "hub" && n.cluster) {
      if (!nodeGroup.has(n.id) && nodeGroup.has(n.cluster)) nodeGroup.set(n.id, nodeGroup.get(n.cluster)!);
      nodeParent.set(n.id, n.cluster);
    } else if (nodeGroup.has(n.id)) {
      nodeParent.set(n.id, nodeGroup.get(n.id)!);
    }
  }
  // Bird's-eye folds clusters: a node whose group lost it keeps nothing.
  const chainOf = (nodeId: string): string[] => {
    const out: string[] = [];
    for (let g = nodeGroup.get(nodeId); g && out.length < 16; g = groupParent.get(g)) out.unshift(g);
    return out;
  };
  return { groupParent, nodeGroup, nodeParent, depth, chainOf };
}

/** The model with the hierarchy stamped on it: `parent` / `group` on every
 *  node that has one, and each group's resolved `parent`. */
export function stampHierarchy(model: ArchModelRecord): ArchModelRecord {
  const h = resolveHierarchy(model);
  return {
    ...model,
    nodes: model.nodes.map((n) => {
      const group = h.nodeGroup.get(n.id);
      const parent = h.nodeParent.get(n.id);
      const { group: _g, parent: _p, ...rest } = n as typeof n & { group?: string; parent?: string };
      return { ...rest, ...(group ? { group } : {}), ...(parent ? { parent } : {}) };
    }),
    groups: model.groups.map((g) => {
      const { parent: _p, ...rest } = g;
      const parent = h.groupParent.get(g.id);
      return { ...rest, ...(parent ? { parent } : {}) };
    }),
  };
}
