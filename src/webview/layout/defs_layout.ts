// The file view's DEFINITIONS region, laid out left to right (2026-09-24).
//
// Ben: "use more horizontal space in the file view — imports can be one
// column, but arrange code and functions more horizontally; minimise space
// via the flow line edge distance". The definitions band was ONE column in
// call-flow order (M-FV.6), so a file with forty functions was a column
// forty cards tall beside mostly empty canvas. Now:
//
//   * the calls between top-level definitions form a small graph; each
//     connected group is laid out as a CALL FLOW — a definition one column
//     right of the rightmost definition that calls it (cycles cut), each
//     column stacked with every card placed as close as it can get to the
//     height of what calls it, so the flow lines stay short and level;
//   * the groups (a lone helper is a group of one) are then PACKED into a
//     region shaped like a laptop screen: each group goes to the spot that
//     keeps it highest, in source order, so the file still reads top-left
//     first.
//
// 2026-10-07 — and it reads as a STORY: what runs when the file runs comes
// first (its group packed first, its block first in its column), and when the
// caller says where in it a call sits (`callAt`, the code view knows the
// line), each callee sits level with the line that calls it, in the order the
// calls happen — so the flow lines run straight across.
//
// Pure: definitions, sizes and call edges in; positions relative to the
// region's top-left out.

import type { AstNode } from "../types";

/** space between two call-flow columns: room for the flow lines */
const LAYER_GAP = 120;
/** space between cards stacked in one column, and between packed groups */
const STACK_GAP = 32;
const GROUP_GAP = 56;
/** the region's target shape (width / height) — a laptop's canvas */
const TARGET_ASPECT = 1.65;

export interface DefsLayoutInput {
  defs: AstNode[];
  /** caller → callee, already resolved to top-level definitions of `defs` */
  calls: Array<[string, string]>;
  width: (id: string) => number;
  height: (id: string) => number;
  /** the tallest column beside this region (imports, module state): height
   *  the file already spends, which the definitions may fill before they
   *  spread sideways. */
  besideHeight?: number;
  /** how far down its CALLER a call to `callee` sits (px from the caller's
   *  top) — the callee is placed level with it */
  callAt?: (caller: string, callee: string) => number;
  /** what runs when the file runs (module-level code): the story starts here */
  entries?: ReadonlySet<string>;
  /** room to keep free to a block's right, inside its column's flow channel
   *  (the code view puts its calls into other files there, at their lines) */
  lane?: (id: string) => number;
}

interface Block { ids: string[]; pos: Map<string, { x: number; y: number }>; w: number; h: number }

export function layoutDefinitions(input: DefsLayoutInput): Map<string, { x: number; y: number }> {
  const { defs, width, height } = input;
  const ids = new Set(defs.map((d) => d.id));
  const line = new Map(defs.map((d) => [d.id, d.line ?? 0]));
  const callees = new Map<string, string[]>();
  const callers = new Map<string, string[]>();
  const undirected = new Map<string, Set<string>>();
  for (const [a, b] of input.calls) {
    if (a === b || !ids.has(a) || !ids.has(b)) continue;
    if (!(callees.get(a) ?? []).includes(b)) callees.set(a, [...(callees.get(a) ?? []), b]);
    if (!(callers.get(b) ?? []).includes(a)) callers.set(b, [...(callers.get(b) ?? []), a]);
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!undirected.has(x)) undirected.set(x, new Set());
      undirected.get(x)!.add(y);
    }
  }
  const entries = input.entries ?? new Set<string>();
  // what runs first, then the file's own order
  const bySource = (a: string, b: string) => Number(entries.has(b)) - Number(entries.has(a)) || (line.get(a) ?? 0) - (line.get(b) ?? 0) || a.localeCompare(b);

  // Connected groups, in source order of their first definition.
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const d of [...defs].sort((a, b) => bySource(a.id, b.id))) {
    if (seen.has(d.id)) continue;
    const g: string[] = [];
    const stack = [d.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      g.push(id);
      for (const n of undirected.get(id) ?? []) stack.push(n);
    }
    groups.push(g);
  }

  // The tallest a column may grow: the height of a laptop-shaped box with
  // the same card area. A call-flow layer taller than that (one fetcher
  // calling fifteen helpers) wraps into sub-columns beside itself.
  const cardArea = defs.reduce((k, d) => k + (width(d.id) + STACK_GAP) * (height(d.id) + STACK_GAP), 0);
  const maxColH = Math.max(...defs.map((d) => height(d.id)), Math.sqrt(cardArea / TARGET_ASPECT), input.besideHeight ?? 0);
  // the group the story starts in is packed first
  groups.sort((a, b) => Number(b.some((id) => entries.has(id))) - Number(a.some((id) => entries.has(id))));
  const blocks: Block[] = groups.map((g) => layoutGroup(g, callees, callers, width, height, bySource, maxColH, input.callAt, input.lane));

  // Pack: a region about as wide as a laptop-shaped box of the same area.
  // As wide as the area needs at the target height: a laptop-shaped box, or
  // the height the columns beside already take, whichever is taller.
  const area = blocks.reduce((k, b) => k + (b.w + GROUP_GAP) * (b.h + GROUP_GAP), 0);
  const targetH = Math.max(Math.sqrt(area / TARGET_ASPECT), input.besideHeight ?? 0, ...blocks.map((b) => b.h));
  const maxW = Math.max(...blocks.map((b) => b.w), area / targetH);
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const out = new Map<string, { x: number; y: number }>();
  for (const b of blocks) {
    const xs = [0, ...placed.map((r) => r.x + r.w + GROUP_GAP)].filter((x) => x + b.w <= maxW + 1);
    let best = { x: 0, y: Infinity };
    for (const x of xs) {
      let y = 0;
      for (const r of placed) if (x < r.x + r.w + GROUP_GAP && r.x < x + b.w + GROUP_GAP) y = Math.max(y, r.y + r.h + GROUP_GAP);
      if (y < best.y || (y === best.y && x < best.x)) best = { x, y };
    }
    placed.push({ ...best, w: b.w, h: b.h });
    for (const [id, p] of b.pos) out.set(id, { x: best.x + p.x, y: best.y + p.y });
  }
  return out;
}

