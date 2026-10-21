// M-SKILLS.2 — the Direction panel: the project's own direction, then the
// generic direction skills shipped with VibeGraph.
//
// A generic skill is the prose half of a quality dimension: the why beside
// the check that catches a violation. Off by default. 2026-10-20 (Ben): one
// page-wide hooks mode in a drop-down was confusing — every row now carries
// the same two switches (direction/DeliverySwitches.tsx): "Tell Claude up
// front" (its rules once per session in Claude Code; the chat, workers and
// thread agents get it in full) and "Explain when an edit breaks it" (the
// rule and its reason beside the finding). Both off = not used. A switch
// flips at once; the server owns `.vibegraph/skills.json` and its echo is the
// truth once every press is answered. Each row says how many of THIS
// project's threads the skill applies to, which checks it binds, its rules,
// and whether a paired drill has validated it yet. Advice only, never a gate.
import React, { useEffect } from "react";
import type { Delivery, SkillsConfigPayload } from "../shared/generic_skills_wire";
import { skillDelivery } from "../shared/generic_skills_wire";
import { SheetPortal, SheetBody, type SheetSlot } from "./panels/PanelSheet";
import { ProjectDirectionSection } from "./ProjectDirectionSection";
import { DeliverySwitches, ONCHECK_LABEL, UPFRONT_LABEL, useHeld } from "./direction/DeliverySwitches";

export type SkillSwitch = { skill: string } & Partial<Delivery>;

interface Props {
  state: SkillsConfigPayload | null;
  onChange: (change: SkillSwitch) => void;
  slot: SheetSlot | null;
}

const mono = "var(--font-mono, 'JetBrains Mono', monospace)";
const small: React.CSSProperties = { fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 };

export function SkillsPanel({ state, onChange, slot }: Props) {
  const held = useHeld<Delivery>();
  useEffect(() => { held.answered(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!slot) return null;
  const deliveryOf = (name: string) => held.shown(name, state ? skillDelivery(state.config, name) : { upfront: false, onCheck: false });
  const inUse = state ? state.catalogue.filter((s) => { const d = deliveryOf(s.name); return d.upfront || d.onCheck; }).length : 0;

  return (
    <SheetPortal slot={slot} subtitle={state ? `your project's own, and ${inUse} of ${state.catalogue.length} generic in use · advice only` : undefined}>
    <SheetBody>
    <div data-skills-panel style={{ maxWidth: 720, color: "var(--text-primary)" }}>
      <div data-direction-explainer style={{ ...small, color: "var(--text-secondary)", marginBottom: 16 }}>
        Each rule below has two switches for what Claude is told about it. <b style={{ fontWeight: 600 }}>{UPFRONT_LABEL}</b>: its
        rules once per session, when a prompt reaches a thread they apply to. <b style={{ fontWeight: 600 }}>{ONCHECK_LABEL}</b>: when an
        edit trips the check a rule is tied to, the rule and its reason arrive beside the finding. Both off, it is not used.
        Direction is advice and never blocks an edit — a rule that must block belongs in the Rules panel.
      </div>
      {/* 2026-10-16 — the project's own direction first: what this code already does */}
      <ProjectDirectionSection />
      <div style={{ fontSize: "var(--fs-14)", fontWeight: 600, marginBottom: 8 }}>Generic direction <span style={{ fontSize: "var(--fs-11)", fontWeight: 400, color: "var(--text-muted)" }}>shipped with VibeGraph · off by default</span></div>
      <div style={{ ...small, marginBottom: 12 }}>
        Coding guidance that holds for any project: each skill is a few rules, each with the reason and the check that catches it.
        Told up front, a skill also reaches the chat panel, work-run workers and thread agents in full.
      </div>

      {!state && <div data-skills-loading style={small}>Waiting for the server…</div>}
      {state && state.catalogue.length === 0 && <div data-skills-empty style={small}>No skills shipped with this VibeGraph.</div>}
      {state?.catalogue.map((s) => {
        const d = deliveryOf(s.name);
        const by = state.config.enabledBy?.[s.name];
        const checks = s.binds.filter((b) => b.startsWith("check:")).map((b) => b.slice(6));
        return (
          <div key={s.name} data-skill-row={s.name} data-skill-enabled={d.upfront || d.onCheck ? "true" : "false"}
            style={{ padding: "12px 0", borderTop: "1px solid var(--border-edge)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontSize: "var(--fs-12)", fontFamily: mono, fontWeight: 600 }}>{s.name}</span>
              <span style={small}>v{s.skillVersion}</span>
              <span data-skill-evidence={s.evidence}
                title={s.evidence === "validated" ? "A paired with/without drill showed it changes what Claude does" : "No drill recorded yet: direction, advisory"}
                style={{ fontSize: "var(--fs-11)", color: s.evidence === "validated" ? "var(--accent-thread)" : "var(--accent-warning)" }}>
                {s.evidence}
              </span>
            </div>
            <div style={{ fontSize: "var(--fs-11)", color: "var(--text-primary)", lineHeight: 1.5, marginTop: 2 }}>{s.description}</div>
            <div data-skill-breadth style={{ ...small, marginTop: 4, fontFamily: mono }}>
              {s.of > 0 ? `applies to ${s.fires} of ${s.of} threads here` : "breadth unmeasured (no project profile)"}
              {" · "}{checks.length ? `checked by ${checks.join(", ")}` : "no check — judgement only"}
            </div>
            {s.rules?.length ? (
              <details style={{ marginTop: 4 }}>
                <summary style={{ ...small, cursor: "pointer" }}>its {s.rules.length} rules</summary>
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, ...small, color: "var(--text-secondary)" }}>
                  {s.rules.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </details>
            ) : null}
            <DeliverySwitches
              value={d}
              canCheck={checks.length > 0}
              upfrontHint={`Its rules reach Claude Code once per session, when a prompt reaches one of the ${s.fires || "matching"} threads it applies to; the chat, workers and thread agents get the whole skill.`}
              data={{ "skill-switch": s.name }}
              onChange={(patch) => { held.press(s.name, { ...d, ...patch }); onChange({ skill: s.name, ...patch }); }}
            />
            {(d.upfront || d.onCheck) && by && <div style={{ ...small, marginTop: 2 }}>in use since {by.at.slice(0, 10)}, by a {by.source === "human" ? "person" : by.source}</div>}
          </div>
        );
      })}
    </div>
    </SheetBody>
    </SheetPortal>
  );
}
