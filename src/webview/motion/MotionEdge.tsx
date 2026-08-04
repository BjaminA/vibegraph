import React, { useEffect, useRef } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

// Custom edge that animates stroke-dashoffset on first paint. Spec: 320ms
// ease-out per PLAN.md Aesthetic Appendix.
//
// Registered as `edgeTypes={{ default: MotionEdge }}` in App.tsx. Existing
// astEdgesToFlow already emits `type: "default"` so no upstream change.
//
// Uses BaseEdge for correct integration (markerEnd is an object that BaseEdge
// converts to a url(#marker) reference; a plain <path> would serialise the
// object incorrectly and React Flow would silently drop edges). The animation
// is attached via getElementById in useEffect — BaseEdge passes the id prop
// through to its rendered <path>.

export function MotionEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
    data,
  } = props;

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    // M-FV.3 — match the thread edge's curvature (0.4) so flow lines arc
    // with the same bloom across both views, and bow away from the
    // straight-line node crossings the brief flagged.
    curvature: 0.4,
  });

  // Flow edges carry the thread-parity glow class onto the path.
  const className = (data as { family?: string } | undefined)?.family === "flow"
    ? "vg-flow-edge"
    : undefined;

  const animatedRef = useRef(false);

  useEffect(() => {
    if (animatedRef.current) return;
    const el = document.getElementById(id) as SVGPathElement | null;
    if (!el || typeof el.getTotalLength !== "function") return;
    const len = el.getTotalLength();
    if (len <= 0) return;
    el.style.setProperty("--vg-edge-length", `${len}px`);
    el.classList.add("vg-edge-draw");
    animatedRef.current = true;
  }, [id, path]);

  return (
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} className={className} />
  );
}
