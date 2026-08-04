import React from "react";
import { NodeActionStrip } from "./NodeActionStrip";
import { NodeHandles } from "./NodeHandles";
import { TextLine } from "../util/TextLine";

interface Props {
  data: { id: string; value?: string | null; charBudget?: number };
}

const ACCENT = "var(--text-secondary)";

export function ReturnNode({ data }: Props) {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <NodeHandles />
      <div style={{
        width: "100%", height: "100%",
        background: "color-mix(in oklab, var(--text-secondary) 8%, transparent)",
        border: `1.5px solid ${ACCENT}`,
        clipPath: "polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%)",
        display: "flex", alignItems: "center",
        padding: "0 var(--node-action-reserve) 0 var(--node-pad-x)",
        gap: "var(--node-inline-gap)",
        boxSizing: "border-box",
        boxShadow: `0 0 10px color-mix(in oklab, var(--text-secondary) 20%, transparent)`,
        filter: "drop-shadow(0 0 4px color-mix(in oklab, var(--text-secondary) 30%, transparent))",
      }}>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" style={{ flexShrink: 0 }}>
          <line x1="0" y1="6" x2="11" y2="6" stroke={ACCENT} strokeWidth="2" strokeLinecap="round"/>
          <path d="M7 2 L13 6 L7 10" stroke={ACCENT} strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div style={{ color: ACCENT, fontSize: 8.5, fontWeight: 700, fontFamily: "monospace", opacity: 0.7, letterSpacing: "0.06em" }}>RETURN</div>
          <TextLine
            text={data.value ?? "None"}
            maxChars={data.charBudget ?? 32}
            clampLines={Math.max(3, (data.value ?? "None").split("\n").length)}
            style={{ color: "var(--text-primary)", fontSize: 11, fontFamily: "monospace", display: "block" }}
          />
        </div>
      </div>
      <NodeActionStrip nodeId={data.id} accentColor={ACCENT} />
    </div>
  );
}
