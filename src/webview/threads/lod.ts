// M-NA7 — semantic zoom tiers for the thread view (PLAN-v5 §5.2, the
// parked fork; unblocked by NEXT-ACTIONS).
//
// The legibility floor (2026-07-04) made FIRST PAINT readable by
// opening seed-anchored at 0.78, but nothing legible existed between
// "sentence at 0.78" and "noise at fit" — a long thread's overview was
// an unreadable smear the moment the user clicked fit. These tiers give
// each zoom band its own rendering contract:
//
//   full     z ≥ 0.55   the card as designed: icon, label, body row.
//   compact  0.28–0.55  card keeps its accent + icon; the label leaves
//                       the card and renders at inverse-zoom scale
//                       (~constant on-screen size, Obsidian-graph
//                       style) so it stays readable without inflating
//                       the card or shifting layout.
//   overview z < 0.28   only LANDMARKS keep labels (seed, cross-file
//                       entries, route handlers) plus container chips —
//                       a map shows city names at low zoom, not every
//                       street. Everything else reads as colored
//                       structure: the three families still tell the
//                       story (teal program / blue boundary).
//
// Components read the tier via a QUANTIZED react-flow store selector —
// `useStore((s) => tierForZoom(s.transform[2]))` re-renders a node only
// when the tier changes, not per zoom frame. The continuous inverse
// scale rides a CSS variable (--vg-inv-zoom) that ThreadCanvas writes
// straight to the DOM on viewport moves — no React re-render per frame.

export type LodTier = "full" | "compact" | "overview";

// Exported so specs can pin the band edges.
export const LOD_COMPACT_BELOW = 0.55;
export const LOD_OVERVIEW_BELOW = 0.28;

export function tierForZoom(zoom: number): LodTier {
  if (zoom < LOD_OVERVIEW_BELOW) return "overview";
  if (zoom < LOD_COMPACT_BELOW) return "compact";
  return "full";
}

// Inverse-zoom label sizing, shared by ThreadNode + ThreadContainerNode.
// base × (1/zoom) renders ~base px on screen at any zoom; the cap stops
// runaway flow-space text at extreme zoom-out (below the cap's break-
// even zoom the on-screen size degrades gracefully instead of the text
// swallowing the canvas).
export function lodLabelFontSize(basePx: number, capPx: number): string {
  return `min(calc(${basePx}px * var(--vg-inv-zoom, 1)), ${capPx}px)`;
}
