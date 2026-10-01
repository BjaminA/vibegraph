// Coordination through the store (2026-10-01, Module 4 of the plan-
// architecture brief). Fixture test/fixtures/plan/store_demo: the requester
// writes a request the decider watches; the decider writes a verdict the
// requester watches — and NO call joins the two apps. Pinned: the code's
// INDIRECT hops are derived from the store's access sites (a write of a family
// in one process, a watch/read of it in another); a planned flow's steps are
// each realised or missing; the map joins the two processes with dashed edges
// labelled by the family; a computed zone never makes a hop.
//
//   npm run test:plan-flows
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan, validatePlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { formatPlanMd, compactPlan } from "../src/server/plan_render.ts";
import { planModel, overlayModel, PLAN_ID } from "../src/webview/system/arch_plan.ts";

const ROOT = "test/fixtures/plan/store_demo";
let env, stack, plan;
before(() => {
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  stack = buildStackIndex(env, ROOT);
  plan = loadPlan(ROOT);
});
const find = (rec, section, id) => rec.findings.find((f) => f.section === section && f.id === id);

test("indirect hops: a write of a family in one process, a watch of it in another", () => {
  const rec = reconcilePlan(plan, env, stack, ROOT);
  const hops = rec.indirectHops.map((h) => `${h.from}>${h.to}:${h.store}/${h.zone}:${h.family}`).sort();
  assert.deepEqual(hops, ["decider>requester:docs/verdicts:verdict", "requester>decider:docs/requests:request"]);
  const req = rec.indirectHops.find((h) => h.from === "requester");
  assert.equal(req.write, "apps/requester/src/main.ts:6 submit");
  assert.equal(req.read, "apps/decider/src/main.ts:11 module");
});

test("ACCEPTANCE: request → decision → verdict is A → B → A via the zones, every step realised", () => {
  const rec = reconcilePlan(plan, env, stack, ROOT);
  const f = find(rec, "flows", "f1");
  assert.equal(f.verdict, "realised");
  assert.deepEqual(f.steps.map((s) => [s.step, s.at]), [
    ["requester writes docs/requests (request)", "apps/requester/src/main.ts:6 submit"],
    ["decider watches docs/requests (request)", "apps/decider/src/main.ts:11 module"],
    ["decider writes docs/verdicts (verdict)", "apps/decider/src/main.ts:8 onRequest"],
    ["requester watches docs/verdicts (verdict)", "apps/requester/src/main.ts:9 module"],
  ]);
  // On the map: two dashed edges between the processes, labelled by the family.
  for (const m of [planModel(plan, rec), overlayModel({ version: "1", nodes: [], edges: [], groups: [], unplaced: { tests: 0, unmatchedHops: 0, toolsPresentNotCalled: [], unattributedBoundaries: 0 }, notes: [] }, plan, rec)]) {
    const hops = m.edges.filter((e) => e.planHop).map((e) => `${e.from}>${e.to}:${e.planHop}`).sort();
    assert.deepEqual(hops, [`${PLAN_ID}decider>${PLAN_ID}requester:docs/verdicts · verdict`, `${PLAN_ID}requester>${PLAN_ID}decider:docs/requests · request`]);
  }
  assert.match(formatPlanMd(plan, rec), /requester → decider via docs\/requests \(request\)/);
  assert.match(compactPlan(plan), /Flow f1 \(through the store\): requester write docs\/requests\(request\) → decider watch/);
});

test("a step the code lacks makes the flow drifted, naming it; all missing is not built", () => {
  const p = structuredClone(plan);
  p.flows[0].steps.push({ process: "decider", op: "write", zone: "docs/archive", family: "archived-request" });
  const f = find(reconcilePlan(p, env, stack, ROOT), "flows", "f1");
  assert.equal(f.verdict, "drifted");
  assert.deepEqual(f.missing, ["decider writes docs/archive (archived-request)"]);
  p.flows[0].steps = [{ process: "requester", op: "read", zone: "docs/archive" }, { process: "decider", op: "write", zone: "docs/archive" }];
  assert.equal(find(reconcilePlan(p, env, stack, ROOT), "flows", "f1").verdict, "not-built");
});

test("a computed zone never makes a hop", () => {
  const p = structuredClone(plan);
  p.stores[0].access = { write: ["conn.push"], watch: ["conn.subscribe"] }; // the client's own calls: zone is a parameter
  assert.equal(reconcilePlan(p, env, stack, ROOT).indirectHops, undefined);
});

test("validation: a flow names planned processes and zones; a process rename carries its steps", () => {
  const bad = structuredClone(plan);
  bad.flows[0].steps[0].process = "ghost";
  assert.match(validatePlan(bad), /names process "ghost", which is not planned/);
  const bad2 = structuredClone(plan);
  bad2.flows[0].steps[0].zone = "docs/nowhere";
  assert.match(validatePlan(bad2), /names zone "docs\/nowhere", which no planned store has/);
  const r = applyPlanOps(plan, [{ op: "rename", section: "processes", from: "decider", to: "judge" }], "human");
  assert.equal(r.error, undefined);
  assert.deepEqual(r.plan.flows[0].steps.map((s) => s.process), ["requester", "judge", "judge", "requester"]);
});
