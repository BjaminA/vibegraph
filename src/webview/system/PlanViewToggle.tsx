// Real · Plan · Overlay on the architecture map (2026-09-30), shown only while
// a plan exists. Real is the map as derived from the code; Plan draws the
// hypothetical project alone; Overlay draws the real map with the plan on it
// (realised items marked on their real box, the rest as dashed ghosts).
//
// 2026-10-01 — under the switch: what the plan says that has no place on the
// map (project-wide rules and questions, a boundary whose end is not drawn),
// said rather than dropped; and "Seed groups", which proposes
// .vibegraph/architecture.json groups read off the plan (zero tokens, PENDING
// until a person ratifies it with the proposal bar's Ratify).

import React from "react";
import { DraftingCompass, Layers } from "lucide-react";
import type { PlanView, PlanUnplaced } from "./arch_plan";

const VIEWS: { id: PlanView; label: string; title: string }[] = [
  { id: "real", label: "Real", title: "The map as derived from the code" },
  { id: "plan", label: "Plan", title: "The hypothetical plan alone — dashed, not the code" },
  { id: "overlay", label: "Overlay", title: "The real map with the plan on it: realised items marked \"planned ✓\" on their real box, the rest dashed" },
];

export function PlanViewToggle({ view, onView, revision, unplaced, onSeed }: {
  view: PlanView; onView: (v: PlanView) => void; revision: number;
  unplaced?: PlanUnplaced | null; onSeed?: () => void;
}) {
  const loose = unplaced && view !== "real"
    ? [
      ...(unplaced.rules.length ? [`${unplaced.rules.length} rule${unplaced.rules.length === 1 ? "" : "s"}`] : []),
      ...(unplaced.questions.length ? [`${unplaced.questions.length} open`] : []),
      ...(unplaced.boundaries.length ? [`${unplaced.boundaries.length} boundary${unplaced.boundaries.length === 1 ? "" : "ies"} not drawn`] : []),
    ]
    : [];
  const looseTitle = unplaced
    ? [...unplaced.rules, ...unplaced.questions.map((q) => `open — ${q}`), ...unplaced.boundaries.map((b) => `not drawn — ${b}`)].join("\n")
    : "";
  return (
    // Placed by SystemView's top-right column (above the legend).
    <div data-plan-view-toggle style={{
      display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, pointerEvents: "auto",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 4, padding: 4,
        background: "color-mix(in oklab, var(--bg-node) 90%, transparent)", border: "1px dashed var(--proposed-border)",
        borderRadius: 8, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
      }}>
        <span title={`A plan exists (revision ${revision}) — hypothetical, not the code`} style={{ display: "flex", alignItems: "center", padding: "0 4px", color: "var(--text-muted)" }}>
          <DraftingCompass size={14} strokeWidth={1.5} />
        </span>
        {VIEWS.map((v) => (
          <button key={v.id} data-plan-view={v.id} data-active={view === v.id ? "true" : "false"} title={v.title} onClick={() => onView(v.id)}
            style={{
              background: view === v.id ? "color-mix(in oklab, var(--accent-thread) 18%, var(--bg-node))" : "none",
              border: `1px solid ${view === v.id ? "var(--accent-thread)" : "transparent"}`, borderRadius: 6,
              color: view === v.id ? "var(--text-primary)" : "var(--text-secondary)",
              fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", padding: "4px 8px", cursor: "pointer",
            }}>
            {v.label}
          </button>
        ))}
        {onSeed && view !== "real" && (
          <button data-plan-seed-arch onClick={onSeed}
            title="Propose deployment / trust groups for .vibegraph/architecture.json, read off the plan — no model, no tokens. Pending until you ratify it."
            style={{
              display: "flex", alignItems: "center", gap: 4, background: "none", border: "1px dashed var(--proposed-border)", borderRadius: 6,
              color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", padding: "4px 8px", cursor: "pointer",
            }}>
            <Layers size={14} strokeWidth={1.5} /> Seed groups
          </button>
        )}
      </div>
      {loose.length > 0 && (
        <div data-plan-unplaced title={looseTitle} style={{
          fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)", padding: "2px 8px",
          background: "color-mix(in oklab, var(--bg-node) 90%, transparent)", borderRadius: 6,
        }}>
          {`whole project: ${loose.join(" · ")}`}
        </div>
      )}
    </div>
  );
}
