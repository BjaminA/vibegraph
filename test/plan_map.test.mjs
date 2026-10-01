// The plan ON the architecture map (2026-10-01, Module 1 of the planned-
// architecture brief). Fixture test/fixtures/plan/map_demo: 3 processes,
// 4 threads (one realised, one built but drifted, two not built), 3
// boundaries, 2 rules and 1 open question, each rule and question `about` an
// item. Pinned: every planned item is drawn EXACTLY ONCE with its plan-check
// verdict — in the Plan view (all ghosts) and in the Overlay (realised items
// on their real box, the rest as ghosts); the seed proposal reads groups off
// the plan and is gated like a model's; a planned boundary between two stated
// trust zones says it crosses them; `about` must name a planned item.
//
//   npm run test:plan-map
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { applyArchStore, emptyStore, ratifyProposal } from "../src/server/arch_store.ts";
import { loadPlan, validatePlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { seedArchFromPlan } from "../src/server/plan_arch_seed.ts";
import { planModel, overlayModel, PLAN_ID } from "../src/webview/system/arch_plan.ts";
import { cardHeight } from "../src/webview/system/archLayout.ts";

const ROOT = "test/fixtures/plan/map_demo";
let plan, rec, derived;
before(() => {
  const env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  const stack = buildStackIndex(env, ROOT);
  derived = archModelForEnvelope(env, stack, buildCrossingIndex(env), ROOT, undefined, { applyStore: false });
  plan = loadPlan(ROOT);
  rec = reconcilePlan(plan, env, stack, ROOT);
});

/** Where each planned item is drawn: id → how many places. */
function census(model) {
  const seen = new Map();
  const hit = (k) => seen.set(k, (seen.get(k) ?? 0) + 1);
  for (const n of model.nodes) {
    if (n.source === "planned" && n.id !== `${PLAN_ID}threads`) hit(n.kind === "tool" ? `stack:${n.tool}` : `processes:${n.id.slice(PLAN_ID.length)}`);
    else if (n.plannedAs) hit(`${n.kind === "tool" ? "stack" : "processes"}:${n.plannedAs.id}`);
    for (const f of n.planFlows ?? []) hit(`threads:${f.id}`);
    for (const r of n.planRules ?? []) hit(`policies:${r.split(":")[0]}`);
    for (const q of n.planQuestions ?? []) hit(`open:${q.split(":")[0]}`);
  }
  for (const e of model.edges) {
    if (e.planBoundary) hit(`boundaries:${e.planBoundary}`);
    for (const r of e.planRules ?? []) hit(`policies:${r.split(":")[0]}`);
    for (const q of e.planQuestions ?? []) hit(`open:${q.split(":")[0]}`);
  }
  for (const r of model.planUnplaced.rules) hit(`policies:${r.split(":")[0]}`);
  for (const q of model.planUnplaced.questions) hit(`open:${q.split(":")[0]}`);
  return seen;
}
const everyItem = () => [
  ...plan.processes.map((p) => `processes:${p.id}`), ...plan.stack.map((t) => `stack:${t.tool}`),
  ...plan.threads.map((t) => `threads:${t.id}`), ...plan.boundaries.map((b) => `boundaries:${b.id}`),
  ...plan.policies.map((p) => `policies:${p.id}`), ...plan.open.map((q) => `open:${q.id}`),
];

test("plan check: the threads' verdicts, and a drifted thread names its missing step", () => {
  const v = Object.fromEntries(rec.findings.filter((f) => f.section === "threads").map((f) => [f.id, f.verdict]));
  assert.deepEqual(v, { "POST /readings": "realised", forecast_all: "drifted", "GET /forecasts": "not-built", render_dashboard: "not-built" });
  assert.deepEqual(rec.findings.find((f) => f.id === "forecast_all").missing, ["publish_forecast"]);
});

test("Plan view: every planned item is on the map exactly once, threads on their process with their verdict", () => {
  const m = planModel(plan, rec, { expanded: new Set([`${PLAN_ID}api`]) });
  const c = census(m);
  for (const k of everyItem()) assert.equal(c.get(k), 1, `${k} drawn ${c.get(k) ?? 0} times`);
  const api = m.nodes.find((n) => n.id === `${PLAN_ID}api`);
  assert.deepEqual(api.planFlows.map((f) => [f.id, f.verdict]), [["POST /readings", "realised"], ["GET /forecasts", "not-built"]]);
  assert.equal(api.planFlowsOpen, true);
  const fc = m.nodes.find((n) => n.id === `${PLAN_ID}forecaster`);
  assert.deepEqual(fc.planFlows[0].steps, [{ text: "insert_reading", missing: false }, { text: "publish_forecast", missing: true }]);
  assert.equal(fc.planFlowsOpen, false, "closed until its chip is clicked");
  assert.deepEqual(fc.planRules, ["p2: A forecast names the model version that made it"]);
  assert.deepEqual(m.nodes.find((n) => n.id === `${PLAN_ID}dashboard`).planQuestions, ["q1: Server-render the dashboard, or a static page polling the API?"]);
  const b1 = m.edges.find((e) => e.planBoundary === "b1");
  assert.deepEqual(b1.planCarries, ["pump_id", "reading", "at"]);
  assert.deepEqual(b1.planRules, ["p1: Only the API writes readings"]);
  assert.deepEqual(m.planUnplaced, { rules: [], questions: [], boundaries: [] });
  // An open box is taller by its threads; the router routes around that.
  assert.ok(cardHeight(api) > cardHeight({ ...api, planFlowsOpen: false }));
});

test("Overlay: realised items are marked on their real box ('planned ✓'), never drawn twice", () => {
  const m = overlayModel(derived, plan, rec, {});
  const c = census(m);
  for (const k of everyItem()) assert.equal(c.get(k), 1, `${k} drawn ${c.get(k) ?? 0} times`);
  const realApi = m.nodes.find((n) => n.plannedAs?.id === "api");
  assert.ok(realApi && !realApi.id.startsWith(PLAN_ID), "the api process is its real cluster");
  assert.equal(realApi.plannedAs.verdict, "realised");
  assert.deepEqual(realApi.planFlows.map((f) => f.id), ["POST /readings", "GET /forecasts"], "its threads moved to the real box");
  assert.ok(m.nodes.find((n) => n.plannedAs?.id === "sqlite3")?.id.startsWith("tool:"), "a realised tool marks the real tool box");
  assert.ok(!m.nodes.some((n) => n.id === `${PLAN_ID}api` || n.id === `${PLAN_ID}tool:sqlite3`), "no ghost beside a realised box");
  assert.ok(m.nodes.some((n) => n.id === `${PLAN_ID}dashboard`), "what is not built stays a ghost");
});

test("seed: groups read off the plan as a PENDING proposal — no model; what is not built is refused with its reason; gated", () => {
  const r = seedArchFromPlan(plan, rec, derived, emptyStore(), { project: "map_demo" });
  assert.equal(r.error, undefined, r.error);
  const p = r.store.proposal;
  assert.equal(p.model, "plan rev 4");
  const byId = Object.fromEntries(p.groups.map((g) => [g.id, g]));
  assert.equal(byId["plan-api"].kind, "process");
  assert.equal(byId["plan-forecaster"].kind, "process");
  assert.deepEqual(byId["plan-trust-project"].wraps.sort(), ["plan-api", "plan-forecaster"]);
  assert.ok(byId["plan-trust-outside"].wraps.some((w) => w.startsWith("tool:sqlite3")), "the db the plan names is outside");
  assert.ok(p.refused.some((x) => x.item === "process dashboard" && /nothing in the code to wrap/.test(x.reason)));
  assert.match(seedArchFromPlan(plan, rec, derived, r.store).error, /already pending/, "a pending proposal is not replaced");
  assert.match(seedArchFromPlan(plan, rec, derived, ratifyProposal(r.store)).error, /already ratified/, "ratified groups need --force");
  assert.equal(seedArchFromPlan(plan, rec, derived, ratifyProposal(r.store), { force: true }).error, undefined);

  // With the zones stated, a planned boundary across them says so.
  const zoned = applyArchStore(derived, ratifyProposal(r.store));
  const m = overlayModel(zoned, plan, rec, {});
  const b1 = m.edges.find((e) => e.planBoundary === "b1");
  assert.equal(b1.crossesTrust, "map_demo → Outside the project");
});

test("a realised item the real map draws no box for is drawn ONCE, chipped 'planned ✓' — it used to be drawn nowhere", () => {
  const R = "test/fixtures/plan/plan_demo";
  const env = buildPolyglotEnvelope(R, { skipSystem: true }).envelope;
  const st = buildStackIndex(env, R);
  const real = archModelForEnvelope(env, st, buildCrossingIndex(env), R, undefined, { applyStore: false });
  const p = loadPlan(R);
  const m = overlayModel(real, p, reconcilePlan(p, env, st, R), {});
  assert.ok(!real.nodes.some((n) => n.tool === "flask"), "a web framework is not a box on the real map");
  const flask = m.nodes.filter((n) => n.id === `${PLAN_ID}tool:flask`);
  assert.equal(flask.length, 1);
  assert.equal(flask[0].plannedAs.verdict, "realised");
});

test("`about` must name a planned item — a rule pinned to nothing would be drawn nowhere", () => {
  const bad = structuredClone(plan);
  bad.policies[0].about = "nowhere";
  assert.match(validatePlan(bad), /about "nowhere" names no planned process, thread, boundary, tool, store, zone \(store\/zone\) or module/);
  assert.equal(validatePlan(plan), null);
});
