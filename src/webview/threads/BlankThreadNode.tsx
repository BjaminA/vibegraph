// M16.2 — blank thread node.
//
// The user clicks "+ Add Node" in thread-view mode and a blank node
// appears on the canvas. The user then drags the small handle on its
// right edge to a target thread node; on release, ThreadNodeLinker
// fires `vg-thread-link-drop` with `{sourceId, targetId}`. M16.3 then
// uses inferLinkTarget to classify the target and stamps the blank
// with `resolved` data — funcName + placeholder args — so the visual
// flips from "(new node)" to a typed-but-uncommitted call /
// instantiation / reference card. The dashed border stays through
// M16.4 so the node still reads as "in progress" until M16.5 commits.
//
// Visual: dashed border in --accent-thread @ 55% mix (so it reads as
// "unfinished, in-progress"), translucent fill, lucide Plus glyph
// when unresolved (swaps to Phone for call / Box for instantiation /
// ArrowRight for reference once resolved), a small label. Right edge
// carries a 12 px visible link handle that's the linker's hit-target.

import React from "react";
import { type NodeProps } from "@xyflow/react";
import { Plus, Phone, Box, ArrowRight, type LucideIcon } from "lucide-react";

export type BlankResolvedType = "call" | "instantiation" | "reference";

export interface BlankResolved {
  type: BlankResolvedType;
  funcName: string;
  placeholderArgs: string[];
  targetIrNodeId: string;
}

export interface BlankThreadNodeData {
  // Stable id surfaced for the linker's pointerdown payload so the
  // ThreadNodeLinker can correlate the drag with the source blank.
  blankId: string;
  // M16.3 — populated once the user links the blank to a target and
  // inferLinkTarget classifies it. Drives funcName/args rendering.
  resolved?: BlankResolved;
  // M16.3 — transient rejection flash. Set on link-drop rejection;
  // ThreadCanvas clears after the animation finishes.
  rejected?: boolean;
}

const SIZE = { width: 180, height: 56 };
const HANDLE_SIZE = 12;

function startLinker(
  e: React.PointerEvent<HTMLDivElement>,
  blankId: string,
): void {
  if (e.button !== 0) return;       // left button only
  e.stopPropagation();              // don't let react-flow start a node-drag
  e.preventDefault();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  document.dispatchEvent(
    new CustomEvent("vg-thread-blank-linker-start", {
      detail: {
        blankId,
        origin: {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        },
      },
    }),
  );
}

// Icon picker for the resolved state. Matches the existing thread-view
// icon family — lucide, 1.5 stroke width.
function iconForResolved(type: BlankResolvedType): LucideIcon {
  switch (type) {
    case "call":          return Phone;
    case "instantiation": return Box;
    case "reference":     return ArrowRight;
  }
}

export function BlankThreadNode({ data }: NodeProps) {
  const { blankId, resolved, rejected } = (data as unknown) as BlankThreadNodeData;

  const Icon: LucideIcon = resolved ? iconForResolved(resolved.type) : Plus;

  // Rejection flash: a red box-shadow stacked on top of the normal
  // shadow. ThreadCanvas auto-clears `rejected` after ~600ms; that's
  // long enough for the user to read the flash without it lingering.
  const rejectionShadow = rejected
    ? "0 0 0 2px var(--accent-error), 0 0 14px color-mix(in oklab, var(--accent-error) 55%, transparent), "
    : "";

  return (
    <div
      data-blank-thread-node="true"
      data-blank-id={blankId}
      data-blank-resolved={resolved ? resolved.type : "unresolved"}
      data-blank-rejected={rejected ? "true" : "false"}
      style={{
        width: SIZE.width,
        minHeight: SIZE.height,
        border: "1.5px dashed color-mix(in oklab, var(--accent-thread) 55%, transparent)",
        borderRadius: 12,
        background: "color-mix(in oklab, var(--accent-thread) 6%, var(--bg-node))",
        color: "var(--text-secondary)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "8px 20px 8px 12px",
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        boxShadow: `${rejectionShadow}var(--shadow-control)`,
        position: "relative",
        transition: "box-shadow 200ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon
          size={resolved ? 16 : 20}
          strokeWidth={1.5}
          color="var(--accent-thread)"
          aria-hidden
        />
        {resolved ? (
          <span
            data-blank-funcname={resolved.funcName}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: "var(--text-primary)",
            }}
          >
            {resolved.funcName}
          </span>
        ) : (
          <span style={{ opacity: 0.75 }}>new node</span>
        )}
      </div>

      {/* Placeholder arg list — visible only when resolved AND args
          exist. Each arg is rendered as a small mono pill so the user
          can scan the signature at a glance. M16.4 will turn these
          into editable rows in the ArgumentEditorPanel. */}
      {resolved && resolved.placeholderArgs.length > 0 && (
        <div
          data-blank-args-list="true"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-secondary)",
          }}
        >
          {resolved.placeholderArgs.map((p, i) => (
            <span
              key={`${p}-${i}`}
              data-blank-arg={p}
              style={{
                padding: "1px 5px",
                borderRadius: 4,
                border:
                  "1px solid color-mix(in oklab, var(--border-edge) 70%, transparent)",
                background:
                  "color-mix(in oklab, var(--bg-canvas) 70%, transparent)",
              }}
            >
              {p}
            </span>
          ))}
        </div>
      )}

      {/* Link handle on the right edge. The hit area is HANDLE_SIZE px
          but the visible dot is smaller; we want a generous mousedown
          target without a heavy dot competing with the dashed border.
          The handle stays available after resolution so M16.4 / M16.5
          can re-target the link without forcing a re-create. */}
      <div
        data-blank-thread-node-handle="true"
        role="button"
        aria-label="Drag to link this new node to a thread step"
        onPointerDown={(e) => startLinker(e, blankId)}
        style={{
          position: "absolute",
          right: -(HANDLE_SIZE / 2),
          top: `calc(50% - ${HANDLE_SIZE / 2}px)`,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          borderRadius: HANDLE_SIZE,
          background: "var(--accent-thread)",
          boxShadow:
            "0 0 8px color-mix(in oklab, var(--accent-thread) 55%, transparent)",
          cursor: "crosshair",
          touchAction: "none",
        }}
      />
    </div>
  );
}
