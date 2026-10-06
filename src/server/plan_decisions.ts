// THE DECISIONS LEDGER and SUPERSEDE (2026-10-06, direction review M1 + M10).
// On the reviewed project the important decisions were made in the terminal
// and recorded everywhere except the plan — in a question's text, a handover
// note, commit messages, the code. A decision is now a plan record: what was
// decided, where it came from, and the plan edits it implies (`effects`, the
// ordinary ops). An agent's decision waits PROPOSED; a person agrees it ONCE
// and its effects apply together — the answer and its plan edits are one act.
//
// SUPERSEDE is first-class: the item leaves every map (it is `dropped`, with
// `supersededBy` and `supersededWhy` saying why) while the record keeps it.
// An agent's supersede becomes a proposed decision; a person's applies.

import type { Plan, PlanActor, PlanDecision, PlanSection } from "../shared/plan_types.ts";
import { PLAN_CAPS, PLAN_SECTIONS, planItemId } from "../shared/plan_types.ts";

export const DECISION_OP_NAMES = ["decide", "supersede", "agree-decision", "reject-decision"] as const;
/** what a decision may change */
const EFFECT_OPS = new Set(["add", "update", "drop", "supersede", "set-objective", "close-question", "drop-question", "rename", "to-store", "rename-symbol"]);

export type DecisionOp =
  | { op: "decide"; said: string; from?: string; effects: Array<Record<string, unknown>>; evidence: string[]; status?: "rejected" }
  | { op: "supersede"; section: PlanSection; id: string; why: string; by?: string }
  | { op: "agree-decision"; id: string }
  | { op: "reject-decision"; id: string };

const line = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !v.includes("\n");

export function parseDecisionOp(o: Record<string, unknown>): { ok: true; op: DecisionOp } | { ok: false; error: string } {
  switch (o.op) {
    case "decide": {
      if (!line(o.said, PLAN_CAPS.decision)) return { ok: false, error: `decide needs "said": what was decided, one line of at most ${PLAN_CAPS.decision} characters` };
      const effects = Array.isArray(o.effects) ? o.effects : [];
      if (effects.length > 20) return { ok: false, error: "a decision has at most 20 effects" };
      for (const e of effects) if (!e || typeof e !== "object" || !EFFECT_OPS.has(String((e as any).op))) return { ok: false, error: `an effect is one of ${[...EFFECT_OPS].join(", ")}` };
      const evidence = (Array.isArray(o.evidence) ? o.evidence : []).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 300)).slice(0, 8);
      if (o.from !== undefined && !line(o.from, 200)) return { ok: false, error: "from is where it came from: open:qN, sensor:<key>, commit:<sha>, doc:<file>:<line>" };
      return { ok: true, op: { op: "decide", said: String(o.said), ...(o.from ? { from: String(o.from) } : {}), effects: effects as Array<Record<string, unknown>>, evidence, ...(o.status === "rejected" ? { status: "rejected" as const } : {}) } };
    }
    case "supersede":
      if (!PLAN_SECTIONS.includes(o.section as PlanSection) || o.section === "open" || typeof o.id !== "string") return { ok: false, error: "supersede needs a section (not open) and an id" };
      if (!line(o.why, PLAN_CAPS.decision)) return { ok: false, error: "supersede says why, in one line" };
      return { ok: true, op: { op: "supersede", section: o.section as PlanSection, id: o.id, why: String(o.why), ...(typeof o.by === "string" ? { by: o.by } : {}) } };
    case "agree-decision": case "reject-decision":
      return typeof o.id === "string" ? { ok: true, op: { op: o.op, id: o.id } as DecisionOp } : { ok: false, error: `${o.op} needs the decision's id` };
    default: return { ok: false, error: `not a decision op: ${String(o.op)}` };
  }
}

export function describeDecisionOp(op: DecisionOp): string {
  if (op.op === "decide") return `decide "${op.said}"${op.effects.length ? ` (${op.effects.length} effect${op.effects.length === 1 ? "" : "s"})` : ""}`;
  if (op.op === "supersede") return `supersede ${op.section} ${op.id} — ${op.why}`;
  return `${op.op === "agree-decision" ? "agree" : "reject"} decision ${op.id}`;
}

const nextId = (plan: Plan) => `d${1 + Math.max(0, ...(plan.decisions ?? []).map((d) => Number(d.id.slice(1)) || 0))}`;

/** Apply one decision op. `applyEffect` applies an ordinary op to THIS plan
 *  as a person (plan_ops' own applyOne); `tryEffects` dry-runs on a copy. */
