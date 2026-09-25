// M-ARCH.2 — the architecture map's layout: a pure, DETERMINISTIC function
// of the model and the lens. Archify lets the agent place its boxes; we
// refuse, because a position is not evidence of anything. Columns read
// "how far from the user": the web app, the services and agents, the
// scripts and pipelines, then what they all talk to — each column stacked
// in a fixed category order, centred on the tallest.
//
// Lenses select what is drawn, never what is TRUE: the same model, three
// readings.
//   overview — clusters, tools, every edge;
//   tools    — clusters and tools, only the calls into tools;
//   flows    — clusters only, only the hops between them;
//   payloads — every edge, labelled with WHAT crosses it (M-ARCH.3): the
//              keys the caller's code spells, or its call text.
//   trust    — (M-ARCH.4) only the edges that CROSS a stated or proposed
//              group boundary: where a request leaves one host, network or
//              trust zone for another. Empty until a group exists.
//   birdseye — (2026-09-24) a dozen named boxes: who reaches the system,
//              the processes and dispatchers that carry the flow, the
//              most-called tools by name, one arrow per pair
//              (arch_birdseye.ts). The Browser actor takes a column of its
//              own, left of the web app.
//
// Overview and Trust draw one box per tool CATEGORY (arch_collapse.ts); the
// Tools and Payloads lenses draw every tool. Edges are ROUTED orthogonally
// through the empty lanes between columns (arch_route.ts), so none passes
// through a card; positions are fixed, so cards do not drag.
//
// Groups (M-ARCH.4) are STATED or PROPOSED, never derived, and never
// positioned by whoever stated them: each group takes a horizontal BAND of
// rows, in tree order, so its members are contiguous in every column and
// its box encloses no non-member. A nested group's band sits inside its
// parent's. Named limit: a node two SIBLING groups both wrap is drawn in
// the first; the second's box does not reach it (the inspector says so).

import { Position, MarkerType, type Node, type Edge } from "@xyflow/react";
// Extensions spelled: the Node side (arch_html.ts) imports this file too.
import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord, ArchGroupRecord } from "../../shared/protocol.ts";
import { ARCH_CATEGORIES, type ArchCategory } from "../../shared/arch_protocol.ts";
import { archAccent as archVisual } from "./arch_accent.ts";
import { routeEdges, type RouteBox, type RouteRect } from "./arch_route.ts";
import { packArchitecture } from "./arch_pack.ts";
import { lensSelection, type ArchLens } from "./arch_lens.ts";

// What a lens SELECTS lives in arch_lens.ts (shared with the HTML and the
// agent-facing system map); re-exported so importers of this file keep working.
export { ARCH_LENSES, COLLAPSING_LENSES, lensKeeps, lensKeepsEdge, type ArchLens } from "./arch_lens.ts";

// the rendered card: 240 content + 2×16 padding + 2×1 border (ArchNode is content-box).
export const CARD_W = 274;
/** The card's rendered height: 12px padding, a 28px icon row, a border; a
 *  chip row adds 28. Routes keep clear of it; ports sit on the icon row. */
export function cardHeight(n: ArchNodeRecord): number {
  const rows = chipRows(n);
  // Each wrapped row adds a chip line (17px) and the 4px gap.
  return rows ? 82 + (rows - 1) * 22 : 54;
}

