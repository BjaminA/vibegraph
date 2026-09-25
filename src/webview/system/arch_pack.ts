// The architecture map's PLACEMENT (2026-09-24): left-to-right flow,
// hierarchical groups packed as rectangles, related parts kept close.
//
// Replaces full-width group BANDS. A band gave every group its own rows
// across every column, so a private production codebase's nine groups stacked into a map 2720
// units tall and 1702 wide — the wrong shape for a laptop, fitted at 3px
// text. Here:
//
//   COLUMNS follow the flow. A process sits one column right of the rightmost
//   process that hops into it, and never left of its category's column
//   (web app 0, services 1, scripts 2): page → MCP server → dispatcher →
//   scripts reads left to right. Tools take the last column. Cycles are cut
//   where a walk meets itself.
//
//   GROUPS are rectangles over the columns they span, packed RECURSIVELY:
//   a group's members (and child groups) are packed inside it first, then
//   the group is packed as one block among its siblings. Two blocks share
//   rows whenever their column spans are disjoint, so a host on the left and
//   a trust zone on the right sit side by side instead of one above the
//   other.
//
//   PROXIMITY: a block is placed at the free slot nearest the average height
//   of the blocks already placed that it has edges to, so a tool lands
//   beside its callers and a dispatcher beside what runs it.
//
// Pure and deterministic: same model, same positions.

import type { ArchEdgeRecord, ArchNodeRecord } from "../../shared/protocol.ts";
import type { ArchCategory } from "../../shared/arch_protocol.ts";
import type { ArchHierarchy } from "../../shared/arch_hierarchy.ts";

export const COL_STEP = 400;
export const colX = (col: number) => col * COL_STEP;
/** space between stacked blocks in one column */
const GAP = 32;
/** a group box's padding around its members, and the band above for its label */
export const GROUP_PAD = 24;
export const GROUP_HEAD = 32;

const BASE: Partial<Record<ArchCategory, number>> = {
  frontend: 0, backend: 1, agent: 1, scripts: 2, pipeline: 2,
};

export interface PackInput {
  nodes: ArchNodeRecord[];
  edges: ArchEdgeRecord[];
  /** groups to draw (ids), in any order */
  groups: string[];
  hierarchy: ArchHierarchy;
  cardW: number;
  cardH: (n: ArchNodeRecord) => number;
}

export interface PackOutput {
  pos: Map<string, { x: number; y: number }>;
  col: Map<string, number>;
  boxes: Map<string, { x0: number; x1: number; y0: number; y1: number }>;
}

/** Column per node: flow rank, floored by category; tools last; actors -1. */
export function flowColumns(nodes: ArchNodeRecord[], edges: ArchEdgeRecord[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // A dispatcher shares its CLUSTER's column (it is part of it: the
  // hierarchy's parent); hops into or out of it count as the cluster's.
  const rep = (id: string) => {
    const n = byId.get(id);
    return n?.kind === "hub" && n.cluster && ids.has(n.cluster) ? n.cluster : id;
  };
  const preds = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind === "uses" || !ids.has(e.from) || !ids.has(e.to)) continue;
    const from = rep(e.from), to = rep(e.to);
    if (from === to) continue;
    const a = byId.get(from)!, b = byId.get(to)!;
    if (a.kind === "tool" || b.kind === "tool") continue;
    // A hop AGAINST the category order (scripts calling back into the web
    // app, a script calling a service) is a callback: drawn right to left,
    // it never pushes its target rightward. a private production codebase's credit scripts call
    // the Next app, and the web app — where users start — drifted to column 2.
    if ((BASE[b.category] ?? 1) < (BASE[a.category] ?? 1)) continue;
    preds.set(to, [...(preds.get(to) ?? []), from]);
  }
  const rank = new Map<string, number>();
  const onStack = new Set<string>();
  const visit = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    const n = byId.get(id)!;
    if (n.kind === "actor") { rank.set(id, -1); return -1; }
    onStack.add(id);
    let r = BASE[n.category] ?? 1;
    for (const p of [...(preds.get(id) ?? [])].sort()) {
      if (onStack.has(p)) continue; // a cycle: cut here
      r = Math.max(r, visit(p) + 1);
    }
    onStack.delete(id);
    rank.set(id, r);
    return r;
  };
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) if (n.kind !== "tool" && rep(n.id) === n.id) visit(n.id);
  for (const n of nodes) if (rep(n.id) !== n.id) rank.set(n.id, rank.get(rep(n.id)) ?? BASE[n.category] ?? 1);
  // Compress: no empty column between two used ones.
  const used = [...new Set(rank.values())].filter((r) => r >= 0).sort((a, b) => a - b);
  const out = new Map<string, number>();
  for (const [id, r] of rank) out.set(id, r < 0 ? -1 : used.indexOf(r));
  const last = used.length;
  for (const n of nodes) if (n.kind === "tool") out.set(n.id, last);
  return out;
}

