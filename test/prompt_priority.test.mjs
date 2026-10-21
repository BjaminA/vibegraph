// WHAT A PROMPT GETS FIRST (2026-10-20, the live setup run's first hooked
// session): the prompt hook put the whole plan and five software specs in
// ahead of the task's own thread, and the thread was what the inline limit
// cut ("Also matched, not sent"). The routed threads now come first; the plan
// takes what is left (its objective line always kept room for) and waits for
// a later prompt when it does not fit; the specs follow only the threads
// actually given, and a spec that does not fit is named. A person stating the
// objective answers the question that asked for it.
//
//   npm run test:prompt-priority
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "../scripts/cli/hooks.mjs";
import { softwareForPrompt } from "../scripts/cli/software_context.mjs";
import { emptyPlan, savePlan } from "../src/server/plan_store.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { OBJECTIVE_QUESTION } from "../src/shared/plan_types.ts";
import { saveSpec } from "../src/server/software_store.ts";
import { loadEnvelope } from "../scripts/quality_check.mjs";

delete process.env.CLAUDECODE;
let base, root;
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-prio-"));
  root = join(base, "fleet");
  process.env.VG_CACHE_DIR = join(base, "cache");
  cpSync("examples/fleet-telemetry", root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  // a plan far too long for one prompt beside a thread's contract
  const why = "the operators' post-incident review asked for it, and every later change was measured against it, so it is kept here in full for whoever reads the plan next ".repeat(2).slice(0, 235);
  const saved = savePlan(root, { ...emptyPlan("Telemetry from the fleet reaches operators within a minute, paged once per incident"),
    policies: Array.from({ length: 10 }, (_, i) => ({ id: `p${i + 1}`, text: `Principle ${i + 1}: every reading is stored once, through the storage funnel, and paged at most once per incident window`, why, status: "agreed" })) });
  if (saved.error) throw new Error(`the test's plan did not save: ${saved.error}`);
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });
const hook = (input) => runHook("prompt", input, { absRoot: root, pipeline: {} });

test("the routed thread comes first; a plan that does not fit waits, its objective line kept", () => {
  const r = hook({ session_id: "s1", prompt: "make evaluate in telemetry/alerts.py page on region changes" });
  const ctx = r.json.hookSpecificOutput.additionalContext;
  assert.match(ctx, /Thread contract \(IR fact/, "the task's own thread is given");
  assert.match(ctx, /Plan objective \(rev \d+\): Telemetry from the fleet reaches operators/);
  assert.match(ctx, /The plan itself did not fit this prompt: `vibegraph-knowledge plan show`/);
  assert.doesNotMatch(ctx, /Principle 7:/, "not the plan's body");
  assert.ok(ctx.indexOf("Plan objective") < ctx.indexOf("### Thread"), "the objective still reads first");
  // a later prompt with room delivers the plan it held back
  const later = hook({ session_id: "s1", prompt: "thanks" });
  const ctx2 = later?.json?.hookSpecificOutput?.additionalContext ?? "";
  assert.match(ctx2, /Principle 7:/);
});

test("software specs: only what fits, the rest named; none for a thread not given", () => {
  const spec = { version: "1", tool: "sqlite3", role: "db", definition: "The standard library's SQLite driver.", definitionCite: null, status: "ratified",
    identity: { packages: ["sqlite3"], calls: ["connect"] }, operations: [{ name: "connect", does: "call", on: "a database file", cite: null }], states: [], permissions: [], rules: [], sources: [] };
  assert.equal(saveSpec(root, spec).error, undefined);
  const env = loadEnvelope(root, null, {}, { cache: true }).envelope;
  const ep = env.threads.find((t) => (t.filesReached ?? []).includes("telemetry/storage.py")).entryPointId;
  const held = softwareForPrompt(root, env, [ep], {}, 0);
  assert.match(held, /Software specs that also apply, not sent for length: sqlite3/);
  const state = {};
  assert.match(softwareForPrompt(root, env, [ep], state), /sqlite3/);
  assert.deepEqual(state.software, ["sqlite3"]);
  assert.equal(softwareForPrompt(root, env, [], {}), null, "no thread given, no spec");
});

test("stating the objective answers the question that asked for it", () => {
  const started = applyPlanOps(null, [{ op: "set-objective", text: "(not stated)" }, { op: "add", section: "open", item: { text: OBJECTIVE_QUESTION } }, { op: "add", section: "open", item: { text: "Proposed objective: Pages operators once per incident (cited: \"paged once\")" } }, { op: "add", section: "open", item: { text: "Which regions page?" } }], "human").plan;
  const set = applyPlanOps(started, [{ op: "set-objective", text: "Pages operators once per incident" }], "human");
  assert.deepEqual(set.plan.open.map((q) => q.id), ["q2", "q3"], "the question that asked is answered; a proposal waits for its own adoption, the rest stay");
  assert.match(set.changes.join("\n"), /answered by the objective: q1/);
  assert.deepEqual(set.plan.resolved.map((q) => [q.id, q.state, q.note]), [["q1", "closed", "answered: a person stated the objective"]], "closed on the record, not deleted");
  // the inbox's Adopt still closes the proposal with its own note
  const adopt = applyPlanOps(started, [{ op: "set-objective", text: "Pages operators once per incident" }, { op: "close-question", id: "q2", note: "adopted as the objective" }], "human");
  assert.equal(adopt.error, undefined);
  assert.equal(adopt.plan.resolved.find((q) => q.id === "q2").note, "adopted as the objective");
  // an agent's objective is still only a proposal, and answers nothing
  const agent = applyPlanOps(started, [{ op: "set-objective", text: "Something else" }], "agent");
  assert.equal(agent.plan.open.length, 4);
});
