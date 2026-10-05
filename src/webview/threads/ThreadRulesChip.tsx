// Rules on this thread (2026-10-05, GUI brief M5): the stated rules routed to
// the open thread, each with its live verdict, as a chip in the thread's
// chip strip beside the tests and env chips. Opening one opens the Rules
// panel on it. Amber when any is violated or unverifiable.

import React, { useState } from "react";
import { Scale, X } from "lucide-react";
import type { RuleRowView } from "../useRulesState";
import { Chip, Verdict } from "../panels/Chip";

export function ThreadRulesChip({ rules, onOpenRule }: { rules: RuleRowView[]; onOpenRule: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!rules.length) return null;
  const bad = rules.filter((r) => r.verdict === "violated" || r.verdict === "unverifiable").length;
  const accent = bad ? "var(--accent-warning)" : "var(--text-muted)";
  return (
    <div data-thread-rules style={{ display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      <button data-thread-rules-chip data-rule-count={rules.length} onClick={() => setOpen(!open)}
        title="The stated rules routed to this thread, with their live verdicts"
        style={{
          pointerEvents: "auto", display: "flex", alignItems: "center", gap: 8, alignSelf: "flex-start",
          background: "color-mix(in oklab, var(--bg-node) 90%, transparent)",
          border: `1px solid color-mix(in oklab, ${accent} 40%, transparent)`, borderRadius: 16, padding: "4px 12px",
          color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", cursor: "pointer",
        }}>
        <Scale size={16} strokeWidth={1.5} style={{ color: accent }} />
        {`rules · ${rules.length}${bad ? ` (${bad} not passing)` : ""}`}
      </button>
      {open && (
        <div data-thread-rules-card style={{
          pointerEvents: "auto", background: "color-mix(in oklab, var(--bg-node) 96%, transparent)",
          border: "1px solid var(--border-edge)", borderRadius: 8, padding: 12, maxWidth: 460, maxHeight: 280, overflowY: "auto",
          boxShadow: "var(--shadow-panel)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", color: "var(--text-secondary)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ flex: 1, color: "var(--text-primary)", fontWeight: 600 }}>Rules on this thread</div>
            <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
          {rules.map((r) => (
            <div key={r.constraint.id} data-thread-rule={r.constraint.id} style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
              <span onClickCapture={(e) => { e.stopPropagation(); onOpenRule(r.constraint.id); }}><Chip kind="rule" id={r.constraint.id} /></span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.constraint.text}>{r.constraint.text}</span>
              <Verdict v={r.verdict ?? "prose"} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
