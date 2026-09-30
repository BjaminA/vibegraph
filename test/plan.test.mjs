// THE PLAN (2026-09-30): a hypothetical project kept apart from the real one.
// Pins the rules that make it a plan and not a second IR: the caps (refused,
// never trimmed), who may do what (an agent proposes; a person agrees and
// promotes), the old system-plan.json read and replaced, plan vs code on a
// fixture that realises part of its plan, planned rules as ADVICE until
// promoted, and the plan reaching a hooked session once, then as changes.
//
//   npm run test:plan
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan, savePlan, validatePlan, toSystemPlan, PLAN_FILE, LEGACY_PLAN_FILE } from "../src/server/plan_store.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { formatPlanMd, compactPlan } from "../src/server/plan_render.ts";
import { loadSystemPlan, persistSystemPlan } from "../src/server/system_plan.ts";
import { planToolEdit, planToolText } from "../src/server/plan_server.ts";
import { runPlan } from "../scripts/cli/plan.mjs";
import { runHook } from "../scripts/cli/hooks.mjs";
import { exportKnowledge } from "../scripts/export_knowledge.mjs";
// These tests act as a PERSON at the command line; a Claude Code terminal sets CLAUDECODE,
// which makes the CLI refuse a person's steps (scripts/cli/actor.mjs) — so it is cleared here.
delete process.env.CLAUDECODE;

