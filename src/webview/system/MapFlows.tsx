// The plan's FLOWS on the map (2026-10-06, system views): each a named path
// between processes through the store (arch_real.ts). A list under the legend;
// choosing one lights its boxes and the edges between them and dims the rest.
// Nothing new is drawn — a step the code does not take has no edge to light,
// and the list says how many steps were found.

import React, { useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import { Route, ChevronDown, ChevronRight } from "lucide-react";
import type { RealFlow } from "./arch_real";
import { verdictTone } from "../planTone";

export function MapFlows({ flows, active, onActive }: { flows: RealFlow[]; active: string | null; onActive: (id: string | null) => void }) {
  // Folded by default, like the legend: it sits over the canvas.
  const [open, setOpen] = useState(false);
  if (!flows.length) return null;
  return (
    <div data-arch-flows style={{
      pointerEvents: "auto", display: "flex", flexDirection: "column", gap: 4, maxWidth: 280,
      background: "color-mix(in oklab, var(--bg-node) 92%, transparent)", border: "1px solid var(--border-edge)",
      borderRadius: 8, padding: "8px 12px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-secondary)",
    }}>
      <button data-arch-flows-toggle aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{
        display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", background: "transparent", border: "none",
        padding: 0, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)",
      }}>
        <Route size={16} strokeWidth={1.5} /> Flows · {flows.length}{active ? ` · ${active}` : ""}
        {open ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
      </button>
      {open && flows.map((f) => {
        const found = f.steps.filter((s) => s.found).length;
        const on = active === f.id;
        return (
          <button key={f.id} data-arch-flow={f.id} data-active={on ? "true" : "false"} onClick={() => onActive(on ? null : f.id)}
            title={`${f.label}\n${f.steps.map((s) => `${s.found ? "✓" : "✗"} ${s.text}`).join("\n")}`}
            style={{
              display: "flex", justifyContent: "space-between", gap: 8, textAlign: "left", cursor: "pointer",
              background: on ? "color-mix(in oklab, var(--accent-thread) 16%, transparent)" : "transparent",
              border: `1px solid ${on ? "var(--accent-thread)" : "transparent"}`, borderRadius: 4, padding: "0 4px",
              color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)",
            }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.id}</span>
            <span style={{ color: verdictTone(f.verdict), flexShrink: 0 }}>{found}/{f.steps.length} · {f.verdict}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Light a flow's boxes (a folded zone lights the card it folded into) and
 *  the edges between two lit boxes; dim the rest. */
export function lightFlow(nodes: Node[], edges: Edge[], flow: RealFlow | undefined, foldedInto: (id: string) => string | undefined): { nodes: Node[]; edges: Edge[] } {
  if (!flow) return { nodes, edges };
  const present = new Set(nodes.map((n) => n.id));
  const lit = new Set(flow.nodes.map((id) => (present.has(id) ? id : foldedInto(id))).filter((x): x is string => !!x && present.has(x)));
  return {
    nodes: nodes.map((n) => (n.type === "archNode" ? { ...n, data: { ...n.data, lit: lit.has(n.id), dim: !lit.has(n.id) } } : n)),
    edges: edges.map((e) => (lit.has(e.source) && lit.has(e.target)
      ? { ...e, style: { ...e.style, opacity: 1, strokeWidth: 2.5 } }
      : { ...e, style: { ...e.style, opacity: 0.15 } })),
  };
}
