// The architecture map's edge: the orthogonal route archLayout computed
// (arch_route.ts), drawn as-is, with the label at the spot the router found
// free of cards and other labels. react-flow's own handle coordinates are
// ignored on purpose — the route is the geometry. A trace (route / reach /
// story) dims every edge it does not include.

import React from "react";
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { roundedPath } from "./arch_route";
import type { EdgeChip } from "./edgeChips";

/** 2026-10-06 — what moves along the edge, as chips (edgeChips.ts): the
 *  protocol, the operation, the keys; in the label's own spot. */
const CHIP_TONE: Record<EdgeChip["kind"], string> = {
  proto: "var(--text-secondary)", op: "var(--accent-io-write)", key: "hsl(70 70% var(--l-fg))", more: "var(--text-muted)",
};
function EdgeChips({ chips, cx, cy, dim, title }: { chips: EdgeChip[]; cx: number; cy: number; dim?: boolean; title?: string }) {
  return (
    <EdgeLabelRenderer>
      <div data-arch-edge-chips title={title} className="nodrag nopan" style={{
        position: "absolute", transform: `translate(-50%, -50%) translate(${cx}px, ${cy}px)`, display: "flex", gap: 4, alignItems: "center",
        padding: "2px 4px", borderRadius: 6, background: "color-mix(in oklab, var(--bg-canvas) 92%, transparent)", opacity: dim ? 0.2 : 1,
        pointerEvents: "all", whiteSpace: "nowrap",
      }}>
        {chips.map((c, i) => (
          <span key={i} data-edge-chip={c.kind} style={{
            fontFamily: c.kind === "op" ? "var(--font-ui)" : "var(--font-mono)", fontSize: "var(--fs-11)", lineHeight: "16px",
            fontWeight: c.kind === "op" ? 600 : 400, color: CHIP_TONE[c.kind],
            ...(c.kind === "proto" || c.kind === "more" ? {} : {
              padding: "0 4px", borderRadius: c.kind === "op" ? 999 : 4,
              background: `color-mix(in oklab, ${CHIP_TONE[c.kind]} 14%, transparent)`,
              border: `1px solid color-mix(in oklab, ${CHIP_TONE[c.kind]} 45%, transparent)`,
            }),
          }}>{c.text}</span>
        ))}
      </div>
    </EdgeLabelRenderer>
  );
}

interface ArchEdgeData {
  points: [number, number][];
  labelAt: { cx: number; cy: number } | null;
  fullLabel?: string;
  weak?: boolean;
  dim?: boolean;
  lit?: boolean;
  chips?: EdgeChip[];
  [k: string]: unknown;
}

export function ArchEdge({ id, data, label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, interactionWidth }: EdgeProps) {
  const d = data as ArchEdgeData | undefined;
  const pts = d?.points ?? [];
  if (pts.length < 2) return null;
  const at = d?.labelAt;
  const opacity = d?.dim ? 0.12 : d?.lit ? 1 : (style?.opacity as number | undefined);
  // The label may be cut to the spot the router found (arch_route labelW);
  // the full text rides a <title> so hover and text queries still see it.
  return (
    <g>
    {d?.fullLabel && <title>{d.fullLabel}</title>}
    <BaseEdge
      id={id}
      path={roundedPath(pts)}
      markerEnd={markerEnd}
      style={{ ...style, opacity, strokeWidth: d?.lit ? 3 : style?.strokeWidth }}
      interactionWidth={interactionWidth ?? 16}
      label={d?.chips && at ? undefined : label}
      labelX={at?.cx}
      labelY={at?.cy}
      labelStyle={{ ...labelStyle, opacity: d?.dim ? 0.2 : 1 }}
      labelShowBg
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
    />
    {d?.chips && at && label !== undefined && <EdgeChips chips={d.chips} cx={at.cx} cy={at.cy} dim={d.dim} title={d.fullLabel} />}
    </g>
  );
}
