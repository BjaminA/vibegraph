// M-ARCH.2 — one box on the architecture map: a CLUSTER of entry points or a
// TOOL a cluster calls. Tokens only, lucide only; the hover lift is the
// depth cue (SubsystemNode's precedent). A stated role and a non-derived
// source are chips on the card, so provenance is read where the box is.

import React, { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { Split, Monitor } from "lucide-react";
import type { ArchNodeRecord } from "../../shared/protocol";
import { archVisual } from "./arch_visual";

export function ArchNode({ data, selected }: { data: { node: ArchNodeRecord; dim?: boolean; lit?: boolean }; selected?: boolean }) {
  const n = data.node;
  const visual = archVisual(n.category);
  // A dispatcher is the scripts family's accent with its own glyph: the one
  // script the others are run THROUGH.
  const { accent, quiet } = visual;
  const Icon = n.kind === "hub" ? Split : n.kind === "actor" ? Monitor : visual.icon;
  const [hover, setHover] = useState(false);
  const a = `var(${accent})`;
  const chips: { text: string; title: string; tone: string }[] = [];
  if (n.roleStatedBy) chips.push({ text: `role · ${n.roleStatedBy}`, title: `the role was stated by constraint ${n.roleStatedBy}, not a table`, tone: "var(--accent-config)" });
  if (n.labelSource) chips.push({ text: `named · ${n.labelSource}`, title: `display name ${n.labelSource}; the code calls it ${n.derivedLabel}`, tone: n.labelSource === "stated" ? "var(--accent-config)" : "var(--proposed-border)" });
  if (n.source !== "derived") chips.push({ text: n.source, title: `${n.source} — not derived from the code`, tone: "var(--proposed-border)" });
  if (n.dispatches?.length) {
    const total = n.dispatches.reduce((k, g) => k + g.scripts.length, 0);
    chips.push({ text: `${total} scripts`, title: `dispatches ${total} scripts in ${n.dispatches.length} directories — click the card for the list`, tone: "var(--accent-thread)" });
  }
  if (n.members?.length) chips.push({ text: `${n.members.length} tools`, title: `one box for ${n.members.length} tools of this kind; the Tools lens draws each`, tone: "var(--text-muted)" });
  if (n.wrappedBy?.length) chips.push({ text: `via ${n.wrappedBy[0]}${n.wrappedBy.length > 1 ? ` +${n.wrappedBy.length - 1}` : ""}`, title: `wrapped by the project funnel(s) ${n.wrappedBy.join(", ")}`, tone: "var(--text-muted)" });
  const internal = n.internalHops ? Object.entries(n.internalHops).map(([k, v]) => `${v} ${k}`).join(", ") : "";

  return (
    <div
      data-arch-node
      data-arch-id={n.id}
      data-arch-kind={n.kind}
      data-arch-category={n.category}
      data-arch-source={n.source}
      data-arch-dim={data.dim ? "true" : undefined}
      aria-label={`${n.label}, ${n.sublabel}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 240,
        background: "var(--bg-node)",
        border: `1px solid color-mix(in oklab, ${a} ${hover || selected ? 75 : 45}%, transparent)`,
        borderStyle: n.source === "proposed" ? "dashed" : "solid",
        borderRadius: n.kind === "tool" ? 8 : 14,
        padding: "12px 16px",
        opacity: data.dim ? 0.25 : quiet ? 0.85 : 1,
        outline: data.lit ? "2px solid var(--accent-thread)" : undefined,
        transform: hover ? "translateY(-2px)" : "none",
        transition: "transform var(--motion-hover-dur) var(--motion-hover-ease), border-color var(--motion-hover-dur) var(--motion-hover-ease)",
        boxShadow: hover || selected ? "var(--shadow-control)" : "none",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: `color-mix(in oklab, ${a} 14%, transparent)`, color: a,
        }}>
          <Icon size={16} strokeWidth={1.5} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div data-arch-label style={{
            fontFamily: n.kind === "tool" ? "var(--font-mono)" : "var(--font-ui)",
            fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text-primary)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }} title={n.label}>{n.label}</div>
          <div data-arch-sublabel style={{
            fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }} title={n.sublabel}>{n.sublabel}</div>
        </div>
      </div>
      {(chips.length > 0 || internal) && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
          {chips.map((c) => (
            <span key={c.text} data-arch-chip={c.text} title={c.title} style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: c.tone,
              border: `1px solid color-mix(in oklab, ${c.tone} 45%, transparent)`, borderRadius: 4, padding: "0 4px",
              // One line, cut to the card: a long funnel path wrapped inside
              // its chip and grew the card past the height the router
              // routes around (the full text is the title).
              maxWidth: "100%", boxSizing: "border-box", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{c.text}</span>
          ))}
          {internal && (
            <span data-arch-internal title="hops whose both ends sit inside this cluster — counted, not drawn" style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--text-muted)",
              maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{`internal: ${internal}`}</span>
          )}
        </div>
      )}
    </div>
  );
}
