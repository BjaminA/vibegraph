// Zones inside a store (2026-10-01, Module 2 of the plan-architecture
// brief). Fixture test/fixtures/plan/store_demo: the store `docs` has three
// zones — `requests` and `verdicts` named as literals by the client's access
// calls (`writeDoc("requests", "request", …)`), and `archive` routed by a
// function the plan names but the code does not have yet. Pinned: a zone is
// realised only where the code's routing NAMES it; a computed zone is
// unverified, never a pass; a boundary that names a zone is checked against
// its own process's access sites (a real drift when they name another zone);
// the map draws zones as sub-boxes of the store and a write edge lands on its
// zone.
//
//   npm run test:plan-zones
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { storeAccessSites, literalOf, enclosingName } from "../src/server/store_access.ts";
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

test("access sites: calls to the store's access functions, with the zone their literals name", () => {
  const sites = storeAccessSites(plan.stores[0], env.files);
  const pretty = sites.map((s) => `${s.file}:${s.fn}:${s.op}:${s.zone}`).sort();
  assert.deepEqual(pretty, [
    "apps/decider/src/main.ts:module:watch:requests",
    "apps/decider/src/main.ts:onRequest:write:verdicts",
    "apps/requester/src/main.ts:module:watch:verdicts",
    "apps/requester/src/main.ts:submit:write:requests",
  ]);
  assert.equal(literalOf('"a"'), "a");
  assert.equal(literalOf("`x-${id}`"), null, "a template with a substitution is computed");
  assert.equal(enclosingName("module/Writer.class/save.fn/put.call"), "Writer.save");
  assert.equal(enclosingName("module/put.call"), "module");
});

test("a zone is realised where the routing names it; a missing router is not built", () => {
  const rec = reconcilePlan(plan, env, stack, ROOT);
  assert.equal(find(rec, "stores", "docs/requests").verdict, "realised");
  assert.match(find(rec, "stores", "docs/requests").detail, /apps\/requester\/src\/main\.ts:6 submit writes/);
  assert.equal(find(rec, "stores", "docs/verdicts").verdict, "realised");
  assert.equal(find(rec, "stores", "docs/archive").verdict, "not-built");
  assert.match(find(rec, "stores", "docs/archive").detail, /no function archiveZone/);
});

test("a computed zone is unverified, never a pass; no access functions → unanchored", () => {
  const p = structuredClone(plan);
  p.stores[0].zones.push({ id: "drafts", holds: ["draft"] });
  // Point the access list at a call whose zone is a variable: conn.push(zone, …) in the client.
  p.stores[0].access = { write: ["conn.push"] };
  const rec = reconcilePlan(p, env, stack, ROOT);
  assert.equal(find(rec, "stores", "docs/drafts").verdict, "unverified");
  assert.match(find(rec, "stores", "docs/drafts").detail, /compute their zone/);
  delete p.stores[0].access;
  assert.equal(find(reconcilePlan(p, env, stack, ROOT), "stores", "docs/requests").verdict, "unanchored");
});

test("a boundary naming a zone: realised at its own write, a drift when its process writes another zone", () => {
  const rec = reconcilePlan(plan, env, stack, ROOT);
  assert.equal(find(rec, "boundaries", "b1").verdict, "realised");
  assert.match(find(rec, "boundaries", "b1").detail, /requester touches docs\/requests at apps\/requester\/src\/main\.ts:6/);
  const p = structuredClone(plan);
  p.boundaries[0].zone = "archive"; // the requester never names the archive zone
  const drift = find(reconcilePlan(p, env, stack, ROOT), "boundaries", "b1");
  assert.equal(drift.verdict, "drifted");
  assert.match(drift.detail, /touches docs\/requests, verdicts, not archive|touches docs\/verdicts, requests, not archive/);
});

test("the view: zones are sub-boxes of the store, and a write edge lands on its zone", () => {
  const rec = reconcilePlan(plan, env, stack, ROOT);
  const m = planModel(plan, rec);
  const group = m.groups.find((g) => g.id === `${PLAN_ID}storegroup:docs`);
  assert.ok(group, "a group box for the store");
  assert.deepEqual(group.wraps, [`${PLAN_ID}store:docs`, `${PLAN_ID}zone:docs/requests`, `${PLAN_ID}zone:docs/verdicts`, `${PLAN_ID}zone:docs/archive`]);
  assert.equal(m.edges.find((e) => e.planBoundary === "b1").to, `${PLAN_ID}zone:docs/requests`);
  assert.equal(m.edges.find((e) => e.planBoundary === "b2").to, `${PLAN_ID}zone:docs/verdicts`);
  assert.match(m.nodes.find((n) => n.id === `${PLAN_ID}zone:docs/archive`).sublabel, /zone · archived-\* · not-built/);
  assert.match(formatPlanMd(plan, rec), /zone \*\*requests\*\* holds request;[^\n]* — \*\*realised\*\*/);
});
