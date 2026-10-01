// Library vs deployable (2026-10-01, Module 5 of the plan-architecture
// brief). Fixture test/fixtures/plan/deploy_demo: a pure logic library
// (packages/rules, imported by NAME as `@acme/rules`), a runtime host script in
// another folder (hosts/rules-runner.ts) that runs it, and an API app that runs
// it too. Pinned: a process is a deployable (`entryPoints`, `uses` modules) and
// its files are its own plus its modules'; a library two processes use belongs
// to neither; a thread attaches to the process its entry point lives in, so no
// "threads the plan gives no process" card appears; and a workspace package
// imported by name is PROJECT code the linker follows.
//
//   npm run test:plan-modules
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan, validatePlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { processOwnership } from "../src/server/plan_modules.ts";
import { processFiles } from "../src/server/plan_reconcile.ts";
import { resolveWorkspaceTarget } from "../scripts/frontends/jsts/workspace.mjs";
import { formatPlanMd } from "../src/server/plan_render.ts";
import { planModel, PLAN_ID, UNOWNED_THREADS } from "../src/webview/system/arch_plan.ts";

const ROOT = "test/fixtures/plan/deploy_demo";
let env, stack, plan;
before(() => {
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  stack = buildStackIndex(env, ROOT);
  plan = loadPlan(ROOT);
});
const find = (rec, section, id) => rec.findings.find((f) => f.section === section && f.id === id);

test("a workspace package imported by name is project code: resolved, linked, not a dependency", () => {
  assert.equal(resolveWorkspaceTarget("@acme/rules", "apps/api/src/server.ts", ROOT), "packages/rules/src/index.ts");
  assert.equal(resolveWorkspaceTarget("@acme/nope", "apps/api/src/server.ts", ROOT), null);
  assert.equal(resolveWorkspaceTarget("express", "apps/api/src/server.ts", ROOT), null);
  assert.ok(!stack.tools.some((t) => t.tool === "@acme/rules"), "the project's own package is not a third-party tool");
  const thread = env.threads.find((t) => t.entryPointId === "hosts/rules-runner.ts:module");
  assert.ok(thread.nodes.some((n) => n.label === "score"), "the host's thread reaches score() inside the library");
});

test("ACCEPTANCE: the host script in one folder and the logic in another are ONE process using both", () => {
  const files = Object.keys(env.files);
  const own = processOwnership(plan, files, (p) => processFiles(p, files)?.files ?? null);
  assert.deepEqual(own.owned.get("rules-runner").sort(), ["hosts/rules-runner.ts", "packages/rules/src/index.ts"]);
  assert.deepEqual(own.owned.get("api").sort(), ["apps/api/src/server.ts", "packages/rules/src/index.ts"]);
  assert.equal(own.ownerOf.get("hosts/rules-runner.ts"), "rules-runner");
  assert.equal(own.ownerOf.get("packages/rules/src/index.ts"), undefined, "a library two processes use belongs to neither");
  const rec = reconcilePlan(plan, env, stack, ROOT);
  assert.equal(find(rec, "processes", "rules-runner").verdict, "realised");
  assert.match(find(rec, "processes", "rules-runner").detail, /1 of 1 entry point file\(s\) found; uses rules \(1 file\(s\)\)/);
  assert.deepEqual(find(rec, "processes", "rules-runner").entryPoints, ["hosts/rules-runner.ts:module"]);
  assert.match(find(rec, "modules", "rules").detail, /library\); used by rules-runner, api/);
});

test("ACCEPTANCE: a thread attaches to the process its entry point lives in — no orphan threads card", () => {
  const rec = reconcilePlan(plan, env, stack, ROOT);
  assert.equal(find(rec, "threads", "classify batch").verdict, "realised");
  assert.equal(find(rec, "threads", "classify batch").process, "rules-runner");
  assert.equal(find(rec, "threads", "GET /classify").process, "api");
  const m = planModel(plan, rec);
  assert.ok(!m.nodes.some((n) => n.id === UNOWNED_THREADS), "no 'threads the plan gives no process' card");
  const runner = m.nodes.find((n) => n.id === `${PLAN_ID}rules-runner`);
  assert.deepEqual(runner.planFlows.map((f) => f.id), ["classify batch"]);
  assert.match(runner.sublabel, /uses rules/);
  assert.match(formatPlanMd(plan, rec), /## Modules[\s\S]*\*\*rules\*\* \(library, agreed\) — Scoring rules; code at `packages\/rules`; used by rules-runner, api/);
});

test("validation: `uses` names a planned module; a module rename carries it; a plan with only `at` reads as before", () => {
  const bad = structuredClone(plan);
  bad.processes[0].uses = ["ghost"];
  assert.match(validatePlan(bad), /uses "ghost", which is not a planned module/);
  const r = applyPlanOps(plan, [{ op: "rename", section: "modules", from: "rules", to: "scoring" }], "human");
  assert.equal(r.error, undefined);
  assert.deepEqual(r.plan.processes.map((p) => p.uses), [["scoring"], ["scoring"]]);
  // Without entryPoints/uses, an `at` process reads exactly as it always did.
  const old = structuredClone(plan);
  delete old.modules;
  for (const p of old.processes) { delete p.uses; delete p.entryPoints; }
  old.processes[0].at = "hosts";
  const rec = reconcilePlan(old, env, stack, ROOT);
  assert.equal(find(rec, "processes", "rules-runner").detail, "1 file(s) under hosts, 1 entry point(s)");
});
