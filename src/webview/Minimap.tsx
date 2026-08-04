// M-FV.4 (W5) — the single minimap used by every react-flow view, so the
// thread view and the file (diagram) view stay visually identical. Was a
// one-off <MiniMap> inline in ThreadView; extracted here and adopted by both.

import React from "react";
import { MiniMap, type Node, type MiniMapNodeProps } from "@xyflow/react";

interface Props {
  // Per-node colour. Thread view passes a constant accent; the file view
  // passes fileNodeColor so the multi-accent palette isn't flattened.
  nodeColor?: (node: Node) => string;
  // M-NA7 — per-view dimensions. The thread view passes a wide, shallow
  // box that matches the L-R aspect; default is react-flow's 200×150.
  width?: number;
  height?: number;
}

// M-NA7 — minimum node footprint in FLOW units. On a long L-R thread the
// minimap squeezes ~15k flow-px into ~250 CSS px; a 54px-tall card
// scales to under a pixel and the whole map read as a near-blank grey
// box (the w7 review finding). Cards keep their true width (~200) but
// get a floor on both axes so every node paints at least a visible dot.
const MIN_NODE_UNITS = 120;

function VgMiniMapNode({ x, y, width, height, color, borderRadius, className }: MiniMapNodeProps) {
  const w = Math.max(width, MIN_NODE_UNITS);
  const h = Math.max(height, MIN_NODE_UNITS);
  // Inflate around the node's centre so the dot stays on its position.
  const cx = x + width / 2;
  const cy = y + height / 2;
  return (
    <rect
      className={className || "react-flow__minimap-node"}
      x={cx - w / 2}
      y={cy - h / 2}
      width={w}
      height={h}
      rx={Math.min(borderRadius ?? 5, h / 2)}
      fill={color}
      shapeRendering="geometricPrecision"
    />
  );
}

// Shared chrome: dark panel, subtle border, dimming mask, pan + zoom.
// (react-flow's MiniMap renders as `.react-flow__minimap`; only one view is
// mounted at a time, so that class is a stable per-view selector.)
export function VgMiniMap({ nodeColor, width, height }: Props) {
  const color = nodeColor ?? (() => "var(--accent-thread)");
  return (
    <MiniMap
      nodeColor={color}
      nodeStrokeColor={color}
      nodeComponent={VgMiniMapNode}
      maskColor="color-mix(in oklab, var(--bg-canvas) 70%, transparent)"
      pannable
      zoomable
      style={{
        background: "var(--bg-node)",
        border: "1px solid var(--border-edge)",
        borderRadius: 6,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      }}
    />
  );
}

// File-view node → accent token, by react-flow node type (see
// typeToNodeType in buildLayout). Keeps the minimap legible as a colour
// map of the file rather than a flat teal blob.
const FILE_NODE_ACCENT: Record<string, string> = {
  functionDefNode: "var(--accent-thread)",
  classDefNode: "var(--accent-thread)",
  ifNode: "var(--accent-thread)",
  forLoopNode: "var(--accent-thread)",
  assignmentNode: "var(--accent-warning)",
  callNode: "var(--accent-io)",
  importNode: "var(--text-secondary)",
  importFromNode: "var(--text-secondary)",
  returnNode: "var(--accent-error)",
  raiseNode: "var(--accent-error)",
};

export function fileNodeColor(node: Node): string {
  return FILE_NODE_ACCENT[node.type ?? ""] ?? "var(--text-muted)";
}

// W7 — thread minimap dots inherit each node's computed accent (set on the
// node data by ThreadView), so the overview reads as the same colour map as
// the canvas (data-flow blue, dynamic amber, …) instead of a flat teal blob.
export function threadNodeColor(node: Node): string {
  const accentVar = (node.data as { accentVar?: string } | undefined)?.accentVar;
  return accentVar ? `var(${accentVar})` : "var(--accent-thread)";
}
