// The proposal backlog (2026-10-01, Module 11 of the plan-architecture
// brief). On a copy of test/fixtures/plan/store_demo an AGENT changes an
// agreed process, adds a new tool, and proposes a change to a stated rule.
// Pinned: `plan review` is one page grouping every pending proposal — a new
// item in full, a change to an agreed item as a field diff against the
// version a person agreed to, the evidence for each, the command that decides
// it; `--agree/--reject` decides several at once (rejecting a change restores
// the agreed version, rejecting a new item drops it); only a person decides;
// the session-start hook gives the backlog count.
//
//   npm run test:plan-review
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { loadPlan, savePlan } from "../src/server/plan_store.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { planBacklog, formatBacklog, reviewOps, backlogCount } from "../src/server/plan_review.ts";
import { addConstraint, loadConstraints } from "../src/server/constraint_store.ts";
import { proposeConstraintEdit } from "../src/server/constraint_edit.ts";
import { runHook } from "../scripts/cli/hooks.mjs";

let base, root;
const cli = (args, env = {}) => {
  const e = { ...process.env, VG_CACHE_DIR: join(base, "cache"), ...env };
  if (!("CLAUDECODE" in env)) delete e.CLAUDECODE;
  return spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", ...args], { encoding: "utf-8", env: e });
};
before(() => {
  delete process.env.CLAUDECODE;
  base = mkdtempSync(join(tmpdir(), "vg-review-"));
  root = join(base, "store");
  process.env.VG_CACHE_DIR = join(base, "cache");
  cpSync("test/fixtures/plan/store_demo", root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  const r = applyPlanOps(loadPlan(root), [
    { op: "update", section: "processes", id: "decider", fields: { serves: "requests are decided within a second" } },
    { op: "add", section: "stack", item: { tool: "zod", role: "utility", why: "validate requests" } },
  ], "agent");
  assert.equal(r.error, undefined, r.error);
  assert.equal(savePlan(root, r.plan).error, undefined);
  const c = addConstraint(root, { kind: "invariant", text: "Verdicts are written only by the decider — two writers mean two truths", scope: { all: true } }, "human");
  assert.equal(proposeConstraintEdit(root, c.id, { text: "Verdicts and appeals are written only by the decider" }, { by: "agent", why: "a second family needs the same rule" }).error, undefined);
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

test("an agent's change to an agreed item keeps the agreed version, so the diff can be shown", () => {
  const d = loadPlan(root).processes.find((p) => p.id === "decider");
  assert.equal(d.status, "proposed");
  assert.equal(d.agreedAs.serves, "requests are decided");
  assert.equal(d.agreedAs.status, "agreed");
});

test("ACCEPTANCE: one page — every pending proposal, a diff or the item, its evidence, the command that decides it", () => {
  const b = planBacklog(loadPlan(root), null, loadConstraints(root));
  assert.equal(backlogCount(b), 3);
  const change = b.proposals.find((p) => p.id === "decider");
  assert.equal(change.kind, "change");
  assert.deepEqual(change.diff, [{ field: "serves", from: "requests are decided", to: "requests are decided within a second" }]);
  assert.equal(b.proposals.find((p) => p.id === "zod").kind, "new");
  const page = formatBacklog(b);
  assert.match(page, /### processes:decider — CHANGE to an agreed item\n- `serves`: "requests are decided" → "requests are decided within a second"/);
  assert.match(page, /### stack:zod — NEW/);
  assert.match(page, /rev \d+ \(agent\): update processes decider \(was agreed — back to proposed: an agent changed serves/);
  assert.match(page, /## Proposed changes to stated rules[\s\S]*c1 p1 \(by agent\): a second family needs the same rule/);
  const r = cli(["plan", "review", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /# Review — 3 proposals await a person/);
  assert.match(r.stdout, /plan check: realised/, "the plan-vs-code finding is the evidence");
});

test("the backlog count reaches the session-start hook", () => {
  const ctx = runHook("session-start", { session_id: "s", source: "startup" }, { absRoot: root, pipeline: {} })?.json?.hookSpecificOutput?.additionalContext ?? "";
  assert.match(ctx, /Review backlog: 3 proposals await a person — `vibegraph-knowledge plan review`/);
});

test("ACCEPTANCE: decided in one action — a rejected change restores the agreed version, an agreed new item stays", () => {
  assert.match(cli(["plan", "review", "--agree", "stack:zod", "--root", root], { CLAUDECODE: "1" }).stderr, /refused: `plan review --agree\/--reject`/, "only a person decides");
  assert.match(cli(["plan", "review", "--agree", "stack:nothing", "--root", root]).stdout + cli(["plan", "review", "--agree", "stack:nothing", "--root", root]).stderr, /stack:nothing is not a pending proposal/);
  const r = cli(["plan", "review", "--agree", "stack:zod", "--reject", "processes:decider", "--root", root]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const plan = loadPlan(root);
  const d = plan.processes.find((p) => p.id === "decider");
  assert.deepEqual([d.status, d.serves, d.agreedAs], ["agreed", "requests are decided", undefined]);
  assert.equal(plan.stack.find((t) => t.tool === "zod").status, "agreed");
  assert.equal(planBacklog(plan, null, []).proposals.length, 0);
  // Rejecting a NEW item drops it.
  const added = applyPlanOps(plan, [{ op: "add", section: "stack", item: { tool: "lodash", role: "utility" } }], "agent").plan;
  const ops = reviewOps(planBacklog(added, null, []), [], ["stack:lodash"]).ops;
  assert.equal(applyPlanOps(added, ops, "human").plan.stack.find((t) => t.tool === "lodash").status, "dropped");
});
