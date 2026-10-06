// M-ARCH.2 — one box on the architecture map: a CLUSTER of entry points or a
// TOOL a cluster calls. Tokens only, lucide only; the hover lift is the
// depth cue (SubsystemNode's precedent). A stated role and a non-derived
// source are chips on the card, so provenance is read where the box is.

import React, { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { Split, Monitor } from "lucide-react";
import type { ArchNodeRecord, PlanFlowRecord } from "../../shared/protocol";
import { archVisual } from "./arch_visual";
import { planChipTexts, badgeTexts } from "./archLayout";
import { opIcon } from "./opIcons";
import { verdictTone } from "../planTone";

export function ArchNode({ data, selected }: { data: { node: ArchNodeRecord; dim?: boolean; lit?: boolean; onTogglePlanFlows?: (id: string) => void }; selected?: boolean }) {
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
  if (n.labelSource) chips.push({ text: `named · ${n.labelSource}`, title: `display name ${n.labelSource}; the code calls it ${n.derivedLabel}`, tone: n.labelSource === "proposed" ? "var(--proposed-border)" : "var(--accent-config)" });
  if (n.source !== "derived") chips.push({ text: n.source, title: `${n.source} — not derived from the code`, tone: "var(--proposed-border)" });
  if (n.dispatches?.length) {
    const total = n.dispatches.reduce((k, g) => k + g.scripts.length, 0);
    chips.push({ text: `${total} scripts`, title: `dispatches ${total} scripts in ${n.dispatches.length} directories — click the card for the list`, tone: "var(--accent-thread)" });
  }
  if (n.members?.length && n.category !== "config") chips.push({ text: `${n.members.length} tools`, title: `one box for ${n.members.length} tools of this kind; the Tools lens draws each`, tone: "var(--text-muted)" });
  if (n.wrappedBy?.length) chips.push({ text: `via ${n.wrappedBy[0]}${n.wrappedBy.length > 1 ? ` +${n.wrappedBy.length - 1}` : ""}`, title: `wrapped by the project funnel(s) ${n.wrappedBy.join(", ")}`, tone: "var(--text-muted)" });
  const internal = n.internalHops ? Object.entries(n.internalHops).map(([k, v]) => `${v} ${k}`).join(", ") : "";
  // The plan's chips — texts from archLayout's planChipTexts, so the card's
  // measured height and the drawn chips never disagree.
  const planTexts = planChipTexts(n);
  const planChips: { kind: string; text: string; title: string; tone: string; onClick?: () => void }[] = [];
  let k = 0;
  if (n.plannedAs) planChips.push({ kind: "planned", text: planTexts[k++], tone: verdictTone(n.plannedAs.verdict), title: `the plan's ${n.plannedAs.label} (${n.plannedAs.id}) — ${n.plannedAs.verdict}: this box is where the code realises it` });
  if (n.planFlows?.length) planChips.push({ kind: "threads", text: planTexts[k++], tone: "var(--accent-thread)", title: `${n.planFlowsOpen ? "hide" : "show"} the planned threads: ${n.planFlows.map((f) => `${f.id} (${f.verdict})`).join(", ")}`, onClick: data.onTogglePlanFlows ? () => data.onTogglePlanFlows!(n.id) : undefined });
  if (n.planRules?.length) planChips.push({ kind: "rules", text: planTexts[k++], tone: "var(--accent-config)", title: n.planRules.join("\n") });
  if (n.planQuestions?.length) planChips.push({ kind: "open", text: planTexts[k++], tone: "var(--accent-warning)", title: n.planQuestions.join("\n") });

  const badges = badgeTexts(n);
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
        borderStyle: n.source === "proposed" || n.source === "planned" ? "dashed" : "solid",
        borderRadius: n.kind === "tool" ? 8 : 14,
        padding: "12px 16px",
        // A planned box is a ghost: it is not in the code.
        opacity: data.dim ? 0.25 : n.source === "planned" ? 0.72 : quiet ? 0.85 : 1,
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
      {(chips.length > 0 || internal || planChips.length > 0 || badges.length > 0 || (n.ioWords?.length ?? 0) > 0) && (
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
          {planChips.map((c) => (
            <span
              key={c.text} data-arch-plan-chip={c.kind} title={c.title}
              role={c.onClick ? "button" : undefined} tabIndex={c.onClick ? 0 : undefined}
              aria-expanded={c.kind === "threads" ? !!n.planFlowsOpen : undefined}
              onClick={c.onClick ? (e) => { e.stopPropagation(); c.onClick!(); } : undefined}
              onKeyDown={c.onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); c.onClick!(); } } : undefined}
              style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: c.tone,
                border: `1px ${c.kind === "planned" ? "solid" : "dashed"} color-mix(in oklab, ${c.tone} 45%, transparent)`, borderRadius: 4, padding: "0 4px",
                cursor: c.onClick ? "pointer" : "default", whiteSpace: "nowrap",
              }}
            >{c.text}</span>
          ))}
          {(n.ioWords ?? []).map((w) => {
            const I = opIcon(w.icon);
            return (
              <span key={`w:${w.id}`} data-arch-io-word={w.id} className="vg-op" style={{ ["--a" as string]: `var(${w.accent})` } as React.CSSProperties}>
                <I size={16} strokeWidth={1.5} aria-hidden />{w.label}
              </span>
            );
          })}
          {badges.map((b) => (
            <span key={b.id} data-arch-badge={b.id} title={b.title} style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--accent-config)",
              background: "color-mix(in oklab, var(--accent-config) 12%, transparent)", borderRadius: 8, padding: "0 4px", whiteSpace: "nowrap",
            }}>{b.text}</span>
          ))}
        </div>
      )}
      {n.planFlowsOpen && n.planFlows?.length ? <PlanFlows flows={n.planFlows} /> : null}
    </div>
  );
}

/** A box's planned threads, open: each a title line (id + verdict) and its
 *  primary steps as a dashed chain; a step plan-check did not find is struck
 *  through. Heights match archLayout's planFlowsHeight (8 + 38 a thread). */
function PlanFlows({ flows }: { flows: PlanFlowRecord[] }) {
  return (
    <div data-arch-plan-flows style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
      {flows.map((f) => {
        const tone = verdictTone(f.verdict);
        return (
          <div key={f.id} data-arch-plan-flow={f.id} data-verdict={f.verdict} title={`${f.id} — ${f.verdict}${f.steps.some((s) => s.missing) ? `; not found: ${f.steps.filter((s) => s.missing).map((s) => s.text).join(", ")}` : ""}`}
            style={{ height: 34, borderLeft: `2px dashed ${tone}`, paddingLeft: 8, boxSizing: "border-box" }}>
            <div style={{ display: "flex", gap: 8, fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", lineHeight: "17px", whiteSpace: "nowrap", overflow: "hidden" }}>
              <span style={{ color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis" }}>{f.id}</span>
              <span style={{ color: tone, flexShrink: 0 }}>{f.verdict}</span>
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", lineHeight: "17px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-muted)" }}>
              {f.steps.map((s, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span style={{ color: tone }}>{" ⇢ "}</span>}
                  <span data-missing={s.missing ? "true" : undefined} style={{ textDecoration: s.missing ? "line-through" : undefined, color: s.missing ? "var(--accent-warning)" : undefined }}>{s.text}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
