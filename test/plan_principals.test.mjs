// Principals and who may write (2026-10-01, Module 3 of the plan-architecture
// brief). Fixture test/fixtures/plan/store_demo: the requester runs as
// svc-requester, the decider as svc-decider; zone `requests` may be written
// only by svc-requester, `verdicts` only by svc-decider. Pinned: "only
// principal P writes zone Z" is DATA (`writers` + `runsAs`); the write matrix
// is derived from the code's access sites; a process writing a zone its
// principal may not is VIOLATED with the file and line; a write the check
// cannot place is UNVERIFIABLE, never a pass; every name a principal is
// referenced by must be a planned principal, and a rename carries them.
//
//   npm run test:plan-principals
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan, validatePlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { formatPlanMd } from "../src/server/plan_render.ts";
import { planModel, PLAN_ID } from "../src/webview/system/arch_plan.ts";

const ROOT = "test/fixtures/plan/store_demo";
let env, stack, plan;
before(() => {
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  stack = buildStackIndex(env, ROOT);
  plan = loadPlan(ROOT);
});
const find = (rec, section, id) => rec.findings.find((f) => f.section === section && f.id === id);

test("the write matrix is derived from the code, and every write is by an allowed principal", () => {
  const rec = reconcilePlan(plan, env, stack, ROOT);
  assert.equal(find(rec, "stores", "docs/requests:writers").verdict, "pass");
  assert.equal(find(rec, "stores", "docs/verdicts:writers").verdict, "pass");
  const cell = (p, z) => rec.writeMatrix.find((c) => c.principal === p && c.zone === z);
  // 2026-10-02 — each write placed through a thread also carries the call path it was reached by (audit)
  assert.deepEqual(cell("svc-decider", "docs/verdicts"), { principal: "svc-decider", zone: "docs/verdicts", allowed: true, writes: ["apps/decider/src/main.ts:8 onRequest"], paths: { "apps/decider/src/main.ts:8 onRequest": "decider via main.ts → onRequest" } });
  assert.deepEqual(cell("svc-requester", "docs/requests").writes, ["apps/requester/src/main.ts:6 submit"]);
  assert.equal(find(rec, "principals", "svc-decider").verdict, "realised");
  assert.equal(find(rec, "principals", "auditor").verdict, "unverified", "a human role is outside the code");
});

test("ACCEPTANCE: a process writing a zone its principal may not is a violation, named by file and line", () => {
  const p = structuredClone(plan);
  p.stores[0].zones[1].writers = ["svc-requester"]; // verdicts: only the requester may write — the decider does
  const rec = reconcilePlan(p, env, stack, ROOT);
  const f = find(rec, "stores", "docs/verdicts:writers");
  assert.equal(f.verdict, "violated");
  assert.match(f.detail, /decider \(runs as svc-decider\) writes it at apps\/decider\/src\/main\.ts:8 onRequest/);
  const c = rec.writeMatrix.find((x) => x.principal === "svc-decider" && x.zone === "docs/verdicts");
  assert.equal(c.allowed, false);
  assert.match(formatPlanMd(p, rec), /\| \*\*svc-decider\*\* \|.*\*\*VIOLATION\*\* \(apps\/decider\/src\/main\.ts:8 onRequest\)/);
  const zone = planModel(p, rec).nodes.find((n) => n.id === `${PLAN_ID}zone:docs/verdicts`);
  assert.match(zone.sublabel, /writers svc-requester · WRITER VIOLATED/);
});

test("a write the check cannot place is unverifiable, never a pass", () => {
  const p = structuredClone(plan);
  delete p.processes.find((x) => x.id === "decider").runsAs;
  const f = find(reconcilePlan(p, env, stack, ROOT), "stores", "docs/verdicts:writers");
  assert.equal(f.verdict, "unverifiable");
  assert.match(f.detail, /decider has no runsAs/);
});

test("names must be planned principals; a rename carries runsAs, writers and readers", () => {
  const bad = structuredClone(plan);
  bad.stores[0].zones[0].writers = ["svc-ghost"];
  assert.match(validatePlan(bad), /writers names "svc-ghost", which is not a planned principal/);
  const bad2 = structuredClone(plan);
  bad2.processes[0].runsAs = "nobody";
  assert.match(validatePlan(bad2), /runsAs "nobody" is not a planned principal/);
  const r = applyPlanOps(plan, [{ op: "rename", section: "principals", from: "svc-decider", to: "decider-id" }], "human");
  assert.equal(r.error, undefined);
  assert.equal(r.plan.processes.find((x) => x.id === "decider").runsAs, "decider-id");
  assert.deepEqual(r.plan.stores[0].zones[1].writers, ["decider-id"]);
  assert.deepEqual(r.plan.stores[0].zones[0].readers, ["decider-id"]);
  assert.match(r.changes[0], /3 references updated/);
});