interface Block {
  id: string;             // node id or `group:<id>`
  c0: number; c1: number; // column span
  h: number;
  /** member node ids (for edges) */
  nodes: string[];
  /** placed children: id → offset inside this block */
  place: (dy: number) => void;
}

type Order = "height" | "left" | "degree";
interface Variant { order: Order; toolCols: 1 | 2 }

/** The usable canvas of a 1440×900 laptop (side panel and chrome off). */
const LAPTOP = { w: 1160, h: 700 };

/**
 * Pack under a few orderings and one or two tool columns, and keep the one
 * that reads LARGEST on a laptop canvas (the zoom that fits it all), ties to
 * the shorter total distance between connected cards. No ordering wins on
 * every project: a private production codebase's tall trust zone wants to go first, the fleet's
 * flat chain wants its leftmost first.
 */
export function packArchitecture(input: PackInput): PackOutput {
  let best: { out: PackOutput; zoom: number; dist: number } | null = null;
  for (const order of ["height", "left", "degree"] as Order[]) {
    for (const toolCols of [1, 2] as const) {
      const out = packOnce(input, { order, toolCols });
      const { zoom, dist } = score(out, input);
      if (!best || zoom > best.zoom + 1e-6 || (Math.abs(zoom - best.zoom) <= 1e-6 && dist < best.dist)) best = { out, zoom, dist };
    }
  }
  return best!.out;
}

function score(out: PackOutput, input: PackInput): { zoom: number; dist: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  for (const [id, p] of out.pos) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + input.cardW); y1 = Math.max(y1, p.y + input.cardH(byId.get(id)!));
  }
  for (const b of out.boxes.values()) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  const zoom = Math.min(LAPTOP.w / Math.max(1, x1 - x0), LAPTOP.h / Math.max(1, y1 - y0));
  let dist = 0;
  for (const e of input.edges) {
    const a = out.pos.get(e.from), b = out.pos.get(e.to);
    if (a && b) dist += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  return { zoom, dist };
}

