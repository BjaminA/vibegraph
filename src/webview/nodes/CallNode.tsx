import React from "react";
import { TerminalIcon } from "./icons";
import { NodeActionStrip } from "./NodeActionStrip";
import { NodeHandles } from "./NodeHandles";
import { TextLine } from "../util/TextLine";

interface Props {
  data: { id: string; funcName: string; args: string[]; isEffect: boolean; charBudget?: number };
}

// Phase 4: I/O calls (print, write, etc.) now use --accent-io (violet),
// not --accent-error (red). Red is now reserved for raises/exceptions
// per design/COLOURS.md.
const ACCENT_EFFECT = "var(--accent-io)";
const ACCENT_PURE   = "var(--text-secondary)";

function GenericCallIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <text x="1" y="16" fill={color} fontSize="15" fontWeight="900" fontFamily="monospace">(</text>
      <path d="M9 7 L13 11 L9 15" stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"/>
      <text x="15" y="16" fill={color} fontSize="15" fontWeight="900" fontFamily="monospace">)</text>
    </svg>
  );
}

export function CallNode({ data }: Props) {
  const accent = data.isEffect ? ACCENT_EFFECT : ACCENT_PURE;
  const glow = data.isEffect
    ? "color-mix(in oklab, var(--accent-io) 30%, transparent)"
    : "color-mix(in oklab, var(--text-secondary) 20%, transparent)";
  const fillTint = data.isEffect
    ? "color-mix(in oklab, var(--accent-io) 6%, transparent)"
    : "color-mix(in oklab, var(--text-secondary) 6%, transparent)";
  // Args are code the user reads — tint with the accent but keep the base
  // near --text-primary (the old 60%-to-transparent mix was illegibly dim).
  const argsTint = data.isEffect
    ? "color-mix(in oklab, var(--accent-io) 45%, var(--text-primary))"
    : "color-mix(in oklab, var(--text-secondary) 30%, var(--text-primary))";
  const argsStr = (data.args ?? []).join(", ");
  const isPrint = data.funcName === "print";

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <NodeHandles />
      <div style={{
        width: "100%", height: "100%",
        background: fillTint,
        border: `1.5px solid ${accent}`,
        clipPath: "polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)",
        boxSizing: "border-box",
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "var(--node-pad-y) var(--node-action-reserve) var(--node-pad-y) var(--sp-5)",
        boxShadow: `0 0 18px ${glow}`,
        filter: `drop-shadow(0 0 6px ${glow})`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--node-inline-gap)" }}>
          {isPrint
            ? <TerminalIcon color={ACCENT_EFFECT} />
            : <GenericCallIcon color={accent} />}
          <span className="vg-node-code" title={data.funcName} style={{
            // Effect calls keep the bright I/O blue; pure calls read in
            // primary (the grey accent stays on border/icon, not the name).
            color: data.isEffect ? accent : "var(--text-primary)",
            fontSize: 12, fontWeight: 800,
            fontFamily: "monospace",
            // A call target is ONE identifier chain — never soft-break it
            // mid-token (`super().__in / it__`); if it truly can't fit, the
            // clamp clips it whole and the title reveals the full name.
            overflowWrap: "normal", wordBreak: "normal",
          }}>
            {data.funcName}
          </span>
        </div>
        {argsStr && (
          <div style={{
            paddingLeft: "var(--sp-6)",
            marginTop: 1,
          }}>
            <TextLine
              text={argsStr}
              maxChars={data.charBudget ?? 32}
              style={{
                color: argsTint, fontSize: 10, fontFamily: "monospace",
              }}
            />
          </div>
        )}
      </div>
      <NodeActionStrip nodeId={data.id} accentColor={accent} />
    </div>
  );
}
