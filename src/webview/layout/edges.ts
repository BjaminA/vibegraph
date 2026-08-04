import { MarkerType, type Edge } from "@xyflow/react";
import type { AstEdge } from "../types";

// Edge stroke colours map to design tokens (semantic roles):
//   control   → text-secondary   (neutral default)
//   data      → accent-warning   (the "watch this" colour)
//   reference → accent-thread    (cross-link colour reused from threads)
//   contains  → text-muted       (de-emphasised structural)
// React Flow needs concrete colour strings on the markerEnd, so we read the
// CSS vars at module load. If the document isn't ready yet we fall back to
// the previous hard-coded values; they'll be restyled on the next refresh.

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

const COL_CONTROL   = readVar("--text-secondary", "hsl(220 10% 64%)");
const COL_DATA      = readVar("--accent-warning", "hsl(38 80% 60%)");
const COL_REFERENCE = readVar("--accent-thread",  "hsl(168 60% 56%)");
const COL_CONTAINS  = readVar("--text-muted",     "hsl(220 8% 44%)");

// Phase 3: tighter dash densities. Old 6/3 + 3/3 read as placeholder
// styling; new 4/2 + 2/2 read as deliberate texture.
export const EDGE_STYLES: Record<string, Partial<Edge>> = {
  control: {
    style: { stroke: COL_CONTROL, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: COL_CONTROL, width: 14, height: 14 },
  },
  data: {
    style: { stroke: COL_DATA, strokeWidth: 2, strokeDasharray: "4 2" },
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed, color: COL_DATA, width: 14, height: 14 },
  },
  reference: {
    style: { stroke: COL_REFERENCE, strokeWidth: 1.5, strokeDasharray: "2 2" },
    markerEnd: { type: MarkerType.ArrowClosed, color: COL_REFERENCE, width: 14, height: 14 },
  },
  contains: {
    style: { stroke: COL_CONTAINS, strokeWidth: 1, opacity: 0.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: COL_CONTAINS, width: 10, height: 10 },
  },
};

// M-FV.3 (W3) — every file-view edge is grouped into one of two families the
// edge-visibility toggles key off:
//   structure → `contains` (parent→child nesting; redundant with the M-FV.2
//               indentation, so off by default and rarely needed)
//   flow      → reference / control / data (the actual logic-flow lines)
export type EdgeFamily = "structure" | "flow";
export function edgeFamily(kind: string): EdgeFamily {
  return kind === "contains" ? "structure" : "flow";
}

export function astEdgesToFlow(astEdges: AstEdge[]): Edge[] {
  return astEdges.map((e, i) => {
    const style = EDGE_STYLES[e.type] ?? EDGE_STYLES.control;
    const family = edgeFamily(e.type);
    return {
      id: `e${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: "default",
      // Flow edges adopt the thread-view luminous treatment (see
      // .vg-flow-edge in motion.css) for cross-view parity.
      ...(family === "flow" ? { className: "vg-flow-edge" } : {}),
      data: { kind: e.type, family },
      ...style,
    } as Edge;
  });
}
