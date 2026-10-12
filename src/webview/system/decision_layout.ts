// The DECISIONS lens laid out as decisions (2026-10-12, field report: "each
// tree is one tall column with the outcomes at the top"). The map's packer
// places by flow columns, which is right for processes and wrong for a tree.
// Here:
//   - state machines first, one row each: the phases left to right in the
//     order the machine declares them;
//   - each decision tree below, from its root: depth to the right, yes and no
//     as branches, the outcomes as leaves;
//   - the evidence on the right: the families read, then the zones that hold
//     them, inside their store.
// Same output shape as arch_pack.ts, so the map's own edge router draws it.

import type { ArchModelRecord, ArchNodeRecord } from "../../shared/protocol";
import type { PackOutput } from "./arch_pack";
import { CARD_W, cardHeight } from "./archLayout.ts";

const COL_W = CARD_W + 120;
const GAP = 24;
const PAD = 24;
const HEAD = 32;

export function decisionPositions(model: ArchModelRecord): (nodes: ArchNodeRecord[]) => PackOutput {
  return (nodes) => {
    const kept = new Set(nodes.map((n) => n.id));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const slot = Math.max(54, ...nodes.map(cardHeight)) + GAP;
    const pos = new Map<string, { x: number; y: number }>();
    const col = new Map<string, number>();
    const boxes = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
    const place = (id: string, c: number, y: number) => { pos.set(id, { x: c * COL_W, y }); col.set(id, c); };
    const box = (gid: string, ids: string[]) => {
      const ps = ids.filter((id) => pos.has(id));
      if (!ps.length) return;
      const xs = ps.map((id) => pos.get(id)!.x), ys = ps.map((id) => pos.get(id)!.y);
      const bottom = Math.max(...ps.map((id) => pos.get(id)!.y + cardHeight(byId.get(id)!)));
      boxes.set(gid, { x0: Math.min(...xs) - PAD, x1: Math.max(...xs) + CARD_W + PAD, y0: Math.min(...ys) - HEAD, y1: bottom + PAD });
    };
    let y = HEAD;
    let maxCol = 0;
    // 1. state machines: a row of phases each
    for (const g of model.groups.filter((x) => x.id.startsWith("topo:machine:"))) {
      const states = g.wraps.filter((id) => kept.has(id));
      states.forEach((id, i) => place(id, i, y));
      maxCol = Math.max(maxCol, states.length - 1);
      box(g.id, states);
      y += slot + HEAD + GAP;
    }
    // 2. decision trees: tidy, from the root
    const branch = new Map<string, string[]>();
    for (const e of model.edges) if ((e.protocol === "yes" || e.protocol === "no") && kept.has(e.from) && kept.has(e.to)) {
      branch.set(e.from, [...(branch.get(e.from) ?? []), e.to]);
    }
    // yes before no, whatever order the edges came in
    for (const e of model.edges) if (e.protocol === "yes" && branch.get(e.from)?.length === 2) branch.set(e.from, [e.to, ...branch.get(e.from)!.filter((x) => x !== e.to)]);
    for (const g of model.groups.filter((x) => x.id.startsWith("topo:tree:"))) {
      const ids = g.wraps.filter((id) => kept.has(id));
      const hasParent = new Set(ids.flatMap((id) => branch.get(id) ?? []));
      const roots = ids.filter((id) => !hasParent.has(id));
      let leaf = 0;
      const seen = new Set<string>();
      const lay = (id: string, depth: number): number => {
        if (seen.has(id)) return pos.get(id)?.y ?? y;
        seen.add(id);
        const kids = (branch.get(id) ?? []).filter((k) => !seen.has(k));
        let at: number;
        if (!kids.length) at = y + (leaf++) * slot;
        else { const ys = kids.map((k) => lay(k, depth + 1)); at = (Math.min(...ys) + Math.max(...ys)) / 2; }
        place(id, depth, at);
        maxCol = Math.max(maxCol, depth);
        return at;
      };
      for (const r of roots) lay(r, 0);
      for (const id of ids) if (!seen.has(id)) lay(id, 0); // a gate no branch reaches still shows
      box(g.id, ids);
      y = Math.max(y, ...ids.map((id) => (pos.get(id)?.y ?? y) + slot)) + HEAD + GAP;
    }
    // 3. the evidence, on the right: families, then the zones inside their store
    const rest = nodes.filter((n) => !pos.has(n.id));
    const fams = rest.filter((n) => n.id.startsWith("topo:fam:"));
    let fy = HEAD;
    for (const n of fams) { place(n.id, maxCol + 1, fy); fy += slot; }
    let zy = HEAD;
    for (const g of model.groups.filter((x) => x.id.startsWith("topo:store:"))) {
      const zs = g.wraps.filter((id) => kept.has(id) && !pos.has(id));
      for (const id of zs) { place(id, maxCol + 2, zy); zy += slot; }
      box(g.id, zs);
      zy += HEAD + GAP;
    }
    for (const n of rest) if (!pos.has(n.id)) { place(n.id, maxCol + 3, zy); zy += slot; }
    return { pos, col, boxes };
  };
}
