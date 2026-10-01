// THE PLAN's edits (2026-09-30). A plan changes by small, reviewable
// operations — never by rewriting the file — so every change is one line in
// the changelog and the revision counts them.
//
// Who may do what is the point of the mode:
//   - an AGENT (Claude through MCP) proposes: whatever it adds lands
//     `proposed`, and an agent's change to an AGREED item puts it back to
//     `proposed`, because an agreement a model can quietly edit is not one;
//     it can never `agree`, and never promote a rule into constraints.json;
//   - a HUMAN (the CLI, the Plan panel) may do all of it.
// A batch applies whole or not at all: the result is validated (caps
// included) before anything is written, and a refusal says why.

import type { Plan, PlanActor, PlanSection } from "../shared/plan_types.ts";
import { PLAN_CAPS, PLAN_SECTIONS, planItemId } from "../shared/plan_types.ts";
import { validatePlan, validateItem, emptyPlan } from "./plan_store.ts";

export type PlanOp =
  | { op: "set-objective"; text: string }
  | { op: "add"; section: PlanSection; item: Record<string, unknown> }
  | { op: "update"; section: PlanSection; id: string; fields: Record<string, unknown> }
  | { op: "drop"; section: PlanSection; id: string }
  | { op: "agree"; section: PlanSection; id: string }
  | { op: "rename"; section: PlanSection; from: string; to: string }
  | { op: "close" } | { op: "reopen" };

export const PLAN_OP_NAMES = ["set-objective", "add", "update", "drop", "agree", "rename", "close", "reopen"] as const;

/** Parse an untrusted op (WS, MCP, the CLI). */
export function parsePlanOp(x: unknown): { ok: true; op: PlanOp } | { ok: false; error: string } {
  if (!x || typeof x !== "object" || Array.isArray(x)) return { ok: false, error: "an op must be an object" };
  const o = x as Record<string, any>;
  if (!PLAN_OP_NAMES.includes(o.op)) return { ok: false, error: `op must be one of ${PLAN_OP_NAMES.join("|")}` };
  if (o.op === "set-objective") return typeof o.text === "string" ? { ok: true, op: { op: o.op, text: o.text } } : { ok: false, error: "set-objective needs text" };
  if (o.op === "close" || o.op === "reopen") return { ok: true, op: { op: o.op } };
  if (!PLAN_SECTIONS.includes(o.section)) return { ok: false, error: `section must be one of ${PLAN_SECTIONS.join("|")}` };
  if (o.op === "add") return o.item && typeof o.item === "object" ? { ok: true, op: { op: "add", section: o.section, item: o.item } } : { ok: false, error: "add needs an item" };
  if (o.op === "rename") {
    return typeof o.from === "string" && o.from && typeof o.to === "string" && o.to
      ? { ok: true, op: { op: "rename", section: o.section, from: o.from, to: o.to } }
      : { ok: false, error: "rename needs from and to (the old and the new id)" };
  }
  if (typeof o.id !== "string" || !o.id) return { ok: false, error: `${o.op} needs the item's id` };
  if (o.op === "update") return o.fields && typeof o.fields === "object" ? { ok: true, op: { op: "update", section: o.section, id: o.id, fields: o.fields } } : { ok: false, error: "update needs fields" };
  return { ok: true, op: { op: o.op, section: o.section, id: o.id } };
}