export function applyDecisionOp(
  plan: Plan, op: DecisionOp, by: PlanActor, changes: string[], now: Date,
  applyEffect: (eff: Record<string, unknown>) => string | null,
  tryEffects: (effects: Array<Record<string, unknown>>) => string | null,
): string | null {
  const ledger = (plan.decisions ??= []);
  const keep = () => { plan.decisions = ledger.slice(-PLAN_CAPS.decisions); };
  if (op.op === "supersede") {
    if (by !== "human") {
      // an agent's supersede is a decision a person takes
      return applyDecisionOp(plan, { op: "decide", said: op.why, effects: [{ op: "supersede", section: op.section, id: op.id, why: op.why }], evidence: [], ...(op.by ? { from: op.by } : {}) }, by, changes, now, applyEffect, tryEffects);
    }
    const list = ((plan as any)[op.section] ?? []) as any[];
    const item = list.find((i) => planItemId(op.section, i) === op.id);
    if (!item) return `no "${op.id}" in ${op.section}`;
    if (item.status === "promoted") return `a promoted rule lives in constraints.json as ${item.constraintId ?? "a constraint"} — remove it there`;
    item.status = "dropped";
    item.supersededBy = op.by ?? "a person";
    item.supersededWhy = op.why;
    changes.push(describeDecisionOp(op));
    return null;
  }
  if (op.op === "decide") {
    // one decision per source: a pending or agreed one blocks a repeat, and a
    // sensor's finding a person rejected does not come back
    const prior = op.from ? ledger.find((d) => d.from === op.from && (d.status !== "rejected" || op.from!.startsWith("sensor:"))) : undefined;
    if (prior) return `a decision from ${op.from} is already in the ledger (${prior.id}, ${prior.status})`;
    const bad = tryEffects(op.effects);
    if (bad) return `its effects do not apply: ${bad}`;
    const d: PlanDecision = { id: nextId(plan), ...(op.from ? { from: op.from } : {}), said: op.said, effects: op.effects, evidence: op.evidence, status: "proposed", at: now.toISOString(), by };
    if (by === "human" && op.status === "rejected") { d.status = "rejected"; d.decidedAt = d.at; }
    else if (by === "human") {
      const err = agree(plan, d, now, applyEffect);
      if (err) return err;
    }
    ledger.push(d);
    keep();
    changes.push(`${describeDecisionOp(op)} as ${d.id} (${d.status})`);
    return null;
  }
  if (by !== "human") return "only a person agrees or rejects a decision — the agent proposes";
  const d = ledger.find((x) => x.id === op.id);
  if (!d) return `no decision ${op.id}`;
  if (d.status !== "proposed") return `${op.id} is already ${d.status}`;
  if (op.op === "reject-decision") { d.status = "rejected"; d.decidedAt = now.toISOString(); changes.push(describeDecisionOp(op)); return null; }
  const err = agree(plan, d, now, applyEffect);
  if (err) return err;
  changes.push(`${describeDecisionOp(op)}: ${d.said}`);
  return null;
}

/** A person agrees: the effects apply (each as a person), the question it
 *  answers is closed with it, and the decision is agreed. */
function agree(plan: Plan, d: PlanDecision, now: Date, applyEffect: (eff: Record<string, unknown>) => string | null): string | null {
  const effects = d.effects.map((e) => (e.op === "supersede" && !e.by ? { ...e, by: d.id } : e));
  const q = d.from?.startsWith("open:") ? d.from.slice(5) : null;
  if (q && plan.open.some((x) => x.id === q) && !effects.some((e) => (e.op === "close-question" || e.op === "drop-question") && e.id === q)) {
    effects.push({ op: "close-question", id: q, note: `decided as ${d.id}: ${d.said}`.slice(0, PLAN_CAPS.note) });
  }
  for (const e of effects) {
    const err = applyEffect(e);
    if (err) return `decision ${d.id}: ${String(e.op)}: ${err}`;
  }
  d.status = "agreed";
  d.decidedAt = now.toISOString();
  return null;
}

/** The ledger's shape, for validatePlan. */
export function validateDecisions(x: unknown): string | null {
  if (x === undefined) return null;
  if (!Array.isArray(x)) return "decisions must be an array";
  if (x.length > PLAN_CAPS.decisions) return `decisions keeps at most ${PLAN_CAPS.decisions}`;
  for (const [i, d] of (x as any[]).entries()) {
    if (!d || typeof d.id !== "string" || !line(d.said, PLAN_CAPS.decision)) return `decisions[${i}]: an id and what was said`;
    if (!["proposed", "agreed", "rejected"].includes(d.status)) return `decisions[${i}]: status is proposed, agreed or rejected`;
    if (!Array.isArray(d.effects) || !Array.isArray(d.evidence)) return `decisions[${i}]: effects and evidence are lists`;
    if (typeof d.at !== "string" || (d.by !== "human" && d.by !== "agent")) return `decisions[${i}]: at and by say when and who`;
  }
  return null;
}
