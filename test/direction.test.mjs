// Generic direction in the hook paradigm (2026-09-29, scripts/cli/direction.mjs):
// enabled per project in .vibegraph/skills.json, never whole — rule HEADLINES
// once per session where the skill applies (default), or only a rule's WHY
// when the check it is bound to fires ("on-violation"), or nothing ("off");
// the full rules on demand from `direction <skill>`.
//
//   npm run test:direction
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "../scripts/cli/hooks.mjs";
import { runDirection, applicability, shippedSkills } from "../scripts/cli/direction.mjs";
import { loadEnvelope } from "../scripts/quality_check.mjs";
// These tests act as a PERSON at the command line; a Claude Code terminal sets CLAUDECODE,
// which makes the CLI refuse a person's steps (scripts/cli/actor.mjs) — so it is cleared here.
delete process.env.CLAUDECODE;

let base, root;
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-direction-"));
  root = join(base, "fleet");
  process.env.VG_CACHE_DIR = join(base, "cache");
  cpSync("examples/fleet-telemetry", root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  git("init", "-q"); git("add", "-A"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

const hook = (event, input) => runHook(event, input, { absRoot: root, pipeline: {} });
const ctxOf = (r) => r?.json?.hookSpecificOutput?.additionalContext ?? "";
const INGEST = "make ingest_batch in telemetry/ingest.py log rejected readings";

test("off by default: nothing enabled, nothing sent", () => {
  assert.doesNotMatch(ctxOf(hook("prompt", { session_id: "none", prompt: INGEST })), /Generic direction/);
  assert.doesNotMatch(ctxOf(hook("session-start", { session_id: "none", source: "startup" })), /Generic direction enabled/);
});

test("enable / disable / mode are the CLI's, validated, written to skills.json", () => {
  assert.equal(runDirection(["enable", "no-such-skill", root]).exitCode, 1);
  assert.equal(runDirection(["hooks", "loud", root]).exitCode, 1);
  assert.equal(runDirection(["enable", "repetition-cost", root]).exitCode, 0);
  assert.equal(runDirection(["enable", "failure-visibility", root]).exitCode, 0);
  assert.equal(runDirection(["disable", "failure-visibility", root]).exitCode, 0);
  const cfg = JSON.parse(readFileSync(join(root, ".vibegraph", "skills.json"), "utf-8"));
  assert.deepEqual(cfg.enabled, ["repetition-cost"]);
  assert.equal(cfg.enabledBy["repetition-cost"].source, "human");
  const list = runDirection([root]).text;
  assert.match(list, /^\[on\] {2}repetition-cost \[drilled\] — applies to \d+ of \d+ threads; headlines \d+ chars, full \d+/m);
  assert.match(runDirection(["repetition-cost"]).text, /- \*\*No per-item external call inside a loop; batch at the funnel instead\.\*\*\n {2}why: /);
});

test("headlines: once per session, only where the skill applies, never the whole body", () => {
  const { envelope } = loadEnvelope(root, null, {});
  const applies = applicability(envelope, root, shippedSkills()).get("repetition-cost");
  assert.ok(applies.has("telemetry/ingest.py:ingest_batch"), "the ingest batch writes to the db");
  const start = ctxOf(hook("session-start", { session_id: "h", source: "startup" }));
  assert.match(start, /Generic direction enabled: repetition-cost — rule headlines arrive with a thread they apply to/);
  const first = ctxOf(hook("prompt", { session_id: "h", prompt: INGEST }));
  assert.match(first, /## Generic direction \(enabled in \.vibegraph\/skills\.json — advice, never a gate/);
  assert.match(first, /repetition-cost \[drilled\]:\n- Read the contract's round trips/);
  assert.doesNotMatch(first, /why: /, "headlines only");
  const block = first.slice(first.indexOf("## Generic direction"));
  assert.ok(block.split("\n## ")[0].length < 700, "a few hundred characters, not a 3.7 KB body");
  const again = ctxOf(hook("prompt", { session_id: "h", prompt: "and in telemetry/storage.py insert_readings" }));
  assert.doesNotMatch(again, /Generic direction/, "once per session");
});

test("on-violation: nothing up front; a fired check brings its rule's why, once", () => {
  runDirection(["hooks", "on-violation", root]);
  const f = JSON.parse(readFileSync(join(root, ".vibegraph", "constraints.json"), "utf-8"));
  f.constraints.push({ id: "c91", kind: "perf-lever", source: "human", createdAt: "2026-09-29T09:00:00.000Z",
    text: "No database round trip per reading in the ingest loop.", scope: { files: ["telemetry/ingest.py"] },
    check: { rule: "not-in-loop", role: "db" } });
  writeFileSync(join(root, ".vibegraph", "constraints.json"), JSON.stringify(f, null, 2));
  assert.doesNotMatch(ctxOf(hook("prompt", { session_id: "v", prompt: INGEST })), /## Generic direction/);

  const src = readFileSync(join(root, "telemetry/ingest.py"), "utf-8");
  writeFileSync(join(root, "telemetry/ingest.py"), src.replace(
    "        accepted.append(normalize_reading(raw, received_at=int(time.time())))",
    "        accepted.append(normalize_reading(raw, received_at=int(time.time())))\n        insert_readings([accepted[-1]])"));
  const blocked = hook("post-edit", { session_id: "v", tool_name: "Edit", tool_input: { file_path: join(root, "telemetry/ingest.py") } });
  assert.ok(blocked.block, "a new db call inside the loop blocks");
  assert.match(blocked.block, /Why, from the enabled generic direction:\n- \(repetition-cost, on not-in-loop\) No per-item external call inside a loop; batch at the funnel instead\. — why: /);
  const stop = hook("stop", { session_id: "v" });
  assert.ok(stop.block);
  assert.doesNotMatch(stop.block, /Why, from the enabled generic direction/, "the why is given once per rule per session");
  execFileSync("git", ["checkout", "-q", "--", "telemetry/ingest.py"], { cwd: root });
});

test("off: the hooks send nothing, not even on a finding", () => {
  runDirection(["hooks", "off", root]);
  assert.doesNotMatch(ctxOf(hook("session-start", { session_id: "o", source: "startup" })), /Generic direction enabled/);
  assert.doesNotMatch(ctxOf(hook("prompt", { session_id: "o", prompt: INGEST })), /Generic direction/);
});
