// A spec with more rules than the plan holds (2026-10-02, from field use: a
// 25-rule spec was refused whole by the Plan panel — "policies: 25 items,
// over the cap of 10" — and nothing entered the plan). The rules that fit
// are added, core first; the rest are named; `--rules` chooses which.
//
//   node --experimental-strip-types --no-warnings --test test/software_plan_cap.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { specToPlan, rulesInPlanOrder } from "../src/server/software_apply.ts";
import { emptyPlan, validatePlan } from "../src/server/plan_store.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { PLAN_CAPS } from "../src/shared/plan_types.ts";

const rule = (i, core = false) => ({ id: `s${i}`, text: `rule number ${i}`, why: `reason ${i}`, cite: null, ...(core ? { core: true } : {}) });
const spec = (n, coreIds = []) => ({
  tool: "ledger", role: "db", definition: "A ledger store.", definitionCite: null,
  identity: { packages: ["ledger"], calls: [] }, operations: [], states: [], permissions: [],
  rules: Array.from({ length: n }, (_, k) => rule(k + 1, coreIds.includes(k + 1))),
  sources: [], status: "ratified",
});

function planWith(existing) {
  let plan = emptyPlan("Store readings in the ledger");
  if (existing) {
    const r = applyPlanOps(plan, Array.from({ length: existing }, (_, k) => ({ op: "add", section: "policies", item: { text: `own rule ${k}`, why: "ours", status: "proposed" } })), "human");
    assert.equal(r.error, undefined);
    plan = r.plan;
  }
  return plan;
}
const have = (plan) => ({ tools: new Set(plan.stack.map((t) => t.tool)), policies: plan.policies });

test("25 rules into an empty plan: the cap's worth enter, core first; the rest are named; the plan validates", () => {
  const plan = planWith(0);
  const fit = specToPlan(spec(25, [20, 22]), {}, have(plan));
  const added = fit.ops.filter((o) => o.section === "policies").map((o) => o.item.source);
  assert.equal(added.length, PLAN_CAPS.policies);
  assert.deepEqual(added.slice(0, 2), ["ledger s20", "ledger s22"], "the core rules go in first");
  assert.equal(fit.omitted.length, 25 - PLAN_CAPS.policies);
  const r = applyPlanOps(plan, fit.ops, "human");
  assert.equal(r.error, undefined, "what is added fits under the cap");
  assert.equal(validatePlan(r.plan), null);
});

test("the room is what the plan has left; a dropped rule frees its place", () => {
  const plan = planWith(7);
  assert.equal(specToPlan(spec(12), {}, have(plan)).ops.filter((o) => o.section === "policies").length, PLAN_CAPS.policies - 7);
  plan.policies[0].status = "dropped";
  assert.equal(specToPlan(spec(12), {}, have(plan)).ops.filter((o) => o.section === "policies").length, PLAN_CAPS.policies - 6);
});

test("--rules chooses which, in the order given; an unknown id is reported", () => {
  const plan = planWith(0);
  const fit = specToPlan(spec(25), {}, have(plan), { rules: ["s14", "s3"] });
  assert.deepEqual(fit.ops.filter((o) => o.section === "policies").map((o) => o.item.source), ["ledger s14", "ledger s3"]);
  assert.deepEqual(fit.omitted, []);
  assert.deepEqual(rulesInPlanOrder(spec(3), ["s2", "s9"]).unknown, ["s9"]);
});

test("a full plan still takes updates to rules already in it — they take no room", () => {
  let plan = planWith(0);
  plan = applyPlanOps(plan, specToPlan(spec(25), {}, have(plan)).ops, "human").plan;
  const changed = spec(25);
  changed.rules[0].text = "rule number 1, reworded";
  const fit = specToPlan(changed, {}, have(plan));
  assert.deepEqual(fit.ops.map((o) => o.op), ["update"]);
  assert.equal(fit.omitted.length, 25 - PLAN_CAPS.policies);
});