/** One connected group as a call flow: columns by call depth, rows near callers. */
function layoutGroup(
  group: string[], callees: Map<string, string[]>, callers: Map<string, string[]>,
  width: (id: string) => number, height: (id: string) => number,
  bySource: (a: string, b: string) => number,
  maxColH: number,
  callAt?: (caller: string, callee: string) => number,
  lane: (id: string) => number = () => 0,
): Block {
  const members = new Set(group);
  // Layer = longest call path from a definition nobody in the group calls.
  const layer = new Map<string, number>();
  const onStack = new Set<string>();
  const visit = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    onStack.add(id);
    let l = 0;
    for (const c of (callers.get(id) ?? []).filter((x) => members.has(x)).sort(bySource)) {
      if (onStack.has(c)) continue; // a cycle: cut
      l = Math.max(l, visit(c) + 1);
    }
    onStack.delete(id);
    layer.set(id, l);
    return l;
  };
  for (const id of [...group].sort(bySource)) visit(id);

  const layers: string[][] = [];
  for (const [id, l] of layer) (layers[l] ??= []).push(id);
  const pos = new Map<string, { x: number; y: number }>();
  let x = 0;
  for (let l = 0; l < layers.length; l++) {
    const col = layers[l] ?? [];
    // Order a column by where its callers sit (barycentre) — at the line
    // that calls it when the caller says (callAt) — then source.
    const at = (c: string, id: string) => (pos.get(c)?.y ?? NaN) + (callAt?.(c, id) ?? 0);
    const bary = (id: string) => {
      const ys = (callers.get(id) ?? []).map((c) => at(c, id)).filter((y) => Number.isFinite(y));
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity;
    };
    col.sort((a, b) => (l === 0 ? 0 : bary(a) - bary(b)) || bySource(a, b));
    let cursor = 0;
    let colW = 0;
    for (const id of col) {
      // As level with its callers as the column allows: short flow lines.
      const want = l === 0 ? cursor : Math.min(...(callers.get(id) ?? []).map((c) => { const y = at(c, id); return Number.isFinite(y) ? y : Infinity; }), Infinity);
      let y = Math.max(cursor, isFinite(want) ? want : cursor);
      // Too tall: continue in a sub-column beside this one (same layer).
      if (colW > 0 && y + height(id) > maxColH) {
        x += colW + STACK_GAP * 2;
        colW = 0;
        cursor = 0;
        y = 0;
      }
      pos.set(id, { x, y });
      cursor = y + height(id) + STACK_GAP;
      colW = Math.max(colW, width(id) + lane(id));
    }
    x += colW + LAYER_GAP;
  }
  let w = 0, h = 0;
  for (const [id, p] of pos) { w = Math.max(w, p.x + width(id) + lane(id)); h = Math.max(h, p.y + height(id)); }
  return { ids: group, pos, w, h };
}

/** The top-level statements that RUN when the file runs (`if __name__ ==
 *  "__main__":`, a bare call, a loop) — not a definition, an import or an
 *  assignment, which only define things. Where the story of a script starts. */
export function runsFirst(top: AstNode[]): Set<string> {
  const defines = new Set(["function_def", "class_def", "import", "import_from", "assignment"]);
  return new Set(top.filter((n) => !n.parentId && !defines.has(n.type)).map((n) => n.id));
}