/** The chip texts ArchNode draws, in its order (kept in step with it). */
function chipTexts(n: ArchNodeRecord): string[] {
  const out: string[] = [];
  if (n.roleStatedBy) out.push(`role · ${n.roleStatedBy}`);
  if (n.labelSource) out.push(`named · ${n.labelSource}`);
  if (n.source !== "derived") out.push(n.source);
  if (n.dispatches?.length) out.push(`${n.dispatches.reduce((k, g) => k + g.scripts.length, 0)} scripts`);
  if (n.members?.length) out.push(`${n.members.length} tools`);
  if (n.wrappedBy?.length) out.push(`via ${n.wrappedBy[0]}${n.wrappedBy.length > 1 ? ` +${n.wrappedBy.length - 1}` : ""}`);
  if (n.internalHops) out.push(`internal: ${Object.entries(n.internalHops).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  return out;
}

/** How many rows the chips wrap to in the card's 240px content box: 11px
 *  mono at ~6.6px a character plus 10px of padding and border, 4px apart.
 *  The overlap audit caught a two-row card (98px drawn, 82 assumed) with a
 *  label placed on its second row. */
function chipRows(n: ArchNodeRecord): number {
  const texts = chipTexts(n);
  if (!texts.length) return 0;
  let rows = 1, used = 0;
  for (const t of texts) {
    const w = Math.min(240, Math.ceil(t.length * 6.6 + 10));
    if (used && used + 4 + w > 240) { rows++; used = w; } else used += (used ? 4 : 0) + w;
  }
  return rows;
}
const PORT_BAND = { top: 8, bottom: 46 };
/** The edge label chip, sized with margin: 11px mono is ~6.6px a character
 *  and the chip adds 6px padding a side and ~21px of height; the overlap
 *  audit caught chips touching at the tighter 6.6 + 12 by 20 estimate. */
export const labelBox = (text: string) => ({ w: text ? Math.ceil(text.length * 7 + 16) : 0, h: 24 });
/** `text` cut to fit `w` pixels of labelBox, with an ellipsis. */
export function fitLabel(text: string, w: number): string {
  const n = Math.floor((w - 16) / 7);
  return text.length <= n ? text : text.slice(0, Math.max(1, n - 1)) + "\u2026";
}

const HOP_ACCENT = "var(--accent-thread)";


/** Each node's chain of groups, innermost first (first wrapping group wins
 *  among siblings), and the groups in tree order. */
export function groupMembership(model: ArchModelRecord): {
  order: ArchGroupRecord[];
  chainOf: (id: string) => ArchGroupRecord[];
  innermost: Map<string, ArchGroupRecord>;
  depth: (g: ArchGroupRecord) => number;
} {
  const groups = model.groups ?? [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const kids = new Map<string, ArchGroupRecord[]>();
  const roots: ArchGroupRecord[] = [];
  for (const g of groups) {
    if (g.parent && byId.has(g.parent)) kids.set(g.parent, [...(kids.get(g.parent) ?? []), g]);
    else roots.push(g);
  }
  const order: ArchGroupRecord[] = [];
  const seen = new Set<string>();
  const walk = (g: ArchGroupRecord) => {
    if (seen.has(g.id)) return;
    seen.add(g.id);
    order.push(g);
    // A group may also nest another by WRAPPING its id.
    for (const k of [...(kids.get(g.id) ?? []), ...g.wraps.map((w) => byId.get(w)).filter((x): x is ArchGroupRecord => !!x)]) walk(k);
  };
  roots.filter((g) => !groups.some((p) => p.wraps.includes(g.id))).forEach(walk);
  groups.forEach(walk);
  const innermost = new Map<string, ArchGroupRecord>();
  const depth = (g: ArchGroupRecord): number => {
    let d = 0;
    for (let p = parentOf(g); p && d < 8; p = parentOf(p)) d++;
    return d;
  };
  function parentOf(g: ArchGroupRecord): ArchGroupRecord | undefined {
    return (g.parent ? byId.get(g.parent) : undefined) ?? groups.find((p) => p.wraps.includes(g.id));
  }
  for (const g of order) {
    for (const w of g.wraps) {
      if (byId.has(w)) continue;
      const cur = innermost.get(w);
      if (!cur || depth(g) > depth(cur)) innermost.set(w, g);
    }
  }
  const chainOf = (id: string) => {
    const out: ArchGroupRecord[] = [];
    for (let g = innermost.get(id); g && out.length < 8; g = parentOf(g)) out.push(g);
    return out;
  };
  return { order, chainOf, innermost, depth };
}

/** The label an edge carries: its protocol, how many, and what it names. */
export function edgeLabel(e: ArchEdgeRecord): string {
  const bits = [e.protocol];
  if (e.details?.length) bits.push(e.details.slice(0, 2).join(", ") + (e.details.length > 2 ? ` +${e.details.length - 2}` : ""));
  if (e.count > 1) bits.push(`×${e.count}`);
  return bits.join(" · ");
}

export interface ArchLayout { nodes: Node[]; edges: Edge[]; hiddenTools: string[]; hiddenClusters?: string[] }

export function buildArchLayout(full: ArchModelRecord, lens: ArchLens, opts: { collapseTools?: boolean } = {}): ArchLayout {
  const sel = lensSelection(full, lens, opts);
  const { model, hiddenTools, hiddenClusters, hierarchy } = sel;
  const nodesKept = sel.nodes;
  const edgesKept = sel.edges;

  // 2026-09-24 — placement is arch_pack.ts: flow columns, the resolved
  // hierarchy packed as rectangles, related parts kept close. A group is
  // drawn when a node this lens keeps sits inside it (directly or nested).
  const drawnGroups = new Set(nodesKept.flatMap((n) => hierarchy.chainOf(n.id)));
  const packed = packArchitecture({
    nodes: nodesKept, edges: edgesKept, groups: [...drawnGroups], hierarchy, cardW: CARD_W, cardH: cardHeight,
  });
  const pos = packed.pos;
  const colOf = packed.col;
  const nodes: Node[] = nodesKept.map((n) => ({
    id: n.id,
    type: "archNode",
    position: pos.get(n.id)!,
    data: { node: n },
    // Keyboard: react-flow makes the node focusable; this names it.
    ariaLabel: `${n.label}, ${n.sublabel}`,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    // Positions are fixed: the routes are computed from them.
    draggable: false,
    zIndex: 1,
  }));
  // Outer boxes first, so an inner box paints over its parent's.
  const groupById = new Map(model.groups.map((g) => [g.id, g]));
  const groupNodes: Node[] = [...drawnGroups]
    .filter((gid) => packed.boxes.has(gid) && groupById.has(gid))
    .sort((a, b) => hierarchy.depth(a) - hierarchy.depth(b) || a.localeCompare(b))
    .map((gid) => {
      const b = packed.boxes.get(gid)!;
      return {
        id: `group:${gid}`,
        type: "archGroup",
        position: { x: b.x0, y: b.y0 },
        data: { group: groupById.get(gid)!, trustLens: lens === "trust" },
        style: { width: b.x1 - b.x0, height: b.y1 - b.y0 },
        width: b.x1 - b.x0,
        height: b.y1 - b.y0,
        draggable: false,
        selectable: true,
        zIndex: 0,
      };
    });
  const headers: RouteRect[] = groupNodes.map((g) => ({ x: g.position.x, y: g.position.y, w: Number(g.width), h: 28 }));
  return { nodes: [...groupNodes, ...nodes], edges: edgesFor(model, lens, edgesKept, pos, colOf, headers), hiddenTools, hiddenClusters };
}

/** The label a lens puts on an edge. */
export function lensEdgeLabel(e: ArchEdgeRecord, lens: ArchLens): string {
  return lens === "payloads" ? (e.payloadSummary ?? `${e.protocol} · shape not spelled here`) : edgeLabel(e);
}

function edgesFor(
  model: ArchModelRecord, lens: ArchLens, edgesKept: ArchEdgeRecord[],
  pos: Map<string, { x: number; y: number }>, colOf: Map<string, number>, headers: RouteRect[],
): Edge[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const boxes: RouteBox[] = [...pos].map(([id, p]) => ({ id, x: p.x, y: p.y, w: CARD_W, h: cardHeight(byId.get(id)!), col: colOf.get(id) ?? 0 }));
  const routes = routeEdges(boxes, edgesKept.map((e) => {
    const b = labelBox(lensEdgeLabel(e, lens));
    return { id: e.id, from: e.from, to: e.to, labelW: b.w, labelH: b.h };
  }), { spreadPorts: true, portBand: () => PORT_BAND, gapAfterLast: 160, obstacles: headers });
  return edgesKept.map((e) => {
    const hop = e.kind !== "uses";
    const target = byId.get(e.to);
    const accent = hop ? HOP_ACCENT : `var(${archVisual(target?.category ?? "unknown").accent})`;
    const weak = e.confidence === "ambiguous" || e.protocolPresence || e.protocol === "unknown"
      || (lens === "payloads" && !e.payloadSummary);
    const r = routes.get(e.id);
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      type: "archEdge",
      // A label with no free spot at any width is not drawn (it would sit on
      // a card or a label); one that fits only narrower is cut to the spot.
      // The full text stays in the edge's title, aria-label and inspector.
      label: r?.labelClear === false ? undefined : fitLabel(lensEdgeLabel(e, lens), r?.labelW ?? Infinity),
      ariaLabel: `${byId.get(e.from)?.label ?? e.from} to ${byId.get(e.to)?.label ?? e.to}: ${lensEdgeLabel(e, lens)}`,
      data: { edge: e, points: r?.points ?? [], labelAt: r?.label ?? null, labelClear: r?.labelClear ?? true, fullLabel: lensEdgeLabel(e, lens), weak, hop },
      markerEnd: { type: MarkerType.ArrowClosed, color: accent, width: 16, height: 16 },
      style: {
        stroke: accent,
        strokeWidth: hop ? 2 : 1.5,
        strokeDasharray: weak ? "5 4" : undefined,
        opacity: weak ? 0.55 : 0.8,
      },
      // Legible at fit zoom (the M24 rule): a solid chip behind the text.
      labelStyle: { fill: weak ? "var(--text-muted)" : "var(--text-secondary)", fontSize: 11, fontFamily: "var(--font-mono)" },
      labelBgStyle: { fill: "var(--bg-canvas)", opacity: 0.9 },
      labelBgPadding: [6, 4] as [number, number],
      labelBgBorderRadius: 4,
    };
  });
}

/** The drawn extent of a layout (cards and group boxes). */
export function layoutBounds(nodes: Node[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    const w = Number(n.width ?? CARD_W);
    const h = Number(n.height ?? cardHeight((n.data as { node: ArchNodeRecord }).node));
    x0 = Math.min(x0, n.position.x); y0 = Math.min(y0, n.position.y);
    x1 = Math.max(x1, n.position.x + w); y1 = Math.max(y1, n.position.y + h);
  }
  return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 1, h: 1 };
}

/** Card labels are 13px; below this rendered size they are not read. */
export const LEGIBLE_LABEL_PX = 11;
const LABEL_PX = 13;

/**
 * The first view of the map (reviews/m-arch/COMPARE.md: fitting all of
 * a private production codebase put labels at 4px). Fit everything when that stays legible;
 * otherwise fit the WIDTH when that does; otherwise sit at the legibility
 * floor. Either way the top-left of the map is where the view starts, and the
 * rest is a pan away.
 */
export function readableViewport(b: { x: number; y: number; w: number; h: number }, W: number, H: number, inset: { top: number; left: number; pad: number; right?: number } = { top: 0, left: 0, pad: 32 }, floorZoom?: number): { x: number; y: number; zoom: number } {
  // `right` keeps a strip clear for chrome that floats at the canvas's right
  // edge (the chat button): the map fills the width now, and its last column
  // sat under the button.
  const aw = Math.max(1, W - inset.left - (inset.right ?? 0) - 2 * inset.pad), ah = Math.max(1, H - inset.top - 2 * inset.pad);
  // The Bird's-eye lens passes a lower floor: the point of it is the whole
  // picture on one screen, as Archify draws it.
  const floor = floorZoom ?? LEGIBLE_LABEL_PX / LABEL_PX;
  const all = Math.min(aw / b.w, ah / b.h, 1.2);
  if (all >= floor) {
    return { zoom: all, x: inset.left + inset.pad + (aw - b.w * all) / 2 - b.x * all, y: inset.top + inset.pad + (ah - b.h * all) / 2 - b.y * all };
  }
  const zoom = Math.max(Math.min(aw / b.w, 1.2), floor);
  return { zoom, x: inset.left + inset.pad - b.x * zoom, y: inset.top + inset.pad - b.y * zoom };
}
