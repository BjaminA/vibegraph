// PLAN-v7 Stage 3 — the ghost subsystem card: a PLANNED architectural node
// (Claude's or a fixture's proposal), never honest IR. Distinct from the
// solid SubsystemNode: dashed --proposed-* ring, an unmissable "PLANNED —
// not yet built" badge, and the per-item GROUNDING chip — either a quote
// from the user's description (the plan traces to their words) or an
// explicit ⚠ INFERRED tag when Claude proposed it unasked. --accent-warning
// is exactly its reserved meaning here: ambiguity the user should treat
// with care at the ratification gate.
//
// The kind icon/accent reuses subsystemVisual so a planned db reads as the
// same *kind* of thing as a built db — the ghost treatment (not a new hue)
// is what says "not real yet".

import React from "react";
import { Handle, Position } from "@xyflow/react";
import { TriangleAlert, Quote } from "lucide-react";
import type { PlannedSubsystem } from "../types";
import { subsystemVisual } from "./subsystem_visual";

export function PlannedSubsystemNode({
  data,
}: {
  data: { planned: PlannedSubsystem; ratified: boolean; drafted: boolean };
}) {
  const p = data.planned;
  const { accent, icon: Icon } = subsystemVisual(p.kind);
  const a = `var(${accent})`;
  const inferred = p.groundedIn == null;

  return (
    <div
      className="vg-planned-subsystem-node"
      data-planned-subsystem
      data-subsystem-kind={p.kind}
      data-subsystem-id={p.id}
      data-plan-ratified={data.ratified ? "true" : "false"}
      style={{
        minWidth: 200,
        maxWidth: 260,
        background: "var(--bg-node)",
        border: "1.5px dashed var(--proposed-border)",
        borderRadius: 14,
        padding: "12px 16px",
        opacity: "var(--proposed-opacity)",
        boxShadow: "0 0 14px var(--proposed-glow)",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />

      {/* the honesty label — always visible, never subtle */}
      <div
        data-planned-badge
        style={{
          fontSize: "var(--fs-11)",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-muted)",
          marginBottom: 8,
        }}
      >
        Planned — not yet built
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: `color-mix(in oklab, ${a} 14%, transparent)`,
            color: a,
          }}
        >
          <Icon size={16} strokeWidth={1.5} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--font-ui)", fontSize: "var(--fs-13)", fontWeight: 600,
              color: "var(--text-primary)", whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {p.label}
          </div>
          <div
            style={{
              fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)",
              color: "var(--text-muted)",
            }}
          >
            {p.kind.replace("_", " ")}
          </div>
        </div>
      </div>

      {/* grounding chip: traceable to the user's words, or honestly INFERRED */}
      {inferred ? (
        <div
          data-plan-inferred
          style={{
            marginTop: 8, display: "flex", alignItems: "center", gap: 6,
            fontFamily: "var(--font-mono)", fontSize: "var(--fsm-12)",
            color: "var(--accent-warning)",
            background: "color-mix(in oklab, var(--accent-warning) 10%, transparent)",
            borderRadius: 6, padding: "3px 8px",
          }}
        >
          <TriangleAlert size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
          <span>INFERRED — not in your description</span>
        </div>
      ) : (
        <div
          data-plan-grounded
          title={`From your description: “${p.groundedIn}”`}
          style={{
            marginTop: 8, display: "flex", alignItems: "flex-start", gap: 6,
            fontFamily: "var(--font-mono)", fontSize: "var(--fsm-12)",
            color: "var(--proposed-accent)",
            background: "color-mix(in oklab, var(--proposed-accent) 8%, transparent)",
            borderRadius: 6, padding: "3px 8px", lineHeight: 1.45,
          }}
        >
          <Quote size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
          <span>“{p.groundedIn}”</span>
        </div>
      )}
    </div>
  );
}
