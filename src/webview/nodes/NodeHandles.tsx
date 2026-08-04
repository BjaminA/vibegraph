import React from "react";
import { Handle, Position } from "@xyflow/react";

// Invisible target/source handles required by React Flow v12 for edge
// rendering. Without them, getEdgePosition returns null and EdgeWrapper
// silently drops the edge (error 008 — no handle found). VibeGraph nodes
// don't expose handles to users (we don't draw connections by hand), so the
// handles are positioned at top/bottom edges and made fully transparent and
// non-interactive.

const STYLE: React.CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  border: "none",
  background: "transparent",
  pointerEvents: "none",
};

export function NodeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} style={STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={STYLE} isConnectable={false} />
    </>
  );
}
