// M17.3 — control-flow container node.
//
// Renders a bounded region behind a group of regular thread nodes —
// "this whole subtree runs under try/finally/while/except". The size
// + position are computed by ThreadView from the descendants' layout
// positions before this component renders; this component is a
// presentational shell only.
//
// Visual contract per PLAN-v3-revised §E.5 + the VibeGraph aesthetic
// skill:
//   - Bordered rounded-rect, 14px corner radius. Curves not corners.
//   - 1px border at ~45% of the family accent. Subtle enough to read
//     as a region, not a wall.
//   - 4% accent tint over --bg-canvas as background. Children's own
//     accents stay readable; the container is a wash, not a panel.
//   - Top-left chip label ("TRY" / "FINALLY" / "EXCEPT ValueError" /
//     "WHILE cond"). Inter 11px (the aesthetic floor — never 10px),
//     letter-spacing 0.08em, uppercase, accent-colored.
//   - No pulse, no drop-shadow filter, no icon. Containers are static
//     visual anchors; the energy lives on the edges + the nodes
//     inside them.
//
// Family mapping (colour_for_node.containerAccent):
//   try / finally / while → --accent-thread (Family 1, control flow)
//   except                → --accent-error  (only red — exception path)

import React, { useRef } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";
import type { ContainerKind } from "./types";
import { tierForZoom, lodLabelFontSize } from "./lod";
import { chipHeight, chipLabel, chipMaxWidth, CHIP_LEFT, CHIP_MAX_LINES, MIN_BOX_W } from "./chipPlacement";

// §5.6 — number of target ports distributed along the container's entry
// border. Multiple flow/fork edges converging on one container would
// otherwise collapse onto a single centre handle and cross heavily at
// fit-zoom. ThreadView assigns each converging edge a port via
// `targetHandle: "t{i}"`, sorted by source position so they fan in
// monotonically (no crossing). MUST match the slot math in ThreadView.
// Single-incoming containers get the centre port (`t${(N-1)/2}` = 50%),
// coordinate-identical to the old single handle. Bump if a container ever
// has more than this many incoming joins.
export const TARGET_PORTS = 5;

export interface ThreadContainerData {
  containerKind: ContainerKind;
  label: string;
  /** other blocks around the very same cards, folded into this box */
  alsoIn?: number;
  /** The chip's left offset when a sibling's chip would sit under it (chipPlacement.ts). */
  chipLeft?: number;
  /** The container's drawn width — the chip never runs past it. */
  boxWidth?: number;
  accentVar: string;
  /** The container's own identity, so its CHIP can open the same tooltip
   *  every other node opens. A `for`/`if`/`while`/`try` has source and
   *  showed none: hovering one did nothing at all, in every language. */
  nodeId?: string;
  irNodeId?: string | null;
  file?: string | null;
  // M24 — flow/fork edges terminate ON containers, so they carry the
  // same orientation-aware hidden handles as ThreadNode.
  orientation?: "vertical" | "horizontal";
  // Width / height come from the React Flow node style block (set by
  // ThreadView once the descendants' bounding box is known). The
  // component reads them off the wrapping div so the inner layout
  // can position the label without hardcoding canvas dims.
}


// M17.3 — `if_else` reads as "the other branch": same teal family as
// if_then but a touch quieter (lower border + tint opacity) so a then/else
// pair is visually subordinated, the then arm leading. Every other kind
// uses the standard region weights.
const TINT = {
  default: { bg: 4, border: 45, chipBg: 14, chipBorder: 55 },
  if_else: { bg: 3, border: 32, chipBg: 10, chipBorder: 42 },
} as const;

