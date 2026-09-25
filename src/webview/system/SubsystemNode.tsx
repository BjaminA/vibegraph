// Subsystem card — a custom react-flow node for the system view (M19.2).
// Bound entirely to tokens.css; lucide icons only; hover-lift (not
// shadow) is the depth cue (box-shadow keyframe, never `filter` — the
// hit-test caveat). Backend expands to reveal its route endpoints
// (progressive disclosure, your Q1 default).

import React, { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { Subsystem } from "../types";
import type { StackIndexRecord } from "../../shared/protocol";
import type { StackRole } from "../../shared/stack_taxonomy";
import { subsystemVisual, evidenceLabel } from "./subsystem_visual";

// M-STACK.3 — which stack ROLE answers "what is this card built on".
// The M19 system tier is deliberately language-shallow (the frontend is
// one node found by a TEXT scan, never parsed), so the index knows more
// than the tier does about every card here — but it never overwrites
// the tier: where the two disagree, SubLine shows BOTH.
const ROLE_FOR_KIND: Partial<Record<Subsystem["kind"], StackRole[]>> = {
  frontend: ["frontend"],
  backend: ["web-framework"],
  db: ["db"],
  cache: ["cache"],
  external_http: ["http-client"],
  library: ["tensor", "data"],
};

function toolsFor(s: Subsystem, stack?: StackIndexRecord | null): { tool: string; wraps?: string[]; configOnly: boolean }[] {
  const roles = ROLE_FOR_KIND[s.kind];
  if (!roles || !stack) return [];
  return stack.tools
    .filter((t) => roles.includes(t.role as StackRole))
    .map((t) => ({ tool: t.tool, wraps: t.wraps, configOnly: t.evidence.every((e) => e.kind === "config") }));
}

function endpointLabel(id: string): string {
  // entryPoints[].id is '<file>:<funcName>' — show the function name.
  const rest = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return rest;
}

/** The card's width; buildSystemLayout spaces its columns by it. */
export const SUBSYSTEM_CARD_W = 260;
/** Tool chips shown before "+N more". */
const MAX_TOOLS = 5;

export function SubsystemNode({
  data,
}: {
  data: { subsystem: Subsystem; onOpenThread?: (entryPointId: string) => void; stack?: StackIndexRecord | null };
}) {
  const s = data.subsystem;
  const tools = toolsFor(s, data.stack);
  const { accent, icon: Icon, quiet } = subsystemVisual(s.kind);
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(false);
  const a = `var(${accent})`;
  const endpoints = s.endpointRefs ?? [];
  // Expand-to-reveal is data-driven: any card that owns entry points
  // (backend routes; a routeless project's library entries, M-NN-2).
  const expandable = endpoints.length > 0;

  return (
    <div
      className="vg-subsystem-node"
      data-subsystem-node
      data-subsystem-kind={s.kind}
      data-subsystem-id={s.id}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        // A FIXED width: the layout spaces columns by it, so a card can never
        // reach into the next column (overlap audit, reviews/overlaps).
        width: SUBSYSTEM_CARD_W, boxSizing: "border-box",
        background: "var(--bg-node)",
        border: `1px solid color-mix(in oklab, ${a} ${hover ? 70 : 45}%, transparent)`,
        borderRadius: 14,
        padding: "12px 16px",
        opacity: quiet ? 0.82 : 1,
        transform: hover ? "translateY(-2px) scale(1.02)" : "none",
        transition: "transform var(--motion-hover-dur) var(--motion-hover-ease), border-color var(--motion-hover-dur) var(--motion-hover-ease)",
        boxShadow: hover ? "var(--shadow-control)" : "none",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />

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
            {s.label}
          </div>
          <SubLine subsystem={s} tools={tools} />
        </div>
        {expandable && (
          <button
            data-subsystem-expand
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            title={expanded ? "Hide endpoints" : `Show ${endpoints.length} endpoints`}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: 2,
              color: "var(--text-muted)", display: "flex", alignItems: "center",
            }}
          >
            {expanded ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
          </button>
        )}
      </div>

      {/* M-STACK.3 — the tools behind this card, from the index (IR fact).
          A config-only chip is marked: nothing was parsed for it. Their own
          block under the header, each chip truncated to the card: in the
          header row, a private production codebase's 40 long funnel names pushed the row past
          the card and spilled across the next column. The first MAX_TOOLS
          show; the rest are counted, and named in the tooltip. */}
      {tools.length > 0 && (
        <div data-subsystem-tools={s.id} style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8, minWidth: 0 }}>
          {tools.slice(0, MAX_TOOLS).map((t) => (
            <span key={t.tool} data-subsystem-tool={t.tool}
              title={t.configOnly
                ? `${t.tool} — from a manifest/config file; no code was parsed for it`
                : `${t.tool}${t.wraps?.length ? ` — the project funnel wrapping ${t.wraps.join(", ")}` : ""}`}
              style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)",
                color: t.configOnly ? "var(--accent-warning)" : "var(--text-muted)",
                border: `1px solid color-mix(in oklab, ${t.configOnly ? "var(--accent-warning)" : "var(--text-muted)"} 45%, transparent)`,
                borderRadius: 4, padding: "0 5px",
                maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{t.tool}{t.configOnly ? " ?" : ""}</span>
          ))}
          {tools.length > MAX_TOOLS && (
            <span data-subsystem-tools-more title={tools.slice(MAX_TOOLS).map((t) => t.tool).join("\n")}
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--text-muted)", padding: "0 5px" }}>
              {`+${tools.length - MAX_TOOLS} more`}
            </span>
          )}
        </div>
      )}

      {expandable && expanded && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          {endpoints.map((ep) => (
            <div
              key={ep}
              className="vg-subsystem-endpoint"
              data-subsystem-endpoint
              data-entry-id={ep}
              title={`Open the ${endpointLabel(ep)} thread`}
              onClick={(e) => { e.stopPropagation(); data.onOpenThread?.(ep); }}
              style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--fsm-12)",
                color: "var(--text-secondary)", cursor: "pointer",
                padding: "3px 8px", borderRadius: 6,
                background: "color-mix(in oklab, var(--accent-thread) 8%, transparent)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              {endpointLabel(ep)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Secondary line: framework / detection / file count, in --text-muted.
// M-STACK.3 — when the stack index names a tool for this card's role and
// the tier's own framework string differs, BOTH are shown with their
// provenance. A card must never silently swap one for the other.
function SubLine({ subsystem: s, tools }: { subsystem: Subsystem; tools?: { tool: string }[] }) {
  let text: string | null = null;
  if (s.kind === "backend") {
    const parts: string[] = [];
    if (s.framework) parts.push(s.framework);
    if (s.endpointRefs?.length) parts.push(`${s.endpointRefs.length} routes`);
    if (s.fileCount != null) parts.push(`${s.fileCount} files`);
    text = parts.join(" · ") || null;
  } else if (s.kind === "library" && s.endpointRefs?.length) {
    // A routeless project's own entries are not routes — say what they are.
    const parts = [`${s.endpointRefs.length} entry points`];
    if (s.fileCount != null) parts.push(`${s.fileCount} files`);
    text = parts.join(" · ");
  } else if (s.kind === "frontend") {
    text = s.path ? `web · ${s.path}` : "web";
  } else if (s.evidence) {
    text = evidenceLabel(s.evidence);
  }
  const named = (tools ?? []).map((t) => t.tool);
  if (named.length && s.framework && !named.some((n) => n.toLowerCase() === s.framework!.toLowerCase())) {
    text = `${text ?? s.framework} (tier scan) · ${named.join(", ")} (imports/manifest)`;
  }
  if (!text) return null;
  return (
    <div
      data-subsystem-subline
      style={{
        fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)",
        color: "var(--text-muted)", whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis",
      }}
    >
      {text}
    </div>
  );
}
