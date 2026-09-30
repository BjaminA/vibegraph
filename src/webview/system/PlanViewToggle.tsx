// Real · Plan · Overlay on the architecture map (2026-09-30), shown only while
// a plan exists. Real is the map as derived from the code; Plan draws the
// hypothetical project alone; Overlay draws the real map plus the planned
// items the code does not have yet. Planned boxes are dashed ghosts.

import React from "react";
import { DraftingCompass } from "lucide-react";
import type { PlanView } from "./arch_plan";

const VIEWS: { id: PlanView; label: string; title: string }[] = [
  { id: "real", label: "Real", title: "The map as derived from the code" },
  { id: "plan", label: "Plan", title: "The hypothetical plan alone — dashed, not the code" },
  { id: "overlay", label: "Overlay", title: "The real map, plus the planned items the code does not have yet (dashed)" },
];

export function PlanViewToggle({ view, onView, revision }: { view: PlanView; onView: (v: PlanView) => void; revision: number }) {
  return (
    <div data-plan-view-toggle style={{
      position: "absolute", top: "max(128px, calc(var(--vg-toolbar-bottom, 43px) + 52px))", right: 16, zIndex: 30,
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
    </div>
  );
}
