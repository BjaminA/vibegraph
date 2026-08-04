import React from "react";
import { NodeActionStrip } from "./NodeActionStrip";
import { NodeHandles } from "./NodeHandles";
import { TextLine } from "../util/TextLine";

interface Props {
  data: { id: string; exc?: string | null; charBudget?: number };
}

const ACCENT = "var(--accent-error)";

export function RaiseNode({ data }: Props) {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <NodeHandles />
      <div style={{
        width: "100%", height: "100%",
        background: "color-mix(in oklab, var(--accent-error) 8%, transparent)",
        border: `1.5px solid ${ACCENT}`,
        clipPath: "polygon(0 0, calc(100% - 24px) 0, calc(100% - 12px) 38%, 100% 50%, calc(100% - 12px) 62%, calc(100% - 24px) 100%, 0 100%)",
        display: "flex", alignItems: "center",
        padding: "0 var(--node-action-reserve) 0 var(--node-pad-x)",
        gap: "var(--node-inline-gap)",
        boxSizing: "border-box",
        boxShadow: `0 0 14px color-mix(in oklab, var(--accent-error) 30%, transparent)`,
        filter: "drop-shadow(0 0 5px color-mix(in oklab, var(--accent-error) 35%, transparent))",
      }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <path d="M8 1 L15 13 L1 13 Z" fill="color-mix(in oklab, var(--accent-error) 18%, transparent)" stroke={ACCENT} strokeWidth="1.5" strokeLinejoin="round"/>
          <line x1="8" y1="6" x2="8" y2="10" stroke={ACCENT} strokeWidth="2" strokeLinecap="round"/>
          <circle cx="8" cy="12" r="1" fill={ACCENT}/>
        </svg>
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div style={{ color: ACCENT, fontSize: 8.5, fontWeight: 700, fontFamily: "monospace", opacity: 0.8, letterSpacing: "0.06em" }}>RAISE</div>
          <TextLine
            text={data.exc ?? ""}
            maxChars={data.charBudget ?? 28}
            style={{ color: "var(--accent-error)", fontSize: 11, fontFamily: "monospace", opacity: 0.85, display: "block" }}
          />
        </div>
      </div>
      <NodeActionStrip nodeId={data.id} accentColor={ACCENT} />
    </div>
  );
}
