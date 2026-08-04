// Subsystem card — a custom react-flow node for the system view (M19.2).
// Bound entirely to tokens.css; lucide icons only; hover-lift (not
// shadow) is the depth cue (box-shadow keyframe, never `filter` — the
// hit-test caveat). Backend expands to reveal its route endpoints
// (progressive disclosure, your Q1 default).

import React, { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { Subsystem } from "../types";
import { subsystemVisual, evidenceLabel } from "./subsystem_visual";

function endpointLabel(id: string): string {
  // entryPoints[].id is '<file>:<funcName>' — show the function name.
  const rest = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return rest;
}

export function SubsystemNode({
  data,
}: {
  data: { subsystem: Subsystem; onOpenThread?: (entryPointId: string) => void };
}) {
  const s = data.subsystem;
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
        minWidth: 200,
        maxWidth: 260,
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
          <SubLine subsystem={s} />
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
function SubLine({ subsystem: s }: { subsystem: Subsystem }) {
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
  if (!text) return null;
  return (
    <div
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
