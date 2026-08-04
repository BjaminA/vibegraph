// Custom react-flow edge component for the thread view (U2 — UI overhaul).
//
// Replaces the inline-styled MarkerType-only edges with bezier curves
// that carry the neuron-network feeling per the vibegraph-aesthetic
// skill: soft drop-shadow glow, dashed cross-file halo, three-tier
// thickness encoding by call frequency, subtle pulse on the active
// path. CSS-driven so reduced-motion + tokens stay in tokens.css /
// motion.css; the component just chooses classes.
//
// Edge data shape (set by ThreadView):
//   kind:        "direct" | "conditional"
//   irSource:    string | null    (call-site IR node id)
//   crossFile:   boolean          (source.file !== target.file)
//   tier:        "thin" | "medium" | "thick"
//                  thin   = terminal target (external/dynamic/return)
//                  thick  = shared callee (>1 incoming edge in thread)
//                  medium = default

import React from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

export interface ThreadEdgeData {
  // M24 — "flow": unconditional container join (try→finally). Solid,
  // like direct; carries an explicit label ("always"). Fork arrows into
  // if arms arrive as "conditional" and pick up the dashed class.
  kind: "direct" | "conditional" | "flow";
  irSource: string | null;
  crossFile: boolean;
  tier: "thin" | "medium" | "thick";
  // U3.3 — pre-resolved at ThreadView edge-build time so this
  // component stays a dumb renderer. Null when neither call args nor
  // function params resolved to anything meaningful. M24 — "flow"
  // labelSource marks an explicit semantic label from the extractor.
  label?: string | null;
  labelFull?: string | null;
  labelSource?: "call-args" | "fn-params" | "flow" | null;
  // M9.3 — depth cues. crossDepth is "src.fileDepth !== tgt.fileDepth"
  // AND crossFile (same-file edges can't cross depth — they share a
  // file). sameFileHueIndex is 0..7 when both endpoints share a file
  // with a known hue; the edge picks up that hue via --vg-edge-file-hue.
  crossDepth?: boolean;
  sameFileHueIndex?: number | null;
  // §5.6a — target-keyed treatments. toReturn: a curved function-exit
  // terminal (teal, thin, directional arrow). toExcept: the error path
  // into an except band (red-tinted dashed "on error").
  toReturn?: boolean;
  toExcept?: boolean;
  // M-FS3 — where along the path [0..1] this edge's label anchors.
  // ThreadView staggers siblings sharing a source so their labels don't
  // overprint at the shared midpoint. Absent/0.5 = bezier midpoint.
  labelT?: number;
}

// React-flow's default-bezier control offset (getControlWithCurvature):
// forward distance takes half, backward distance blooms with curvature.
function controlOffset(distance: number, curvature: number): number {
  return distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance);
}

function controlPoint(
  pos: string, x1: number, y1: number, x2: number, y2: number, curvature: number,
): [number, number] {
  switch (pos) {
    case "left": return [x1 - controlOffset(x1 - x2, curvature), y1];
    case "right": return [x1 + controlOffset(x2 - x1, curvature), y1];
    case "top": return [x1, y1 - controlOffset(y1 - y2, curvature)];
    default: return [x1, y1 + controlOffset(y2 - y1, curvature)]; // bottom
  }
}

/** Point at parameter t on the same cubic bezier getBezierPath draws. */
function bezierPointAt(
  t: number,
  sx: number, sy: number, sp: string,
  tx: number, ty: number, tp: string,
  curvature: number,
): [number, number] {
  const [c1x, c1y] = controlPoint(sp, sx, sy, tx, ty, curvature);
  const [c2x, c2y] = controlPoint(tp, tx, ty, sx, sy, curvature);
  const u = 1 - t;
  const x = u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * tx;
  const y = u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ty;
  return [x, y];
}

export function ThreadEdge(props: EdgeProps) {
  const {
    id,
    source, target,
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    data,
    markerEnd,
  } = props;
  const d = (data ?? {}) as Partial<ThreadEdgeData>;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    // Slightly relaxed curvature so two adjacent edges read as
    // distinct organic curves, not parallel near-straights. 0.3 is
    // the react-flow default; pushed to 0.4 for a touch more bloom.
    curvature: 0.4,
  });
  const classes = [
    "vg-thread-edge",
    `vg-thread-edge-${d.tier ?? "medium"}`,
    d.kind === "conditional" ? "vg-thread-edge-conditional" : "",
    // M24 — solid join between sibling containers (try→finally).
    d.kind === "flow" ? "vg-thread-edge-flow" : "",
    // §5.6a — curved function-exit terminal; error path into an except band.
    d.toReturn ? "vg-thread-edge-return" : "",
    d.toExcept ? "vg-thread-edge-error" : "",
    d.crossFile ? "vg-thread-edge-cross-file" : "",
    d.crossDepth ? "vg-thread-edge-cross-depth" : "",
  ].filter(Boolean).join(" ");
  // M9.3 — same-file edges inherit the file's wash hue via the
  // --vg-edge-file-hue custom prop (consumed by the
  // [data-edge-file-hue] selector in motion.css). Cross-file edges
  // omit the attr so they stay on --accent-thread.
  const hueAttrs: Record<string, string> = {};
  const hueStyle: React.CSSProperties = {};
  if (d.sameFileHueIndex != null) {
    hueAttrs["data-edge-file-hue"] = String(d.sameFileHueIndex);
    (hueStyle as Record<string, string>)["--vg-edge-file-hue"] =
      `var(--thread-file-hue-${d.sameFileHueIndex})`;
  }
  return (
    <>
      <g
        className={classes}
        style={hueStyle}
        data-source={source}
        data-target={target}
        {...hueAttrs}
      >
        <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      </g>
      {d.label && (() => {
        // M-FS3 — anchor at the staggered t when siblings share this
        // edge's source; the plain midpoint otherwise.
        const t = d.labelT ?? 0.5;
        const [lx, ly] = t === 0.5
          ? [labelX, labelY]
          : bezierPointAt(
              t,
              sourceX, sourceY, String(sourcePosition),
              targetX, targetY, String(targetPosition),
              0.4,
            );
        return (
          <EdgeLabelRenderer>
            <div
              className={[
                "vg-thread-edge-label",
                d.labelSource === "fn-params" ? "vg-thread-edge-label-inferred" : "",
              ].filter(Boolean).join(" ")}
              // labelX/labelY are layout coords; React Flow's
              // EdgeLabelRenderer portal already places it within the
              // transformed viewport, so we use plain CSS transform here
              // to centre the label on its path anchor.
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
                pointerEvents: "auto",
              }}
              data-edge-label-source={source}
              title={d.labelFull ?? d.label}
            >
              {d.label}
            </div>
          </EdgeLabelRenderer>
        );
      })()}
    </>
  );
}
