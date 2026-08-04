import React from "react";
import { FunctionIcon, PortDot, ReturnArrow } from "./icons";
import { NodeActionStrip } from "./NodeActionStrip";
import { NodeHandles } from "./NodeHandles";
import { TextLine } from "../util/TextLine";
import { docSummary, DOC_MAX_LINES } from "../util/docSummary";

interface Props {
  data: { id: string; name: string; params: string[]; docstring?: string | null };
}

const ACCENT = "var(--accent-thread)";

function parseParam(p: string): { name: string; default?: string } {
  const eq = p.indexOf("=");
  if (eq === -1) return { name: p };
  return { name: p.slice(0, eq), default: p.slice(eq + 1) };
}

export function FunctionDefNode({ data }: Props) {
  const isDunder = data.name.startsWith("__") && data.name.endsWith("__");
  const params = (data.params ?? []).filter((p) => p !== "self" && p !== "cls");
  const hasReturn = true; // all functions can return

  return (
    <div style={{
      width: "100%", height: "100%",
      background: "var(--bg-node)",
      border: `2px solid ${ACCENT}`,
      borderRadius: 12,
      boxSizing: "border-box",
      display: "flex", flexDirection: "column",
      boxShadow: `0 0 20px color-mix(in oklab, var(--accent-thread) 15%, transparent), 0 4px 24px color-mix(in oklab, var(--bg-canvas) 50%, transparent)`,
      overflow: "visible",
      position: "relative",
    }}>
      <NodeHandles />
      {/* Sitting-2 — no expand chevron: its overlay is a placeholder that
          shows less than "Edit source" does (see NodeActionStrip). */}
      <NodeActionStrip nodeId={data.id} accentColor={ACCENT} showPin showExpand={false} />
      {/* ── title band — gradient fades from accent to node bg, evoking the dim-end of the original two-stop teal gradient ── */}
      <div style={{
        background: `linear-gradient(135deg, color-mix(in oklab, var(--accent-thread) 80%, var(--bg-node)) 0%, color-mix(in oklab, var(--accent-thread) 30%, var(--bg-node)) 50%, var(--bg-node) 100%)`,
        borderRadius: "10px 10px 0 0",
        padding: "var(--node-pad-y) var(--node-pad-x)",
        display: "flex", alignItems: "center", gap: "var(--node-inline-gap)",
        flexShrink: 0,
        borderBottom: `1px dashed color-mix(in oklab, var(--accent-thread) 27%, transparent)`,
        position: "relative",
      }}>
        <FunctionIcon size={26} color={ACCENT} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: isDunder ? "var(--text-secondary)" : "var(--text-primary)",
            fontSize: 14, fontWeight: 800,
            fontFamily: "monospace", letterSpacing: "0.02em",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {data.name}
          </div>
          {/* The summary line, not the whole docstring — see docSummary.ts for
              why (the detail paragraphs are on hover, and the layout reserves
              exactly the lines this paints). NO `display` override here: that
              is what silently killed .vg-node-code's clamp and let the band
              grow through the statements below it. */}
          {docSummary(data.docstring) && (
            <TextLine
              text={docSummary(data.docstring)}
              title={data.docstring ?? undefined}
              clampLines={DOC_MAX_LINES}
              style={{
                // Was 9px --text-muted: below the 11px type floor and barely
                // legible over the accent-washed band.
                color: "var(--text-primary)", fontSize: 11,
                fontStyle: "italic", marginTop: 2,
              }}
            />
          )}
        </div>
        {/* return port indicator */}
        {hasReturn && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)", flexShrink: 0 }}>
            <ReturnArrow color={ACCENT} />
          </div>
        )}
      </div>

      {/* ── params section — meta about the function, hugs the header tightly ── */}
      {params.length > 0 && (
        <div style={{
          padding: "var(--node-meta-pad-y) var(--node-pad-x) var(--node-meta-pad-y) 0",
          borderBottom: `1px solid color-mix(in oklab, var(--accent-thread) 13%, transparent)`,
          display: "flex", flexDirection: "column", gap: "var(--node-row-gap)",
          flexShrink: 0,
          background: "color-mix(in oklab, var(--accent-thread) 4%, transparent)",
        }}>
          {params.map((p, i) => {
            const parsed = parseParam(p);
            return (
              <div key={i} data-fn-param={parsed.name} style={{
                display: "flex", alignItems: "center",
                paddingLeft: 0,
                position: "relative",
              }}>
                {/* port dot hanging off left edge */}
                <div style={{
                  position: "absolute", left: -6, top: "50%",
                  transform: "translateY(-50%)",
                  filter: `drop-shadow(0 0 4px ${ACCENT})`,
                }}>
                  <PortDot color={ACCENT} filled />
                </div>
                <div style={{ paddingLeft: "var(--sp-4)", display: "flex", alignItems: "baseline", gap: "var(--sp-1)" }}>
                  <span style={{ color: "var(--accent-thread)", fontSize: 11, fontFamily: "monospace", fontWeight: 600 }}>
                    {parsed.name}
                  </span>
                  {parsed.default !== undefined && (
                    <>
                      <span style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "monospace" }}>=</span>
                      <span style={{ color: "color-mix(in oklab, var(--text-secondary) 30%, var(--text-primary))", fontSize: 10, fontFamily: "monospace" }}>
                        {parsed.default}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* body area — React Flow places children here */}
      <div style={{ flex: 1, position: "relative" }} />
    </div>
  );
}