export function ThreadContainerNode({ data }: NodeProps) {
  const d = data as unknown as ThreadContainerData;
  const accentVar = d.accentVar ?? "--accent-thread";
  // chipPlacement.ts owns the text and moves a chip clear of a sibling's.
  const chipText = chipLabel(d.label, d.alsoIn ?? 0, d.boxWidth);
  // The CHIP is the hover target, not the region: the region spans every
  // child, so a tooltip bound to it would open whenever the cursor
  // crossed a loop. A container with no IR identity (the synthetic
  // `nest` container has none) stays inert rather than opening an empty
  // tooltip.
  const chipRef = useRef<HTMLDivElement>(null);
  const chipHoverable = !!d.nodeId && !!d.irNodeId && !!d.file;
  const emitChip = (type: "vg-thread-node-hover" | "vg-thread-node-leave" | "vg-thread-node-click") => {
    const rect = chipRef.current?.getBoundingClientRect();
    document.dispatchEvent(new CustomEvent(type, {
      detail: {
        nodeId: d.nodeId,
        irNodeId: d.irNodeId,
        file: d.file,
        kind: "container",
        label: d.label,
        preview: null,
        anchor: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      },
    }));
  };
  const tint = d.containerKind === "if_else" ? TINT.if_else : TINT.default;
  // M-NA7 — semantic zoom: below the full tier the chip scales with
  // inverse zoom (like ThreadNode's LOD label) so control-flow regions
  // stay readable landmarks in the overview. Quantized selector — one
  // re-render per tier change.
  const tier = useStore((s) => tierForZoom(s.transform[2]));
  // 2026-10-07 — but never past the room the layout reserved for it: the
  // boxes are spaced for the chip at 11px (chipHeight), so a chip that grew
  // with zoom-out wrapped taller and slid over the nested chip and the first
  // card below it (two nested for-of loops in a test). Below full zoom the
  // chip is ONE line ending in "…", grown only until that line fills its
  // reserved height; the whole label stays its title and its tooltip.
  const reservedH = chipHeight(chipText, d.boxWidth);
  const lodCapPx = Math.max(11, Math.floor((reservedH - 6) / 1.35));

  return (
    <div
      data-thread-container
      data-container-kind={d.containerKind}
      className={`vg-thread-container vg-thread-container-${d.containerKind}`}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: `color-mix(in oklab, var(${accentVar}) ${tint.bg}%, var(--bg-canvas))`,
        border: `1px solid color-mix(in oklab, var(${accentVar}) ${tint.border}%, transparent)`,
        borderRadius: 14,
        // No filter / drop-shadow — containers don't pulse. Static
        // backdrop only. The edges + child nodes carry the motion.
        pointerEvents: "none",
      }}
    >
      {/* M24 — hidden handles so flow joins (try→finally) and fork
          arrows (predecessor→arm) can anchor on the container bounds,
          following the layout's main axis like ThreadNode.
          §5.6 — N target ports spread along the entry border so
          converging edges don't collapse onto one anchor (ThreadView
          picks one per edge via targetHandle). Source stays single. */}
      {Array.from({ length: TARGET_PORTS }).map((_, i) => {
        const horizontal = d.orientation === "horizontal";
        const frac = `${((i + 1) / (TARGET_PORTS + 1)) * 100}%`;
        return (
          <Handle
            key={i}
            id={`t${i}`}
            type="target"
            position={horizontal ? Position.Left : Position.Top}
            style={{
              opacity: 0,
              pointerEvents: "none",
              ...(horizontal ? { top: frac } : { left: frac }),
            }}
          />
        );
      })}
      <Handle
        type="source"
        position={d.orientation === "horizontal" ? Position.Right : Position.Bottom}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <div
        className="vg-thread-container-chip"
        data-container-chip={d.containerKind}
        onMouseEnter={chipHoverable ? () => emitChip("vg-thread-node-hover") : undefined}
        onMouseLeave={chipHoverable ? () => emitChip("vg-thread-node-leave") : undefined}
        onClick={chipHoverable ? (e) => { e.stopPropagation(); emitChip("vg-thread-node-click"); } : undefined}
        ref={chipRef}
        title={d.label}
        style={{
          position: "absolute",
          top: -10,
          left: d.chipLeft ?? CHIP_LEFT,
          cursor: chipHoverable ? "pointer" : "default",
          padding: "2px 8px",
          background: `color-mix(in oklab, var(${accentVar}) ${tint.chipBg}%, var(--bg-canvas))`,
          border: `1px solid color-mix(in oklab, var(${accentVar}) ${tint.chipBorder}%, transparent)`,
          borderRadius: 4,
          color: `var(${accentVar})`,
          fontFamily: "var(--font-ui)",
          fontSize: tier === "full" ? 11 : lodLabelFontSize(11, lodCapPx),
          fontWeight: 600,
          letterSpacing: "0.08em",
          lineHeight: 1.35,
          // Letter-spacing widens the chip slightly; keep it readable
          // by mixing uppercase keyword with mixed-case body via the
          // double-space separator in chipLabel (chipPlacement.ts).
          // 2026-10-02 — capped and WRAPPED (at most two lines, chipLabel
          // ends the rest in "…"), never wider than its own container: a
          // long for-of header used to run far off to the right.
          // border-box: the cap includes the padding (chipPlacement's line
          // estimate already subtracts it) — a one-line chip fills its cap
          boxSizing: "border-box",
          maxWidth: Math.min(chipMaxWidth(d.boxWidth), Math.max(80, (d.boxWidth ?? MIN_BOX_W) - (d.chipLeft ?? CHIP_LEFT) - 12)),
          overflow: "hidden",
          ...(tier === "full"
            ? { whiteSpace: "normal", overflowWrap: "anywhere", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: CHIP_MAX_LINES }
            : { whiteSpace: "nowrap", textOverflow: "ellipsis", display: "block" }),
          pointerEvents: "auto",
        }}
      >
        {chipText}
      </div>
    </div>
  );
}
