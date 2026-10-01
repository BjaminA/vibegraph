// Rename safety and change impact (2026-10-01, Module 9 of the plan-
// architecture brief). On a git copy of test/fixtures/plan/deploy_demo the
// library's `score` — step 2 of the planned thread "classify batch" — is
// renamed to `rate`. Pinned: `plan affected` names what the change touches and
// the name now GONE (defined at HEAD, nowhere now); the post-edit hook says it
// in the same turn; one `rename-symbol` op updates every reference and the
// thread reads realised again.
//
//   npm run test:plan-affected
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { planAffected, planNamedRefs } from "../src/server/plan_affected.ts";
import { headText } from "../scripts/cli/head_text.mjs";
import { runHook } from "../scripts/cli/hooks.mjs";

let base, root;
const LIB = "packages/rules/src/index.ts";
before(() => {
  delete process.env.CLAUDECODE;
  base = mkdtempSync(join(tmpdir(), "vg-affected-"));
  root = join(base, "deploy");
  process.env.VG_CACHE_DIR = join(base, "cache");
  cpSync("test/fixtures/plan/deploy_demo", root, { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  git("init", "-q"); git("add", "-A"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
  // The rename: score → rate, definition and use.
  writeFileSync(join(root, LIB), readFileSync(join(root, LIB), "utf-8").replace(/\bscore\b/g, "rate"));
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

test("the plan's named references: steps, entry points, routers, access functions, rule targets", () => {
  const refs = planNamedRefs(loadPlan("test/fixtures/plan/store_demo")).map((r) => `${r.kind}:${r.name}@${r.where}`);
  assert.ok(refs.includes("function:writeDoc@stores docs access.write"));
  assert.ok(refs.includes("function:archiveZone@stores docs/archive router"));
  const auth = planNamedRefs(loadPlan("test/fixtures/plan/authority_demo")).map((r) => `${r.name}@${r.where}`);
  assert.ok(auth.includes("appendAudit@policies p3 with"));
  assert.ok(!auth.some((r) => r.startsWith("decider@")), "a process id in `by` is not a function");
  const dep = planNamedRefs(loadPlan("test/fixtures/plan/deploy_demo")).map((r) => `${r.kind}:${r.name}@${r.where}`);
  assert.ok(dep.includes("file:hosts/rules-runner.ts@processes rules-runner entryPoints"));
});

test("ACCEPTANCE: `plan affected` names what the diff touches and the name now gone", () => {
  const env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  const impact = planAffected(loadPlan(root), env.files, [LIB], (f) => headText(root, f));
  assert.deepEqual(impact.gone.map((g) => `${g.name}@${g.where}@${g.file}`), [`score@threads classify batch step 2@${LIB}`]);
  assert.ok(impact.touched.some((t) => t.name === "classify" && t.where === "threads classify batch step 1"));
  // From the command line, the working tree is the change.
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", "plan", "affected", "--uncommitted", "--root", root], { encoding: "utf-8", env: { ...process.env } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /GONE[\s\S]*score \(threads classify batch step 2; was in packages\/rules\/src\/index\.ts\) — if renamed: plan edit '\{"op":"rename-symbol","from":"score","to":"<new name>"\}'/);
});

test("ACCEPTANCE: the post-edit hook says it in the same turn, once", () => {
  const out = (s) => runHook("post-edit", { session_id: s, tool_name: "Edit", tool_input: { file_path: join(root, LIB) } }, { absRoot: root, pipeline: {} });
  runHook("prompt", { session_id: "h", prompt: "rename score in packages/rules/src/index.ts" }, { absRoot: root, pipeline: {} });
  const first = out("h")?.json?.hookSpecificOutput?.additionalContext ?? "";
  assert.match(first, /The plan names `score` \(threads classify batch step 2\), which this edit removed from packages\/rules\/src\/index\.ts/);
  assert.match(first, /"op":"rename-symbol","from":"score"/);
  assert.doesNotMatch(out("h")?.json?.hookSpecificOutput?.additionalContext ?? "", /The plan names `score`/, "once per session");
});

test("ACCEPTANCE: one rename-symbol op updates every reference, and the thread reads realised again", () => {
  const env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  const stack = buildStackIndex(env, root);
  const before = reconcilePlan(loadPlan(root), env, stack, root).findings.find((f) => f.id === "classify batch");
  assert.equal(before.verdict, "drifted");
  const r = applyPlanOps(loadPlan(root), [{ op: "rename-symbol", from: "score", to: "rate" }], "human");
  assert.equal(r.error, undefined);
  assert.match(r.changes[0], /rename function score → rate in the plan \(1 reference updated\)/);
  assert.deepEqual(r.plan.threads[0].primary, ["classify", "rate"]);
  assert.equal(reconcilePlan(r.plan, env, stack, root).findings.find((f) => f.id === "classify batch").verdict, "realised");
  assert.match(applyPlanOps(loadPlan(root), [{ op: "rename-symbol", from: "nothing", to: "x" }], "human").error, /names no function "nothing"/);
});
