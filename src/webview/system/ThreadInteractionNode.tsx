// Thread node for the system view's thread-interaction mode. A compact
// token-bound card — one per thread (entry point), coloured + iconed by
// entry-point kind. Click opens the thread (handled in SystemView via the
// injected onOpenThread). Hover-lift via transform/box-shadow, never `filter`
// (the stacking-context hit-test caveat).

import React, { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { Globe, Terminal, FlaskConical, Code2, Pin, Network } from "lucide-react";
import type { EntryPoint } from "../types";

type Kind = EntryPoint["kind"];

// Icon + label/accent per entry-point kind, matching the thread launchpad
// (ThreadIndex) + the side-panel ThreadTree. CONSOLIDATION CANDIDATE: this is
// now the 3rd local copy of these tables (ThreadIndex, ThreadTree, here) — the
// "extract on 3rd use" bar is hit; a shared kind-table module would remove the
// drift risk (the `model` kind had to be added in three places).
const KIND_ICON: Record<Kind, React.ComponentType<any>> = {
  route: Globe,
  model: Network,
  cli: Terminal,
  test: FlaskConical,
  public_api: Code2,
  manual: Pin,
};
const KIND_LABEL: Record<Kind, string> = {
  route: "Route",
  model: "Model",
  cli: "CLI",
  test: "Test",
  public_api: "Public API",
  manual: "Manual",
};
export interface ThreadInteractionData {
  entryPointId: string;
  label: string;
  kind: Kind;
  file: string;
  onOpenThread?: (entryPointId: string) => void;
}

// W4 — deterministic per-thread colour from the IR thread id (entryPointId)
// → one of the 8 --thread-file-hue-N palette tokens. Same thread → same hue
// across reloads (pure function of the id). Distinguishes threads on the
// multi-thread system canvas; the KIND_ICON still conveys route/model/cli.
export function colourForThreadId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return `var(--thread-file-hue-${h % 8})`;
}

export function ThreadInteractionNode({ data }: { data: ThreadInteractionData }) {
  const [hover, setHover] = useState(false);
  const Icon = KIND_ICON[data.kind] ?? Pin;
  const a = colourForThreadId(data.entryPointId);

  return (
    <div
      className="vg-thread-interaction-node"
      data-thread-interaction-node
      data-entry-kind={data.kind}
      data-entry-point-id={data.entryPointId}
      data-accent={a}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        minWidth: 180,
        maxWidth: 240,
        background: "var(--bg-node)",
        border: `1px solid color-mix(in oklab, ${a} ${hover ? 70 : 45}%, transparent)`,
        borderRadius: 12,
        padding: "10px 14px",
        transform: hover ? "translateY(-2px) scale(1.02)" : "none",
        transition:
          "transform var(--motion-hover-dur) var(--motion-hover-ease), border-color var(--motion-hover-dur) var(--motion-hover-ease)",
        boxShadow: hover ? "var(--shadow-control)" : "none",
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 26, height: 26, borderRadius: 8, flexShrink: 0,
            background: `color-mix(in oklab, ${a} 14%, transparent)`,
            color: a,
          }}
        >
          <Icon size={15} strokeWidth={1.5} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--font-ui)", fontSize: "var(--fs-13)", fontWeight: 600,
              color: "var(--text-primary)", whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {data.label}
          </div>
          <div
            style={{
              fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)",
              color: "var(--text-muted)", marginTop: 1,
            }}
          >
            {KIND_LABEL[data.kind] ?? data.kind}
          </div>
        </div>
      </div>
    </div>
  );
}