/** The next free id in a section ("b3", "p2", "q4"). */
function nextId(plan: Plan, section: PlanSection): string {
  const prefix = { boundaries: "b", policies: "p", open: "q" }[section as string] ?? "x";
  const used = new Set((plan[section] as any[]).map((i) => planItemId(section, i)));
  let n = (plan[section] as any[]).length + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const describe = (op: PlanOp, id?: string) =>
  op.op === "set-objective" ? `objective: "${op.text}"`
  : op.op === "close" || op.op === "reopen" ? `${op.op}d the plan`
  : op.op === "rename" ? `rename ${op.section} ${op.from} → ${op.to}`
  : `${op.op} ${op.section} ${id ?? (op as any).id}`;

export interface ApplyResult { plan?: Plan; error?: string; changes: string[] }

/** Apply a batch of ops as `by`. Pure: the caller saves the result. */
export function applyPlanOps(prior: Plan | null, ops: PlanOp[], by: PlanActor, now: Date = new Date()): ApplyResult {
  if (!ops.length) return { error: "no ops", changes: [] };
  const first = ops[0];
  const changes: string[] = [];
  let plan: Plan;
  let rest = ops;
  if (prior) plan = structuredClone(prior);
  else if (first.op === "set-objective" && by === "agent") {
    return { error: "a person starts a plan with its objective (plan init, or the Plan panel) — the objective is what everything else is measured against", changes: [] };
  } else if (first.op === "set-objective") {
    // A new plan begins with its objective, and the changelog says so.
    plan = emptyPlan(first.text);
    changes.push(describe(first));
    rest = ops.slice(1);
  } else return { error: "there is no plan yet — start one with an objective (plan init / set-objective)", changes: [] };
  for (const op of rest) {
    const err = applyOne(plan, op, by, changes);
    if (err) return { error: `${describe(op)}: ${err}`, changes: [] };
  }
  plan.revision += 1;
  const at = now.toISOString();
  plan.changelog = [...plan.changelog, ...changes.map((change) => ({ rev: plan.revision, at, by, change }))].slice(-PLAN_CAPS.changelog);
  const invalid = validatePlan(plan);
  if (invalid) return { error: `refused, nothing written: ${invalid}`, changes: [] };
  return { plan, changes };
}

function applyOne(plan: Plan, op: PlanOp, by: PlanActor, changes: string[]): string | null {
  if (op.op === "set-objective") {
    if (plan.objective === op.text) return null;
    // The objective is what every item is measured against, so it is a
    // person's to change. An agent's new objective is recorded as an open
    // question carrying its wording, for the person to take or drop.
    if (by === "agent") {
      const id = nextId(plan, "open");
      plan.open.push({ id, text: `Proposed objective: ${op.text}` });
      changes.push(`proposed a new objective as ${id} (only a person changes it)`);
      return null;
    }
    plan.objective = op.text;
    changes.push(describe(op));
    return null;
  }
  if (op.op === "close" || op.op === "reopen") {
    if (by !== "human") return "only a person closes or reopens the plan";
    plan.closed = op.op === "close";
    changes.push(describe(op));
    return null;
  }
  const list = plan[op.section] as any[];
  if (op.op === "rename") return renameItem(plan, op, by, changes);
  if (op.op === "add") {
    const item: any = { ...op.item };
    if (op.section === "open") {
      if (!item.id) item.id = nextId(plan, "open");
      delete item.status;
    } else {
      if (op.section !== "stack" && op.section !== "processes" && op.section !== "threads" && !item.id) item.id = nextId(plan, op.section);
      // An agent proposes; only a person may add something already agreed.
      if (by === "agent" || !item.status) item.status = "proposed";
      if (item.status === "promoted") return "an item cannot be added as promoted — promote it with `plan promote`";
    }
    const id = planItemId(op.section, item);
    if (list.some((i) => planItemId(op.section, i) === id)) return `"${id}" is already in ${op.section} — update it instead`;
    const bad = validateItem(op.section, item);
    if (bad) return bad;
    list.push(item);
    changes.push(describe(op, id));
    return null;
  }
  const idx = list.findIndex((i) => planItemId(op.section, i) === op.id);
  if (idx < 0) return `no "${op.id}" in ${op.section}`;
  const item = list[idx];
  if (op.op === "drop") {
    if (op.section === "open") list.splice(idx, 1);
    else {
      if (item.status === "promoted") return `a promoted rule lives in constraints.json now as ${item.constraintId ?? "a constraint"} — remove it with \`vibegraph-knowledge constraint remove ${item.constraintId ?? "<id>"}\``;
      item.status = "dropped";
    }
    changes.push(describe(op));
    return null;
  }
  if (op.op === "agree") {
    if (by !== "human") return "only a person agrees to a planned item — the agent proposes";
    if (op.section === "open") return "a question is answered by dropping it (and recording the answer as an item)";
    if (item.status === "promoted") return "already promoted";
    item.status = "agreed";
    changes.push(describe(op));
    return null;
  }
  // update
  const fields = { ...op.fields };
  for (const k of ["id", "tool", "constraintId"]) delete (fields as any)[k];
  if ("status" in fields) {
    if (by === "agent") return "an agent cannot set a status — it proposes; a person agrees or drops";
    if (fields.status === "promoted") return "promote a rule with `plan promote`";
  }
  if (item.status === "promoted") return `a promoted rule lives in constraints.json now as ${item.constraintId ?? "a constraint"} — change it there: \`vibegraph-knowledge constraint ${by === "agent" ? "propose" : "edit"} ${item.constraintId ?? "<id>"} --check '<json>' --why "…"\` (\`constraint show ${item.constraintId ?? "<id>"}\` prints it)`;
  const next = { ...item, ...fields };
  // An agreement a model can quietly edit is not one.
  if (by === "agent" && item.status === "agreed") next.status = "proposed";
  const bad = validateItem(op.section, next);
  if (bad) return bad;
  list[idx] = next;
  // Say WHY an agreement went back to proposed, and which field did it.
  const changedFields = Object.keys(fields).filter((k) => JSON.stringify(item[k]) !== JSON.stringify((next as any)[k]));
  changes.push(`${describe(op)}${by === "agent" && item.status === "agreed" ? ` (was agreed — back to proposed: an agent changed ${changedFields.join(", ") || "it"}; a person agrees again)` : ""}`);
  return null;
}

/** 2026-10-01 — rename an item and every reference to it: a process in the
 *  boundaries' ends and the threads' `process`, a tool in the boundaries'
 *  ends, a boundary in the threads' `b1:step`s, anything in the rules' and
 *  questions' `about` — so a thread's human name can change without
 *  re-keying the plan by hand. */
function renameItem(plan: Plan, op: Extract<PlanOp, { op: "rename" }>, by: PlanActor, changes: string[]): string | null {
  const list = plan[op.section] as any[];
  const item = list.find((i) => planItemId(op.section, i) === op.from);
  if (!item) return `no "${op.from}" in ${op.section}`;
  if (op.from === op.to) return "the new id is the old one";
  if (list.some((i) => planItemId(op.section, i) === op.to)) return `"${op.to}" is already in ${op.section}`;
  if (op.section === "stack") item.tool = op.to; else item.id = op.to;
  const bad = validateItem(op.section, item);
  if (bad) return bad;
  let refs = 0;
  const swap = (v: string) => { if (v === op.from) { refs++; return op.to; } return v; };
  if (op.section === "processes" || op.section === "stack") {
    for (const b of plan.boundaries) { b.from = swap(b.from); b.to = swap(b.to); }
  }
  if (op.section === "processes") for (const t of plan.threads) if (t.process) t.process = swap(t.process);
  if (op.section === "boundaries") {
    for (const t of plan.threads) t.primary = t.primary.map((s) => (s.startsWith(`${op.from}:`) ? (refs++, `${op.to}:${s.slice(op.from.length + 1)}`) : s));
  }
  for (const x of [...plan.policies, ...plan.open] as Array<{ about?: string }>) if (x.about) x.about = swap(x.about);
  const demoted = by === "agent" && item.status === "agreed";
  if (demoted) item.status = "proposed";
  changes.push(`${describe(op)}${refs ? ` (${refs} reference${refs === 1 ? "" : "s"} updated)` : ""}${demoted ? " (was agreed — back to proposed: an agent renamed it; a person agrees again)" : ""}`);
  return null;
}
