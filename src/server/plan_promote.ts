// Promote a PLANNED rule into a real one (2026-09-30). A planned rule is
// advice: it is checked against the code, and it blocks nothing. Promotion is
// the one door from the plan into `.vibegraph/constraints.json`, where the
// hooks and `check` enforce it — so only a person walks through it (the CLI
// and the Plan panel call this; MCP has no route to it). The rule goes in
// through the SAME validator and duplicate check as `constraints add`, its
// reason carried in the text, and the planned rule is kept, marked
// `promoted`, pointing at the constraint it became.

import type { Plan, PlanPolicy } from "../shared/plan_types.ts";
import { PLAN_CAPS } from "../shared/plan_types.ts";
import { addConstraint, findDuplicate, loadConstraints, validateConstraintInput } from "./constraint_store.ts";
import { savePlan } from "./plan_store.ts";

export function constraintInputFor(p: PlanPolicy): unknown {
  return {
    kind: "invariant",
    text: `${p.text.replace(/\.$/, "")} — ${p.why}`,
    scope: p.files?.length ? { files: p.files } : { all: true },
    ...(p.check ? { check: p.check } : {}),
    note: `promoted from the plan (${p.id})`,
  };
}

export function promotePolicy(root: string, plan: Plan, id: string | undefined, now: Date = new Date()): { message?: string; error?: string; plan?: Plan } {
  if (!id) return { error: "promote needs a planned rule's id (see `plan show`)" };
  const idx = plan.policies.findIndex((p) => p.id === id);
  if (idx < 0) return { error: `no planned rule "${id}"` };
  const p = plan.policies[idx];
  if (p.status === "promoted") return { error: `${id} is already ${p.constraintId}` };
  if (p.status === "dropped") return { error: `${id} was dropped — agree it again before promoting` };
  const v = validateConstraintInput(constraintInputFor(p));
  if (!v.ok) return { error: `constraints.json would refuse it: ${v.error}` };
  const twin = findDuplicate(loadConstraints(root), v.value.text);
  if (twin) return { error: `it restates ${twin.id} ("${twin.text.slice(0, 80)}")` };
  const c = addConstraint(root, v.value, "human", () => now);
  const next: Plan = structuredClone(plan);
  next.policies[idx] = { ...p, status: "promoted", constraintId: c.id };
  next.revision += 1;
  next.changelog = [...next.changelog, { rev: next.revision, at: now.toISOString(), by: "human" as const, change: `promoted policies ${id} to ${c.id}` }].slice(-PLAN_CAPS.changelog);
  const saved = savePlan(root, next);
  if (saved.error) return { error: `${c.id} was stated, but the plan could not record it: ${saved.error}` };
  return { plan: next, message: `promoted ${id} → ${c.id} (human-stated in .vibegraph/constraints.json${p.check ? "; its check now runs in `check` and the hooks, and may block" : "; prose only — no check"})` };
}
