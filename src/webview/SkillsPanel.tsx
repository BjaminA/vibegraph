// M-SKILLS.2 — the Skills panel: which generic direction skills this
// project enables.
//
// A generic skill is the prose half of a quality dimension: the why beside
// the check that catches a violation. Enabling one is the human act that
// lets it ride worker, thread-agent and chat prompts — after the thread
// skill, under the same budget, always with a provenance line and never as
// a gate. Off by default. Each row says how many of THIS project's threads
// the skill's applies_when fires on (measured on the live stack profile),
// which checks it binds, and whether a paired drill has validated it yet.
// The server owns the file (.vibegraph/skills.json); this panel posts the
// enabled list and renders the echoed, sanitised result.
import React from "react";
import type { SkillsConfigPayload } from "../shared/generic_skills_wire";
import { SheetPortal, SheetBody, type SheetSlot } from "./panels/PanelSheet";

interface Props {
  state: SkillsConfigPayload | null;
  onChange: (enabled: string[], hooks?: "headlines" | "on-violation" | "off") => void;
  slot: SheetSlot | null;
}

const mono = "var(--font-mono, 'JetBrains Mono', monospace)";

export function SkillsPanel({ state, onChange, slot }: Props) {
  const enabled = new Set(state?.config.enabled ?? []);
  const toggle = (name: string) => {
    const next = new Set(enabled);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange([...next]);
  };
  if (!slot) return null;

  return (
    <SheetPortal slot={slot} subtitle={state ? `${enabled.size} of ${state.catalogue.length} enabled · advice only` : undefined}>
    <SheetBody>
    <div data-skills-panel style={{ maxWidth: 720, color: "var(--text-primary)" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
        Each skill is the prose half of a quality dimension — the why beside the check that catches a violation.
        An enabled skill reaches the chat, work-run workers and thread agents (in full, labelled) and Claude Code
        hooks (as set below). Advice only — it never blocks anything. Off by default.
      </div>
      {state && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-secondary)", marginBottom: 12 }}>
          In Claude Code hooks
          <select
            data-skills-hooks
            value={state.config.hooks ?? "headlines"}
            onChange={(e) => onChange([...enabled], e.target.value as "headlines" | "on-violation" | "off")}
            style={{ background: "var(--bg-canvas)", color: "var(--text-primary)", border: "1px solid var(--border-edge)", borderRadius: 4, padding: "4px 8px", fontSize: 11 }}
          >
            <option value="headlines">rule headlines, once per session</option>
            <option value="on-violation">only a rule's why, when its check fires</option>
            <option value="off">nothing</option>
          </select>
        </label>
      )}

      {!state && (
        <div data-skills-loading style={{ fontSize: 11, color: "var(--text-muted)" }}>Waiting for the server…</div>
      )}
      {state && state.catalogue.length === 0 && (
        <div data-skills-empty style={{ fontSize: 11, color: "var(--text-muted)" }}>No skills shipped with this VibeGraph.</div>
      )}
      {state?.catalogue.map((s) => {
        const on = enabled.has(s.name);
        const by = state.config.enabledBy?.[s.name];
        return (
          <div
            key={s.name}
            data-skill-row={s.name}
            data-skill-enabled={on ? "true" : "false"}
            style={{ padding: "8px 0", borderTop: "1px solid var(--border-edge)" }}
          >
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
              <input
                data-skill-toggle={s.name}
                type="checkbox"
                checked={on}
                onChange={() => toggle(s.name)}
                style={{ marginTop: 2 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontFamily: mono, fontWeight: 600 }}>{s.name}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>v{s.skillVersion}</span>
                  <span
                    data-skill-evidence={s.evidence}
                    title={s.evidence === "validated" ? "A paired with/without drill is recorded" : "No drill recorded yet: direction, advisory"}
                    style={{ fontSize: 11, color: s.evidence === "validated" ? "var(--accent-thread)" : "var(--accent-warning)" }}
                  >
                    {s.evidence}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-primary)", lineHeight: 1.5, marginTop: 2 }}>{s.description}</div>
                <div data-skill-breadth style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, fontFamily: mono }}>
                  {s.of > 0 ? `applies to ${s.fires} of ${s.of} threads here` : "breadth unmeasured (no project profile)"}
                  {" · "}binds {s.binds.filter((b) => b !== "judgement").map((b) => b.replace(/^(check|precheck|envelope):/, "")).join(", ") || "judgement only"}
                </div>
                {on && by && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    enabled by {by.source}{by.id ? ` (${by.id})` : ""} on {by.at.slice(0, 10)}
                  </div>
                )}
              </div>
            </label>
          </div>
        );
      })}
    </div>
    </SheetBody>
    </SheetPortal>
  );
}
