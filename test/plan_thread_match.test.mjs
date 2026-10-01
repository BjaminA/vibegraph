// Planned threads with human names (2026-10-01, item 5 of the hooks-feedback
// brief, and Module 3 of the planned-architecture brief): a thread's
// `entryPoint` (an id, or a file) is matched first; an unmatched thread gets
// "did you mean …"; a drifted one says WHY each step is missing; `rename`
// renames an item and every reference to it; an agent's update or rename of
// an agreed item says which field sent it back to proposed.
//
//   npm run test:plan-thread-match
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";

const ROOT = "test/fixtures/plan/map_demo";
let env, stack, base;
before(() => {
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  stack = buildStackIndex(env, ROOT);
  base = loadPlan(ROOT);
});
const withThread = (t) => applyPlanOps(base, [{ op: "add", section: "threads", item: { entry: "route", serves: "within a minute of a reading", status: "agreed", ...t } }], "human").plan;
const finding = (plan, id) => reconcilePlan(plan, env, stack, ROOT).findings.find((f) => f.section === "threads" && f.id === id);

test("a human-named thread matches through its entryPoint — an id, or a file", () => {
  // Over the thread cap otherwise (map_demo has 4 of 7): fine.
  const byId = finding(withThread({ id: "ingest-readings", entryPoint: "api/app.py:post_readings", primary: ["validate", "insert_reading"] }), "ingest-readings");
  assert.equal(byId.verdict, "realised", byId.detail);
  assert.equal(byId.entryPointId, "api/app.py:post_readings");
  const byFile = finding(withThread({ id: "ingest-readings", entryPoint: "api/app.py", primary: ["validate"] }), "ingest-readings");
  assert.equal(byFile.entryPointId, "api/app.py:post_readings", "the file's one entry");
  const none = finding(withThread({ id: "ingest-readings", entryPoint: "api/nope.py", primary: ["validate"] }), "ingest-readings");
  assert.match(none.detail, /entryPoint api\/nope\.py is no entry point the code has/);
});

test("an unmatched thread suggests the closest entry points", () => {
  const f = finding(withThread({ id: "ingest-readings", primary: ["validate", "insert_reading"] }), "ingest-readings");
  assert.equal(f.verdict, "not-built");
  assert.ok(f.suggestions?.includes("api/app.py:post_readings"), JSON.stringify(f.suggestions));
  assert.match(f.detail, /did you mean .*api\/app\.py:post_readings.*set it as the thread's `entryPoint`/);
});

test("a drifted thread says why each step is missing", () => {
  const f = finding(withThread({ id: "POST readings", entryPoint: "api/app.py:post_readings", primary: ["validate", "forecast_all", "publish_forecast"] }), "POST readings");
  assert.equal(f.verdict, "drifted");
  assert.match(f.missingWhy.forecast_all, /defined in worker\/forecast\.py.*nothing on api\/app\.py:post_readings's thread reaches it/);
  assert.match(f.missingWhy.publish_forecast, /not defined anywhere the parser read/);
  assert.match(f.detail, /forecast_all \(defined in worker\/forecast\.py/);
});

test("rename renames an item and every reference to it", () => {
  const r1 = applyPlanOps(base, [{ op: "rename", section: "processes", from: "dashboard", to: "web" }], "human");
  assert.equal(r1.error, undefined, r1.error);
  assert.equal(r1.plan.boundaries.find((b) => b.id === "b3").from, "web");
  assert.equal(r1.plan.threads.find((t) => t.id === "render_dashboard").process, "web");
  assert.equal(r1.plan.open.find((q) => q.id === "q1").about, "web");
  assert.match(r1.plan.changelog.at(-1).change, /rename processes dashboard → web \(3 references updated\)/);
  const r2 = applyPlanOps(base, [{ op: "rename", section: "boundaries", from: "b1", to: "b9" }], "human").plan;
  assert.deepEqual(r2.threads.find((t) => t.id === "POST /readings").primary, ["validate", "b9:insert", "insert_reading"]);
  assert.equal(r2.policies.find((p) => p.id === "p1").about, "b9");
  assert.match(applyPlanOps(base, [{ op: "rename", section: "threads", from: "nope", to: "x" }], "human").error, /no "nope"/);
  assert.match(applyPlanOps(base, [{ op: "rename", section: "processes", from: "api", to: "forecaster" }], "human").error, /already in processes/);
});

test("an agent's update or rename of an agreed item says which field sent it back to proposed", () => {
  const u = applyPlanOps(base, [{ op: "update", section: "threads", id: "POST /readings", fields: { primary: ["validate", "insert_reading"] } }], "agent");
  assert.equal(u.plan.threads.find((t) => t.id === "POST /readings").status, "proposed");
  assert.match(u.plan.changelog.at(-1).change, /back to proposed: an agent changed primary; a person agrees again/);
  const r = applyPlanOps(base, [{ op: "rename", section: "threads", from: "POST /readings", to: "ingest" }], "agent");
  assert.match(r.plan.changelog.at(-1).change, /an agent renamed it/);
});