function packOnce(input: PackInput, variant: Variant): PackOutput {
  const { nodes, edges, hierarchy, cardH } = input;
  const col = flowColumns(nodes, edges);
  const toolCol = Math.max(0, ...[...col.values()]);
  const drawn = new Set(input.groups);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // The drawn tree: a node's container is its nearest DRAWN group.
  const containerOf = (nodeId: string): string | null => {
    const chain = hierarchy.chainOf(nodeId).filter((g) => drawn.has(g));
    return chain.length ? chain[chain.length - 1] : null;
  };
  const groupContainer = (gid: string): string | null => {
    for (let p = hierarchy.groupParent.get(gid); p; p = hierarchy.groupParent.get(p)) if (drawn.has(p)) return p;
    return null;
  };
  const kidsNodes = new Map<string | null, string[]>();
  for (const n of nodes) {
    const c = containerOf(n.id);
    kidsNodes.set(c, [...(kidsNodes.get(c) ?? []), n.id]);
  }
  const kidsGroups = new Map<string | null, string[]>();
  for (const g of [...drawn].sort()) {
    const c = groupContainer(g);
    kidsGroups.set(c, [...(kidsGroups.get(c) ?? []), g]);
  }
  // A tool that shares its innermost group with PROCESSES (directly or in
  // child groups) sits one column right of them, not in the global tools
  // column: a "Browser" zone wrapping the web app and a browser-side library
  // otherwise stretched across the whole map, empty in the middle. Tools in
  // tool-only groups (a database host, an egress zone) stay in the last column.
  const procColsUnder = (g: string): number[] => [
    ...(kidsNodes.get(g) ?? []).filter((id) => byId.get(id)!.kind !== "tool").map((id) => col.get(id) ?? 0),
    ...(kidsGroups.get(g) ?? []).flatMap(procColsUnder),
  ];
  for (const n of nodes) {
    if (n.kind !== "tool") continue;
    const g = containerOf(n.id);
    const procs = g ? procColsUnder(g) : [];
    if (procs.length) col.set(n.id, Math.min(toolCol, Math.max(...procs) + 1));
  }

  // Undirected adjacency between nodes, weighted by edge count.
  const adj = new Map<string, Map<string, number>>();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) continue;
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!adj.has(a)) adj.set(a, new Map());
      adj.get(a)!.set(b, (adj.get(a)!.get(b) ?? 0) + 1);
    }
  }

  const pos = new Map<string, { x: number; y: number }>();
  const boxes = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  const absY = new Map<string, number>(); // node → y relative to the container being packed

  /** Pack one container's children; returns its block (height relative to 0). */
  const pack = (container: string | null): Block => {
    const blocks: Block[] = [];
    for (const g of kidsGroups.get(container) ?? []) blocks.push(pack(g));
    for (const id of kidsNodes.get(container) ?? []) {
      const n = byId.get(id)!;
      const c = col.get(id) ?? 0;
      blocks.push({
        id, c0: c, c1: c, h: cardH(n), nodes: [id],
        place: (dy) => { absY.set(id, dy); },
      });
    }
    // Order: GROUPS tallest first (bin packing: the big blocks take the top
    // rows, small ones fill in beside them), then single cards leftmost
    // first and most connected first, so each lands beside what it talks to.
    const degree = (b: Block) => b.nodes.reduce((k, id) => k + [...(adj.get(id)?.values() ?? [])].reduce((s, v) => s + v, 0), 0);
    const isGroup = (b: Block) => b.id.startsWith("group:");
    blocks.sort(variant.order === "height"
      ? (a, b) => Number(isGroup(b)) - Number(isGroup(a)) || (isGroup(a) ? b.h - a.h : 0) || a.c0 - b.c0 || degree(b) - degree(a) || a.id.localeCompare(b.id)
      : variant.order === "left"
        ? (a, b) => a.c0 - b.c0 || degree(b) - degree(a) || a.id.localeCompare(b.id)
        : (a, b) => degree(b) - degree(a) || a.c0 - b.c0 || a.id.localeCompare(b.id));

    const occ = new Map<number, Array<[number, number]>>();
    const free = (c0: number, c1: number, y: number, h: number) => {
      for (let c = c0; c <= c1; c++) for (const [a, b] of occ.get(c) ?? []) if (y < b + GAP && a < y + h + GAP) return false;
      return true;
    };
    const centreOf = new Map<string, number>();
    let bottom = 0;
    for (const b of blocks) {
      // desired: the weighted mean centre of placed neighbours
      let wsum = 0, ysum = 0;
      for (const id of b.nodes) for (const [m, w] of adj.get(id) ?? []) {
        const cy = centreOf.get(m);
        if (cy === undefined) continue;
        wsum += w; ysum += w * cy;
      }
      const desired = wsum ? Math.max(0, ysum / wsum - b.h / 2) : 0;
      const cands = new Set<number>([desired, 0]);
      for (let c = b.c0; c <= b.c1; c++) for (const [, e] of occ.get(c) ?? []) { cands.add(e + GAP); }
      for (let c = b.c0; c <= b.c1; c++) for (const [s] of occ.get(c) ?? []) { const y = s - GAP - b.h; if (y >= 0) cands.add(y); }
      let best = Infinity;
      let shift = 0;
      // A block of TOOLS only may use a second tools column when the first
      // is blocked (a trust zone wrapping one tool holds its whole height).
      // Top level only: inside a group the members stack (a group split
      // across two columns reads as two groups).
      const toolOnly = container === null && variant.toolCols === 2 && b.c0 === toolCol && b.nodes.every((id) => byId.get(id)!.kind === "tool");
      for (const sh of toolOnly ? [0, 1] : [0]) {
        const extra = new Set<number>(cands);
        for (const [, e] of occ.get(b.c0 + sh) ?? []) extra.add(e + GAP);
        for (const y of [...extra].sort((p, q) => p - q)) {
          if (y < 0 || !free(b.c0 + sh, b.c1 + sh, y, b.h)) continue;
          if (Math.abs(y - desired) < Math.abs(best - desired) - 1e-6) { best = y; shift = sh; }
        }
      }
      if (!isFinite(best)) best = bottom + GAP;
      if (shift) {
        b.c0 += shift; b.c1 += shift;
        for (const id of b.nodes) col.set(id, (col.get(id) ?? 0) + shift);
      }
      for (let c = b.c0; c <= b.c1; c++) occ.set(c, [...(occ.get(c) ?? []), [best, best + b.h]]);
      b.place(best);
      for (const id of b.nodes) centreOf.set(id, (absY.get(id) ?? best) + cardH(byId.get(id)!) / 2);
      bottom = Math.max(bottom, best + b.h);
    }
    const c0 = Math.min(...blocks.map((b) => b.c0), Infinity);
    const c1 = Math.max(...blocks.map((b) => b.c1), -Infinity);
    const allNodes = blocks.flatMap((b) => b.nodes);
    if (container === null) {
      return { id: "root", c0, c1, h: bottom, nodes: allNodes, place: () => {} };
    }
    // A group block: its members sit below the label band.
    const offsets = new Map(allNodes.map((id) => [id, absY.get(id) ?? 0]));
    const innerGroups = [...boxes].filter(([g]) => isDescendant(g, container));
    const innerBoxes = new Map(innerGroups.map(([g, r]) => [g, { ...r }]));
    return {
      id: `group:${container}`, c0, c1, h: bottom + GROUP_HEAD + GROUP_PAD, nodes: allNodes,
      place: (dy) => {
        for (const [id, off] of offsets) absY.set(id, dy + GROUP_HEAD + off);
        for (const [g, r] of innerBoxes) boxes.set(g, { ...r, y0: r.y0 + dy + GROUP_HEAD, y1: r.y1 + dy + GROUP_HEAD });
        boxes.set(container, { x0: 0, x1: 0, y0: dy, y1: dy + bottom + GROUP_HEAD + GROUP_PAD });
      },
    };
  };
  const isDescendant = (g: string, ancestor: string): boolean => {
    for (let p = groupContainer(g); p; p = groupContainer(p)) if (p === ancestor) return true;
    return false;
  };

  pack(null);
  for (const n of nodes) {
    const c = col.get(n.id) ?? 0;
    pos.set(n.id, { x: colX(c), y: absY.get(n.id) ?? 0 });
  }
  // Box x-extents from what they hold, innermost first.
  const depthOf = (g: string) => { let d = 0; for (let p = groupContainer(g); p; p = groupContainer(p)) d++; return d; };
  for (const g of [...boxes.keys()].sort((a, b) => depthOf(b) - depthOf(a))) {
    let x0 = Infinity, x1 = -Infinity;
    for (const id of kidsNodes.get(g) ?? []) { const p = pos.get(id)!; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x + input.cardW); }
    for (const k of kidsGroups.get(g) ?? []) { const r = boxes.get(k); if (r) { x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); } }
    const r = boxes.get(g)!;
    boxes.set(g, { ...r, x0: x0 - GROUP_PAD, x1: x1 + GROUP_PAD });
  }
  return { pos, col, boxes };
}
