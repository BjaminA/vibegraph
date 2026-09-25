// The architecture map's edge: the orthogonal route archLayout computed
// (arch_route.ts), drawn as-is, with the label at the spot the router found
// free of cards and other labels. react-flow's own handle coordinates are
// ignored on purpose — the route is the geometry. A trace (route / reach /
// story) dims every edge it does not include.

import React from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { roundedPath } from "./arch_route";

interface ArchEdgeData {
  points: [number, number][];
  labelAt: { cx: number; cy: number } | null;
  fullLabel?: string;
  weak?: boolean;
  dim?: boolean;
  lit?: boolean;
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
      label={label}
      labelX={at?.cx}
      labelY={at?.cy}
      labelStyle={{ ...labelStyle, opacity: d?.dim ? 0.2 : 1 }}
      labelShowBg
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
    />
    </g>
  );
}
