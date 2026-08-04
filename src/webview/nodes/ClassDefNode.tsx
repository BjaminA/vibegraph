import React from "react";
import { ClassIcon } from "./icons";
import { NodeActionStrip } from "./NodeActionStrip";
import { NodeHandles } from "./NodeHandles";

interface Props {
  data: { id: string; name: string; bases: string[] };
}

const ACCENT = "var(--accent-thread)";

export function ClassDefNode({ data }: Props) {
  const basesStr = (data.bases ?? []).join(", ");

  return (
    <div style={{
      width: "100%", height: "100%",
      background: "var(--bg-canvas)",
      border: `2px solid ${ACCENT}`,
      borderRadius: 8,
      boxSizing: "border-box",
      display: "flex", flexDirection: "column",
      boxShadow: `0 0 24px color-mix(in oklab, var(--accent-thread) 12%, transparent), 0 6px 32px color-mix(in oklab, var(--bg-canvas) 60%, transparent)`,
      overflow: "visible",
      position: "relative",
    }}>
      <NodeHandles />
      <NodeActionStrip nodeId={data.id} accentColor={ACCENT} />
      {/* corner tick marks — engineering / blueprint aesthetic */}
      {[["0","0","0,6 0,0 6,0"],["calc(100% - 0px)","0","0,0 8,0 8,6"],
        ["0","calc(100% - 0px)","0,-6 0,0 6,0"],["calc(100% - 0px)","calc(100% - 0px)","0,0 8,0 8,-6"]
      ].map(([x, y, pts], i) => (
        <svg key={i} width="10" height="10" viewBox="0 0 8 8" fill="none"
          style={{ position: "absolute", left: x, top: y, pointerEvents: "none" }}>
          <polyline points={pts} stroke={ACCENT} strokeWidth="1.5" fill="none" opacity="0.6"/>
        </svg>
      ))}

      {/* header band */}
      <div style={{
        background: `linear-gradient(135deg, color-mix(in oklab, var(--accent-thread) 18%, transparent) 0%, color-mix(in oklab, var(--accent-thread) 5%, transparent) 100%)`,
        borderBottom: `1.5px solid ${ACCENT}`,
        borderRadius: "6px 6px 0 0",
        padding: "var(--node-pad-y) var(--node-pad-x)",
        flexShrink: 0,
        display: "flex", alignItems: "center", gap: "var(--node-pad-x)",
      }}>
        <ClassIcon color={ACCENT} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-2)" }}>
            <span style={{ color: ACCENT, fontSize: 9, fontWeight: 700, fontFamily: "monospace", opacity: 0.8, letterSpacing: "0.08em" }}>
              CLASS
            </span>
          </div>
          <div style={{
            color: "var(--text-primary)", fontSize: 16, fontWeight: 900,
            fontFamily: "monospace", letterSpacing: "0.04em",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {data.name}
          </div>
          {basesStr && (
            <div style={{ color: "var(--text-secondary)", fontSize: 10, fontFamily: "monospace", marginTop: 1 }}>
              ⇡ {basesStr}
            </div>
          )}
        </div>
      </div>

      {/* body — React Flow places members here */}
      <div style={{ flex: 1, position: "relative" }} />
    </div>
  );
}
