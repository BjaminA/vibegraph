// Platform assumptions and evidence (2026-10-01, Module 8 of the plan-
// architecture brief). Fixture test/fixtures/plan/store_demo: boundary b2
// assumes q1 ("does the store refuse a write its writers do not list?"),
// whose recorded evidence REFUTES it (the store returned 200); the store
// assumes q2, which nobody has checked. Pinned: `plan check` shows "realised in
// code, assumption UNVERIFIED / REFUTED"; a refuted assumption flags every item
// resting on it; the latest run decides; nothing is run by VibeGraph; a
// question something rests on cannot be dropped, only answered with evidence.
//
//   npm run test:plan-assumptions
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan, validatePlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { assumptionState } from "../src/server/plan_assumptions.ts";
import { formatPlanMd, compactPlan } from "../src/server/plan_render.ts";

const ROOT = "test/fixtures/plan/store_demo";
let env, stack, plan;
before(() => {
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  stack = buildStackIndex(env, ROOT);
  plan = loadPlan(ROOT);
});
const find = (rec, section, id) => rec.findings.find((f) => f.section === section && f.id === id);

test("ACCEPTANCE: realised in code, assumption REFUTED / UNVERIFIED — said beside the code's own verdict", () => {
  const rec = reconcilePlan(plan, env, stack, ROOT);
  const b2 = find(rec, "boundaries", "b2");
  assert.equal(b2.verdict, "realised", "the code's verdict is unchanged");
  assert.match(b2.detail, /— realised in code, assumption q1 REFUTED$/);
  assert.deepEqual(b2.assumptions, [{ id: "q1", state: "refuted" }]);
  assert.match(find(rec, "stores", "docs").detail, /assumption q2 UNVERIFIED$/);
});

test("ACCEPTANCE: a refuted assumption flags every item resting on it", () => {
  const p = structuredClone(plan);
  p.boundaries.find((b) => b.id === "b1").assumes = ["q1"];
  const rec = reconcilePlan(p, env, stack, ROOT);
  const q1 = find(rec, "open", "q1");
  assert.equal(q1.verdict, "violated");
  assert.match(q1.detail, /^REFUTED: `store-cli put verdicts\/v1 --as svc-requester` \(expected: 403 Forbidden\) on 2026-09-30 — it returned 200/);
  assert.match(q1.detail, /FLAGS boundaries b1, boundaries b2$/);
  assert.equal(find(rec, "open", "q2").verdict, "unverified");
  assert.match(compactPlan(p), /REFUTED assumptions \(items resting on them are built on something false\): q1/);
  assert.match(formatPlanMd(p, rec), /evidence 2026-09-30: `store-cli put verdicts\/v1 --as svc-requester` — expect: 403 Forbidden → \*\*REFUTED\*\*/);
});

test("the latest RUN decides; a recorded-but-not-run command leaves it unverified", () => {
  const q = { id: "q", text: "?", evidence: [
    { command: "a", expect: "x", at: "2026-09-01", result: "refuted" },
    { command: "a", expect: "x", at: "2026-09-20", result: "confirmed" },
    { command: "b", expect: "y", at: "2026-09-30" },
  ] };
  assert.equal(assumptionState(q), "confirmed");
  assert.equal(assumptionState({ id: "q", text: "?", evidence: [{ command: "b", expect: "y", at: "2026-09-30" }] }), "unverified");
  assert.equal(assumptionState(undefined), "unverified");
});

test("validation and the door: assumes names a plan question; a question things rest on is answered, not dropped", () => {
  const bad = structuredClone(plan);
  bad.boundaries[0].assumes = ["q9"];
  assert.match(validatePlan(bad), /assumes "q9", which is not an open question of the plan/);
  const bad2 = structuredClone(plan);
  bad2.open[0].evidence[0].at = "yesterday";
  assert.match(validatePlan(bad2), /evidence\[0\]\.at must be a date/);
  const drop = applyPlanOps(plan, [{ op: "drop", section: "open", id: "q1" }], "human");
  assert.match(drop.error, /boundaries? b2|b2 assumes q1 — record its evidence/);
  // Recording a new run is an ordinary update.
  const run = { command: "store-cli put verdicts/v1 --as svc-requester", expect: "403 Forbidden", at: "2026-10-01", result: "confirmed", note: "per-zone ACLs switched on" };
  const r = applyPlanOps(plan, [{ op: "update", section: "open", id: "q1", fields: { evidence: [...plan.open[0].evidence, run] } }], "human");
  assert.equal(r.error, undefined);
  assert.equal(find(reconcilePlan(r.plan, env, stack, ROOT), "open", "q1").verdict, "pass");
});
