// Two things the hooks did not carry (2026-09-29):
//   1. a STACK POLICY with no `check` clause was prose — now its forbid /
//      replace-with is checked (src/server/policy_check.ts), never twinned
//      with an import-only clause that already names the tool;
//   2. `.vibegraph/architecture.json` never reached a session — now a routed
//      thread's stated placement and the primary path arrive with it
//      (scripts/cli/arch_context.mjs), once each, never repeating a rule.
//
//   npm run test:hooks-arch-policy
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "../scripts/cli/hooks.mjs";
import { runConstraintChecks } from "../scripts/cli/check.mjs";
import { archPlacement } from "../scripts/cli/arch_context.mjs";
import { derivedPolicyClauses, moduleFileOf } from "../src/server/policy_check.ts";
import { loadEnvelope } from "../scripts/quality_check.mjs";

let base, root;
const EP = "telemetry/alerts.py:evaluate";
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-arch-policy-"));
  root = join(base, "fleet");
  process.env.VG_CACHE_DIR = join(base, "cache");
  cpSync("examples/fleet-telemetry", root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  git("init", "-q"); git("add", "-A"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

const hook = (event, input) => runHook(event, input, { absRoot: root, pipeline: {} });
const constraintsPath = () => join(root, ".vibegraph", "constraints.json");
const addConstraint = (c) => {
  const f = JSON.parse(readFileSync(constraintsPath(), "utf-8"));
  f.constraints.push({ source: "human", createdAt: "2026-09-29T09:00:00.000Z", scope: { all: true }, ...c });
  writeFileSync(constraintsPath(), JSON.stringify(f, null, 2));
};

test("derivation: forbid and replace-with become checks; an import-only already naming the tool gets no twin", () => {
  const { envelope } = loadEnvelope(root, null, {});
  assert.equal(moduleFileOf(envelope.files, "telemetry.http_client"), "telemetry/http_client.py");
  assert.deepEqual(derivedPolicyClauses({ policy: { tool: "httpx", rule: "forbid" } }, envelope.files),
    [{ rule: "stack-policy", policy: "forbid", tool: "httpx", allowed: [] }]);
  const c1 = JSON.parse(readFileSync(constraintsPath(), "utf-8")).constraints.find((c) => c.id === "c1");
  assert.equal(c1.policy.rule, "replace-with");
  assert.deepEqual(derivedPolicyClauses(c1, envelope.files), [], "c1 already states import-only for requests");
  const bare = { ...c1, check: undefined };
  assert.deepEqual(derivedPolicyClauses(bare, envelope.files)[0].allowed, ["telemetry/http_client.py"]);
  assert.equal(derivedPolicyClauses({ policy: { tool: "requests", rule: "prefer" } }, envelope.files).length, 0, "prefer is advice");
  assert.equal(derivedPolicyClauses({ policy: { tool: "requests", rule: "replace-with", with: "telemetry.nowhere" } }, envelope.files)[0].unresolvedWith, true);
});

test("a policy with no check clause is enforced: forbid passes clean, and a new import blocks the edit", () => {
  addConstraint({ id: "c90", kind: "stack-policy", text: "Never use httpx here; the egress proxy only speaks to requests.",
    policy: { tool: "httpx", rule: "forbid", reason: "egress proxy" } });
  const r = runConstraintChecks({ root, uncommitted: true, commit: "t" });
  const row = r.results.find((x) => x.id === "c90");
  assert.equal(row.verdict, "pass");
  assert.equal(row.rule, "stack-policy");
  assert.ok(!r.unchecked.includes("c90"));

  const start = hook("session-start", { session_id: "p", source: "startup" });
  assert.match(start.json.hookSpecificOutput.additionalContext, /\[c90 · stack-policy\][^\n]*\(checked: policy forbid\)/);
  hook("prompt", { session_id: "p", prompt: "tidy telemetry/alerts.py evaluate" }); // baseline
  appendFileSync(join(root, "telemetry/alerts.py"), "\n\nimport httpx\n");
  const blocked = hook("post-edit", { session_id: "p", tool_name: "Edit", tool_input: { file_path: join(root, "telemetry/alerts.py") } });
  assert.ok(blocked.block, "a new forbidden import blocks");
  assert.match(blocked.block, /c90[\s\S]*httpx is forbidden by a stated policy|`httpx` is forbidden by a stated policy/);
  execFileSync("git", ["checkout", "-q", "--", "telemetry/alerts.py"], { cwd: root });
});

test("architecture: a routed thread's stated placement arrives once; notes a rule already says are not repeated", () => {
  const { envelope } = loadEnvelope(root, null, {});
  const cluster = archPlacement(envelope, root).get(EP)?.[0];
  assert.ok(cluster, "the evaluate thread belongs to a derived process");
  writeFileSync(join(root, ".vibegraph", "architecture.json"), JSON.stringify({
    version: "1",
    groups: [
      { id: "vpc", kind: "network", label: "ops VPC", wraps: [], note: "no inbound from the internet" },
      { id: "worker-host", kind: "host", label: "alerts worker", wraps: [cluster.id], parent: "vpc", note: "the egress proxy only speaks to requests" },
    ],
    names: { [cluster.id]: "Telemetry service" },
    primaryPath: ["telemetry/app.py:ingest_route", EP],
  }, null, 2));

  const first = hook("prompt", { session_id: "arch", prompt: "make evaluate in telemetry/alerts.py page on region changes" }).json.hookSpecificOutput.additionalContext;
  assert.match(first, /## Where it runs \(from \.vibegraph\/architecture\.json, stated by a person\)/);
  assert.match(first, /Runs in \(stated\): network "ops VPC" › host "alerts worker" — process "Telemetry service"\./);
  assert.match(first, /network "ops VPC": no inbound from the internet/);
  assert.doesNotMatch(first, /host "alerts worker": the egress proxy/, "the host note restates c90, a rule sent beside it");
  // Other threads in the same place get the short form, not the chain again.
  assert.equal((first.match(/network "ops VPC" › host "alerts worker"/g) ?? []).length, 1);
  assert.match(first, /Runs in \(stated\): host "alerts worker" \(placement given above\)\./);
  assert.match(first, /On the stated primary path \(step 2 of 2\): telemetry\/app\.py:ingest_route → telemetry\/alerts\.py:evaluate\./);

  const again = hook("prompt", { session_id: "arch", prompt: "and keep evaluate in telemetry/alerts.py simple" });
  assert.doesNotMatch(again?.json?.hookSpecificOutput?.additionalContext ?? "", /Where it runs/, "once per session");
});

test("architecture: nothing stated, nothing sent (and no model built)", () => {
  rmSync(join(root, ".vibegraph", "architecture.json"));
  const r = hook("prompt", { session_id: "none", prompt: "make evaluate in telemetry/alerts.py page on region changes" });
  assert.doesNotMatch(r.json.hookSpecificOutput.additionalContext, /Where it runs/);
});
