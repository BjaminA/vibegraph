import React from "react";
import { NodeActionStrip } from "./NodeActionStrip";
import { NodeHandles } from "./NodeHandles";
import { TextLine } from "../util/TextLine";

interface Props {
  data: {
    id: string;
    target: string;
    iterName: string;
    charBudget?: number;
  };
}

const CONTROL_ACCENT = "var(--text-secondary)";

export function ForLoopNode({ data }: Props) {
  return (
    <div style={{
      width: "100%", height: "100%",
      background: "var(--bg-node)",
      border: `2px solid ${CONTROL_ACCENT}`,
      borderRadius: "24px 8px 8px 24px",
      boxSizing: "border-box",
      display: "flex", flexDirection: "column",
      overflow: "visible",
      position: "relative",
    }}>
      <NodeHandles />
      <NodeActionStrip nodeId={data.id} accentColor={CONTROL_ACCENT} />
      <div style={{
        background: "color-mix(in oklab, var(--text-secondary) 15%, transparent)",
        borderBottom: `1.5px solid ${CONTROL_ACCENT}`,
        borderRadius: "22px 6px 0 0",
        padding: "var(--node-pad-y) var(--node-action-reserve) var(--node-pad-y) var(--node-pad-x)",
        flexShrink: 0,
        display: "flex", alignItems: "center", gap: "var(--node-inline-gap)",
      }}>
        <div style={{ width: 20, height: 20, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3 9 A6 6 0 1 1 9 15" stroke={CONTROL_ACCENT} strokeWidth="2" strokeLinecap="round" fill="none" />
            <polygon points="2,6 6,9 2,12" fill={CONTROL_ACCENT} />
          </svg>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-1)" }}>
            <span style={{ color: CONTROL_ACCENT, fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>for</span>
            <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{data.target}</span>
            <span style={{ color: CONTROL_ACCENT, fontSize: 9, fontFamily: "monospace" }}>in</span>
          </div>
          <TextLine
            text={data.iterName}
            maxChars={data.charBudget ?? 28}
            style={{ color: "var(--text-secondary)", fontSize: 11, fontFamily: "monospace", display: "block" }}
          />
        </div>
      </div>
      <div style={{ flex: 1, position: "relative" }} />
    </div>
  );
}
