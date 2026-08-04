import React from "react";
import { NodeActionStrip } from "./NodeActionStrip";
import { NodeHandles } from "./NodeHandles";
import { TextLine } from "../util/TextLine";

interface Props {
  data: {
    id: string;
    condition: string;
    hasElse: boolean;
    charBudget?: number;
  };
}

const CONTROL_ACCENT = "var(--text-secondary)";

export function IfNode({ data }: Props) {
  return (
    <div style={{
      width: "100%", height: "100%",
      background: "var(--bg-node)",
      border: `2px solid ${CONTROL_ACCENT}`,
      borderLeft: `6px solid ${CONTROL_ACCENT}`,
      borderRadius: 8,
      boxSizing: "border-box",
      display: "flex", flexDirection: "column",
      overflow: "visible",
      position: "relative",
    }}>
      <NodeHandles />
      <NodeActionStrip nodeId={data.id} accentColor={CONTROL_ACCENT} />
      {/* header with diamond accent */}
      <div style={{
        background: "color-mix(in oklab, var(--text-secondary) 18%, transparent)",
        borderBottom: `1.5px solid ${CONTROL_ACCENT}`,
        borderRadius: "4px 4px 0 0",
        padding: "var(--node-pad-y) var(--node-action-reserve) var(--node-pad-y) var(--node-pad-x)",
        flexShrink: 0,
        display: "flex", alignItems: "center", gap: "var(--node-inline-gap)",
      }}>
        {/* diamond marker */}
        <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0 }}>
          <rect x="3" y="0" width="6" height="6" fill={CONTROL_ACCENT} transform="rotate(45 6 6)" />
        </svg>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-1)" }}>
          <span style={{ color: CONTROL_ACCENT, fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>if</span>
          <TextLine
            text={data.condition}
            maxChars={data.charBudget ?? 28}
            style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 600, fontFamily: "monospace" }}
          />
          {data.hasElse && (
            <span style={{ color: "var(--text-muted)", fontSize: 9, fontFamily: "monospace", marginLeft: "var(--sp-1)" }}>
              / else
            </span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, position: "relative" }} />
    </div>
  );
}
