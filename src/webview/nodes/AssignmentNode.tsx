import React from "react";
import { ValueKindIcon } from "./icons";
import { NodeActionStrip } from "./NodeActionStrip";
import { NodeHandles } from "./NodeHandles";
import { TextLine } from "../util/TextLine";

interface Props {
  data: {
    id: string;
    name: string;
    valueKind: string;
    preview: string;
    // Type-annotation source for annotated assignments (`uid: int`). When
    // there's no RHS the node renders `name : annotation` instead of
    // `name = value`.
    annotation?: string;
    // Character budget for the value text, sized to the node's (now
    // content-driven) width by buildLayout. Falls back to a fixed default.
    charBudget?: number;
    // Phase 6: when true (set by buildLayout for `self.X` assignments
    // inside a class method, and for dataclass-style class-body fields),
    // render the compact single-row layout `[icon] name [=] value`
    // instead of the two-row card.
    compact?: boolean;
  };
}

// Per-kind accent — keeps the visual distinction the original palette had,
// but every colour now routes through a semantic design token.
const KIND_ACCENT: Record<string, { stroke: string; glow: string; label: string }> = {
  scalar:  { stroke: "var(--accent-warning)", glow: "color-mix(in oklab, var(--accent-warning) 25%, transparent)", label: "number"   },
  string:  { stroke: "var(--accent-warning)", glow: "color-mix(in oklab, var(--accent-warning) 22%, transparent)", label: "string"   },
  fstring: { stroke: "var(--accent-warning)", glow: "color-mix(in oklab, var(--accent-warning) 18%, transparent)", label: "f-string" },
  list:    { stroke: "var(--accent-thread)",  glow: "color-mix(in oklab, var(--accent-thread) 22%, transparent)",  label: "list"     },
  dict:    { stroke: "var(--text-secondary)", glow: "color-mix(in oklab, var(--text-secondary) 22%, transparent)", label: "dict"     },
  tuple:   { stroke: "var(--accent-thread)",  glow: "color-mix(in oklab, var(--accent-thread) 16%, transparent)",  label: "tuple"    },
  set:     { stroke: "var(--text-secondary)", glow: "color-mix(in oklab, var(--text-secondary) 18%, transparent)", label: "set"      },
  call:    { stroke: "var(--text-secondary)", glow: "color-mix(in oklab, var(--text-secondary) 22%, transparent)", label: "call"     },
  other:   { stroke: "var(--text-muted)",     glow: "color-mix(in oklab, var(--text-muted) 15%, transparent)",     label: "ref"      },
};

// Decides what trails the name: `= value` for a real RHS (incl. `= None`,
// where preview is "None"), `: annotation` for an annotation-only declaration
// (`uid: int`, empty preview), and — when there is neither — the name alone
// with NO operator (never a dangling `=` with empty text).
function rhsOf(data: Props["data"]): { op: string; text: string } {
  const hasValue = !!(data.preview && data.preview.length > 0);
  if (hasValue) return { op: "=", text: data.preview! };
  if (data.annotation) return { op: ":", text: data.annotation };
  return { op: "", text: "" };
}

export function AssignmentNode({ data }: Props) {
  const theme = KIND_ACCENT[data.valueKind] ?? KIND_ACCENT.other;
  if (data.compact) return <CompactRow data={data} theme={theme} />;
  const { op, text } = rhsOf(data);

  return (
    <div style={{
      width: "100%", height: "100%",
      background: "var(--bg-node)",
      border: `1.5px solid ${theme.stroke}`,
      borderRadius: 10,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      boxSizing: "border-box",
      boxShadow: `0 0 14px ${theme.glow}, inset 0 0 20px color-mix(in oklab, var(--bg-canvas) 60%, transparent)`,
      position: "relative",
    }}>
      <NodeHandles />
      <NodeActionStrip nodeId={data.id} accentColor={theme.stroke} />
      {/* header row: icon + kind label + name */}
      <div style={{
        display: "flex", alignItems: "center", gap: "var(--node-inline-gap)",
        padding: "var(--node-pad-y) var(--node-action-reserve) var(--node-pad-y) var(--node-pad-x)",
        background: `linear-gradient(135deg, color-mix(in oklab, ${theme.stroke} 13%, transparent) 0%, transparent 100%)`,
        borderBottom: `1px solid color-mix(in oklab, ${theme.stroke} 20%, transparent)`,
        flexShrink: 0,
      }}>
        <ValueKindIcon kind={data.valueKind} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <span style={{ color: theme.stroke, fontSize: 9, fontWeight: 700, fontFamily: "monospace", opacity: 0.5 }}>
              {theme.label}
            </span>
            <span className="vg-node-code" title={data.name} style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>
              {data.name}
            </span>
          </div>
        </div>
        {/* assignment / annotation operator */}
        <span style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 600, fontFamily: "monospace", flexShrink: 0 }}>{op}</span>
      </div>

      {/* value preview */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center",
        padding: "var(--node-pad-y) var(--node-pad-x)",
        overflow: "hidden",
      }}>
        <TextLine
          text={text}
          maxChars={data.charBudget ?? 36}
          clampLines={Math.max(3, text.split("\n").length)}
          style={{
            // Kind-tinted but lifted hard toward --text-primary: the raw
            // stroke (grey for call/dict/set) was too dim to read as code.
            color: `color-mix(in oklab, ${theme.stroke} 40%, var(--text-primary))`,
            fontSize: 11, fontFamily: "monospace",
            letterSpacing: "0.01em",
          }}
        />
      </div>
    </div>
  );
}

// Phase 6: single-row "field" layout for `self.X = …` inside a class method.
// Format: `[icon] self.name [=] value`. The plan's uniform `__init__`
// micro-layout — apply to any class-init assignment, not just `__init__`.
function CompactRow({ data, theme }: {
  data: Props["data"];
  theme: { stroke: string; glow: string; label: string };
}) {
  const { op, text } = rhsOf(data);
  return (
    <div style={{
      width: "100%", height: "100%",
      background: "var(--bg-node)",
      border: `1px solid color-mix(in oklab, ${theme.stroke} 60%, transparent)`,
      borderRadius: 6,
      display: "flex", alignItems: "center", gap: "var(--node-inline-gap)",
      padding: "var(--node-pad-y) var(--node-action-reserve) var(--node-pad-y) var(--node-pad-x)",
      boxSizing: "border-box",
      position: "relative",
      overflow: "hidden",
    }}>
      <NodeHandles />
      <NodeActionStrip nodeId={data.id} accentColor={theme.stroke} />
      <ValueKindIcon kind={data.valueKind} />
      <span title={data.name} style={{
        color: "var(--text-primary)",
        fontSize: 12, fontWeight: 600, fontFamily: "monospace",
        overflowWrap: "anywhere",
        flexShrink: 0,
      }}>
        {data.name}
      </span>
      <span style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "monospace", flexShrink: 0 }}>{op}</span>
      <TextLine
        text={text}
        maxChars={data.charBudget ?? 28}
        clampLines={Math.max(3, text.split("\n").length)}
        style={{
          color: `color-mix(in oklab, ${theme.stroke} 40%, var(--text-primary))`,
          fontSize: 11, fontFamily: "monospace",
          flex: 1, minWidth: 0,
        }}
      />
    </div>
  );
}
