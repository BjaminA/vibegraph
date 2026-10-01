// ASSUMPTIONS and EVIDENCE (2026-10-01). A plan rests on things nobody has
// checked yet — "the store enforces per-zone write access", "the sync service
// delivers a watch within a second". The plan says so: an item `assumes` open
// questions, and a question (or an item) carries `evidence` — a command, what
// it should show, when, and what it did show. VibeGraph never runs the
// command; a person records the result.
//
// `plan check` then says it next to the code's own verdict: "realised in
// code, assumption UNVERIFIED", and a REFUTED assumption flags every item that
// rests on it — code that matches the plan is still built on something false.

import type { AssumptionState, Plan, PlanFinding, PlanQuestion, PlanSection } from "../shared/plan_types.ts";
import { planItemId, sectionItems } from "../shared/plan_types.ts";

const ITEM_SECTIONS: PlanSection[] = ["processes", "boundaries", "stack", "threads", "policies", "stores", "principals", "flows", "modules"];

/** Where an open question stands: its latest RUN evidence decides. */
export function assumptionState(q: PlanQuestion | undefined): AssumptionState {
  const runs = (q?.evidence ?? []).filter((e) => e.result);
  if (!runs.length) return "unverified";
  const sorted = [...runs].sort((a, b) => a.at.localeCompare(b.at));
  return sorted[sorted.length - 1].result!;
}

/** Annotate every finding whose item assumes something, and add one finding
 *  per question something rests on (or that has evidence). Mutates `findings`. */
export function applyAssumptions(plan: Plan, findings: PlanFinding[]): void {
  const qs = new Map(plan.open.map((q) => [q.id, q]));
  const restsOn = new Map<string, string[]>();
  for (const section of ITEM_SECTIONS) {
    for (const it of sectionItems(plan, section)) {
      if (it.status === "dropped" || !it.assumes?.length) continue;
      const id = planItemId(section, it);
      const states = (it.assumes as string[]).map((q) => ({ id: q, state: assumptionState(qs.get(q)) }));
      for (const q of it.assumes as string[]) restsOn.set(q, [...(restsOn.get(q) ?? []), `${section} ${id}`]);
      const f = findings.find((x) => x.section === section && x.id === id);
      if (!f) continue;
      f.assumptions = states;
      const shaky = states.filter((s) => s.state !== "confirmed");
      if (shaky.length) f.detail += ` — ${f.verdict === "realised" ? "realised in code, " : ""}${shaky.map((s) => `assumption ${s.id} ${s.state.toUpperCase()}`).join(", ")}`;
    }
  }
  for (const q of plan.open) {
    const resting = restsOn.get(q.id) ?? [];
    if (!resting.length && !q.evidence?.length) continue;
    const state = assumptionState(q);
    const runs = [...(q.evidence ?? [])].filter((e) => e.result).sort((a, b) => a.at.localeCompare(b.at));
    const last = runs[runs.length - 1];
    const run = last ? `\`${last.command}\` (expected: ${last.expect}) on ${last.at.slice(0, 10)}${last.note ? ` — ${last.note}` : ""}` : "no evidence run yet";
    findings.push({
      section: "open", id: q.id,
      verdict: state === "refuted" ? "violated" : state === "confirmed" ? "pass" : "unverified",
      detail: `${state.toUpperCase()}: ${run}${resting.length ? `; ${state === "refuted" ? "FLAGS" : "rests on it:"} ${resting.join(", ")}` : ""}`,
    });
  }
}