const FIXTURE = "test/fixtures/plan/plan_demo";
let tmp, cache;
const copy = (name) => { const d = join(tmp, name); cpSync(FIXTURE, d, { recursive: true }); return d; };
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-plan-"));
  cache = mkdtempSync(join(tmpdir(), "vg-plan-cache-"));
  process.env.VG_CACHE_DIR = cache;
});
after(() => { rmSync(tmp, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

const start = (by = "human") => applyPlanOps(null, [{ op: "set-objective", text: "Operators see each pump's wear forecast within a minute" }], by).plan;

test("the caps are enforced — refused with the reason, never trimmed", () => {
  let plan = start();
  const ops = Array.from({ length: 8 }, (_, i) => ({ op: "add", section: "threads", item: { id: `t${i}`, entry: "route", serves: "x", primary: ["a"] } }));
  const r = applyPlanOps(plan, ops, "human");
  assert.match(r.error, /threads: 8 items, over the cap of 7/);
  const long = applyPlanOps(plan, [{ op: "add", section: "threads", item: { id: "t", entry: "route", serves: "x", primary: Array(9).fill("s") } }], "human");
  assert.match(long.error, /over the cap of 8 — primary steps only/);
  assert.match(validatePlan({ ...plan, objective: "x".repeat(300) }), /objective must be one line/);
  const noWhy = applyPlanOps(plan, [{ op: "add", section: "policies", item: { text: "no reason" } }], "human");
  assert.match(noWhy.error, /why is required/);
});

test("an agent proposes; a person agrees — and an agreement an agent edits is proposed again", () => {
  let plan = start();
  const add = applyPlanOps(plan, [{ op: "add", section: "processes", item: { id: "api", kind: "backend", label: "API", serves: "within a minute", status: "agreed" } }], "agent");
  assert.equal(add.plan.processes[0].status, "proposed", "an agent's item lands proposed, whatever it asked for");
  assert.match(applyPlanOps(add.plan, [{ op: "agree", section: "processes", id: "api" }], "agent").error, /only a person agrees/);
  const agreed = applyPlanOps(add.plan, [{ op: "agree", section: "processes", id: "api" }], "human").plan;
  assert.equal(agreed.processes[0].status, "agreed");
  const edited = applyPlanOps(agreed, [{ op: "update", section: "processes", id: "api", fields: { at: "api/" } }], "agent");
  assert.equal(edited.plan.processes[0].status, "proposed");
  assert.match(edited.changes[0], /was agreed — back to proposed/);
  assert.match(applyPlanOps(agreed, [{ op: "update", section: "processes", id: "api", fields: { status: "agreed" } }], "agent").error, /cannot set a status/);
  assert.match(applyPlanOps(agreed, [{ op: "close" }], "agent").error, /only a person closes/);
  // A batch is whole or nothing: the bad op refuses the good one before it.
  const batch = applyPlanOps(agreed, [{ op: "add", section: "stack", item: { tool: "flask", role: "web-framework" } }, { op: "drop", section: "stack", id: "nope" }], "human");
  assert.ok(batch.error && !batch.plan);
  assert.deepEqual(edited.plan.changelog.map((c) => c.rev), [1, 2, 3, 4]);
});

test("the objective is a person's: an agent's new objective waits as a question; an agent cannot start a plan", () => {
  assert.match(applyPlanOps(null, [{ op: "set-objective", text: "Something else" }], "agent").error, /a person starts a plan with its objective/);
  const plan = start();
  const r = applyPlanOps(plan, [{ op: "set-objective", text: "Operators see every pump's wear forecast within five seconds" }], "agent");
  assert.equal(r.plan.objective, plan.objective, "unchanged");
  assert.deepEqual(r.plan.open, [{ id: "q1", text: "Proposed objective: Operators see every pump's wear forecast within five seconds" }]);
  assert.match(r.changes[0], /proposed a new objective as q1 \(only a person changes it\)/);
  // The person adopts it: the objective changes and the question goes, together.
  const adopted = applyPlanOps(r.plan, [{ op: "set-objective", text: "Operators see every pump's wear forecast within five seconds" }, { op: "drop", section: "open", id: "q1" }], "human").plan;
  assert.equal(adopted.objective, "Operators see every pump's wear forecast within five seconds");
  assert.equal(adopted.open.length, 0);
});

test("staying on the objective: an item whose `serves` shares no word with it is flagged, as a guess", () => {
  const env = buildPolyglotEnvelope(FIXTURE, { skipSystem: true }).envelope;
  const plan = loadPlan(FIXTURE);
  assert.deepEqual(reconcilePlan(plan, env, buildStackIndex(env, FIXTURE), FIXTURE).offObjective, [], "every fixture item names part of the objective");
  const drifted = applyPlanOps(plan, [{ op: "add", section: "threads", item: { id: "GET /invoices", entry: "route", serves: "billing reports for finance", primary: ["render_invoice"] } }], "agent").plan;
  const rec = reconcilePlan(drifted, env, buildStackIndex(env, FIXTURE), FIXTURE);
  assert.deepEqual(rec.offObjective, [{ section: "threads", id: "GET /invoices", serves: "billing reports for finance" }]);
  assert.match(formatPlanMd(drifted, rec), /## Possibly off the objective \(a word-match guess\)[\s\S]*Words are not meaning/);
});

test("the old system-plan.json is read, and replaced by plan.json on the next save (its extra sections kept)", () => {
  const root = join(tmp, "legacy");
  mkdirSync(join(root, ".vibegraph"), { recursive: true });
  const sp = { version: "1", description: "A flask API that stores readings. Also a cache.", drafted: true,
    subsystems: [{ id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" }, { id: "db", kind: "db", label: "SQLite", groundedIn: null }],
    edges: [{ from: "backend", to: "db", groundedIn: null }] };
  writeFileSync(join(root, LEGACY_PLAN_FILE), JSON.stringify(sp));
  const read = loadPlan(root);
  assert.equal(read.objective, "A flask API that stores readings.", "the first sentence is the objective; the description is kept whole");
  assert.equal(loadSystemPlan(root).subsystems.length, 2, "the greenfield flow reads it as before");
  // A thread added to the plan survives a greenfield re-acceptance.
  const withThread = applyPlanOps(read, [{ op: "add", section: "threads", item: { id: "POST /x", entry: "route", serves: "stores readings", primary: ["store"] } }], "human").plan;
  assert.equal(savePlan(root, withThread).error, undefined);
  assert.equal(existsSync(join(root, LEGACY_PLAN_FILE)), false, "one source of truth");
  const r = persistSystemPlan(root, { ...sp, subsystems: [sp.subsystems[0]], edges: [] });
  assert.equal(r.error, undefined);
  const after = loadPlan(root);
  assert.equal(after.threads.length, 1);
  assert.equal(after.processes.find((p) => p.id === "db").status, "dropped", "a subsystem the accepted plan no longer lists is dropped, not deleted");
  assert.equal(after.boundaries[0].status, "dropped");
  assert.equal(toSystemPlan(after).subsystems.length, 1);
});

test("plan vs code on a project that realises part of its plan", () => {
  const env = buildPolyglotEnvelope(FIXTURE, { skipSystem: true }).envelope;
  const plan = loadPlan(FIXTURE);
  const rec = reconcilePlan(plan, env, buildStackIndex(env, FIXTURE), FIXTURE);
  const v = Object.fromEntries(rec.findings.map((f) => [`${f.section}:${f.id}`, f.verdict]));
  assert.deepEqual(v, {
    "processes:api": "realised", "processes:forecaster": "realised", "processes:dashboard": "not-built",
    "stack:flask": "realised", "stack:sqlite3": "realised", "stack:postgres": "drifted", "stack:redis": "not-built",
    "boundaries:b1": "realised", "boundaries:b2": "drifted", "boundaries:b3": "not-built",
    "threads:POST /readings": "realised", "threads:forecast_all": "drifted", "threads:GET /forecasts": "not-built",
    "policies:p1": "violated", "policies:p2": "prose",
  });
  const detail = (k) => rec.findings.find((f) => `${f.section}:${f.id}` === k).detail;
  assert.match(detail("stack:postgres"), /for db the code uses sqlite3/);
  assert.match(detail("threads:forecast_all"), /not found on its thread: publish_forecast/);
  assert.match(detail("policies:p1"), /worker\/forecast\.py.*advice — a planned rule blocks nothing/);
  assert.equal(rec.findings.find((f) => f.id === "POST /readings").entryPointId, "api/app.py:post_readings");
  const md = formatPlanMd(plan, rec);
  assert.match(md, /^# Plan — revision 3\n\n> HYPOTHETICAL — a plan, not the code/);
  assert.match(md, /the ORDER of a thread's steps is not compared/);
});

test("promote: the one door into constraints.json — a person's, and then the rule is checked for real", () => {
  const root = copy("promote");
  assert.match(runPlan(["promote", "p1", "--root", root, "--as", "agent"]).text, /only a person promotes/);
  const r = runPlan(["promote", "p1", "--root", root]);
  assert.equal(r.exitCode, 0, r.text);
  assert.match(r.text, /promoted p1 → c1/);
  const c = JSON.parse(readFileSync(join(root, ".vibegraph", "constraints.json"), "utf-8"));
  assert.equal(c.constraints?.[0]?.source ?? c[0]?.source ?? c.list?.[0]?.source, "human");
  assert.equal(loadPlan(root).policies[0].status, "promoted");
  assert.match(runPlan(["promote", "p1", "--root", root]).text, /already c1/);
});

test("the CLI and the MCP door: a person's edits, and a model's proposals", () => {
  const root = copy("cli");
  const check = runPlan(["check", "--root", root]);
  assert.equal(check.exitCode, 0, "plan vs code is advice: it never fails a run");
  assert.match(check.text, /\*\*violated\*\*/);
  const mcp = planToolEdit(root, [{ op: "add", section: "stack", item: { tool: "redis-py", role: "cache" } }]);
  assert.match(mcp.text, /recorded as PROPOSED/);
  assert.match(planToolEdit(root, [{ op: "agree", section: "stack", id: "redis-py" }]).error, /only a person agrees/);
  assert.match(runPlan(["agree", "stack", "redis-py", "--root", root]).text, /agree stack redis-py/);
  assert.match(planToolText(root, null, null), /\*\*redis-py\*\* as cache \(agreed\)/);
  assert.match(runPlan(["edit", "{\"op\":\"nope\"}", "--root", root]).text, /op must be one of/);
});

test("a hooked session gets the plan once, then only what changed — never while it is closed", () => {
  const root = copy("hook");
  execFileSync("git", ["init", "-q"], { cwd: root });
  const hook = (prompt) => runHook("prompt", { session_id: "p", prompt }, { absRoot: root, pipeline: {} });
  const ctx = (r) => r?.json?.hookSpecificOutput?.additionalContext ?? "";
  const first = ctx(hook("what should we build next for the forecaster?"));
  assert.match(first, /## Plan in progress \(rev 3\) — HYPOTHETICAL/);
  assert.match(first, /Objective: Operators see every pump's wear forecast/);
  assert.match(first, /Thread POST \/readings: validate → b1:insert → insert_reading/);
  const second = ctx(hook("and the dashboard, what about it?"));
  assert.doesNotMatch(second, /Plan in progress|The plan changed/, "the full plan once per session");
  assert.match(second, /Plan objective \(rev 3; 6 items proposed, 1 open question\): Operators see every pump's wear forecast within a minute of a reading — keep this work on it\./, "the objective on every prompt, in one line");
  runPlan(["drop", "stack", "redis", "--root", root]);
  const changed = ctx(hook("ok, next step for the dashboard please"));
  assert.match(changed, /## The plan changed \(rev 3 → 4\)/);
  assert.match(changed, /Changed: drop stack redis \(human\)/);
  runPlan(["close", "--root", root]);
  assert.doesNotMatch(ctx(runHook("prompt", { session_id: "q", prompt: "a new session asks about the forecaster" }, { absRoot: root, pipeline: {} })), /Plan in progress/);
  assert.ok(compactPlan(loadPlan(root)).length < 2500, "compact by construction");
});

test("the export writes design.md, labelled a plan, beside --task's plan.md (never over it)", () => {
  const out = join(tmp, "export");
  exportKnowledge({ root: FIXTURE, out, commit: "t", task: "change insert_reading in api/store.py" });
  assert.match(readFileSync(join(out, "design.md"), "utf-8"), /HYPOTHETICAL — a plan, not the code/);
  assert.doesNotMatch(readFileSync(join(out, "plan.md"), "utf-8"), /HYPOTHETICAL/, "the task plan is its own file");
  assert.match(readFileSync(join(out, "README.md"), "utf-8"), /\*\*The design plan:\*\* `design\.md` — a HYPOTHETICAL design \(revision 3\)/);
  assert.equal(existsSync(join(FIXTURE, PLAN_FILE)), true);
});
