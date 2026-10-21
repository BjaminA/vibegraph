// Generic direction in the hook paradigm (2026-09-29, scripts/cli/direction.mjs):
// per skill in .vibegraph/skills.json, never whole. Two switches per skill
// (2026-10-20): told UP FRONT (rule headlines once per session where the skill
// applies) and/or explained WHEN BROKEN (a rule's why when the check it is
// bound to fires); the legacy page-wide modes still set every skill at once;
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
  assert.doesNotMatch(ctxOf(hook("session-start", { session_id: "none", source: "startup" })), /Generic direction in use/);
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
  assert.match(list, /^\[up front \+ when broken\] repetition-cost \[drilled\] — applies to \d+ of \d+ threads; headlines \d+ chars, full \d+/m);
  assert.match(list, /^\[off\] failure-visibility/m);
  assert.deepEqual(cfg.delivery, { "repetition-cost": { upfront: true, onCheck: true } }, "enable is both switches");
  assert.match(runDirection(["repetition-cost"]).text, /- \*\*No per-item external call inside a loop; batch at the funnel instead\.\*\*\n {2}why: /);
});

test("headlines: once per session, only where the skill applies, never the whole body", () => {
  const { envelope } = loadEnvelope(root, null, {});
  const applies = applicability(envelope, root, shippedSkills()).get("repetition-cost");
  assert.ok(applies.has("telemetry/ingest.py:ingest_batch"), "the ingest batch writes to the db");
  const start = ctxOf(hook("session-start", { session_id: "h", source: "startup" }));
  assert.match(start, /Generic direction in use: repetition-cost — rule headlines arrive with a thread they apply to; repetition-cost — a rule's why arrives when an edit breaks its check/);
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
  assert.doesNotMatch(ctxOf(hook("session-start", { session_id: "o", source: "startup" })), /Generic direction in use/);
  assert.doesNotMatch(ctxOf(hook("prompt", { session_id: "o", prompt: INGEST })), /Generic direction/);
});

// 2026-10-16 (review): a compaction emptied the session's context but kept the
// direction / architecture / Brief "already sent" records, so they were never sent again.
test("a compaction forgets every delivery record, and keeps the bookkeeping", async () => {
  const { DELIVERY_KEYS } = await import("../scripts/cli/hooks.mjs");
  for (const k of ["direction", "arch", "briefSent", "gapsSent", "briefTouched", "planGoneSent", "contracts", "rules"]) assert.ok(DELIVERY_KEYS.includes(k), k);
  for (const k of ["baseline", "stopBlocks", "pendingBlocks", "lastKeys"]) assert.ok(!DELIVERY_KEYS.includes(k), `${k} is bookkeeping`);
  // both switches off (the legacy "off" above) means not in use: turn it back on
  assert.equal(runDirection(["enable", "repetition-cost", root]).exitCode, 0);
  assert.match(ctxOf(hook("prompt", { session_id: "k", prompt: INGEST })), /## Generic direction/);
  assert.doesNotMatch(ctxOf(hook("prompt", { session_id: "k", prompt: INGEST })), /## Generic direction/, "once per session");
  hook("session-start", { session_id: "k", source: "compact" });
  assert.match(ctxOf(hook("prompt", { session_id: "k", prompt: INGEST })), /## Generic direction/, "after a compaction it is sent again");
});

test("2026-10-20: the two switches, one at a time — up front without the why, then neither", () => {
  assert.equal(runDirection(["set", "repetition-cost", "--up-front", "maybe", root]).exitCode, 2);
  assert.equal(runDirection(["set", "repetition-cost", root]).exitCode, 2, "say what to change");
  assert.equal(runDirection(["set", "no-such-skill", "--up-front", "on", root]).exitCode, 1);
  // up front only: the headlines arrive, a broken check brings no why
  assert.equal(runDirection(["set", "repetition-cost", "--up-front", "on", "--when-broken", "off", root]).exitCode, 0);
  const cfg = JSON.parse(readFileSync(join(root, ".vibegraph", "skills.json"), "utf-8"));
  assert.deepEqual(cfg.delivery["repetition-cost"], { upfront: true, onCheck: false });
  assert.match(ctxOf(hook("prompt", { session_id: "u", prompt: INGEST })), /## Generic direction/);
  const src = readFileSync(join(root, "telemetry/ingest.py"), "utf-8");
  writeFileSync(join(root, "telemetry/ingest.py"), src.replace(
    "        accepted.append(normalize_reading(raw, received_at=int(time.time())))",
    "        accepted.append(normalize_reading(raw, received_at=int(time.time())))\n        insert_readings([accepted[-1]])"));
  const blocked = hook("post-edit", { session_id: "u", tool_name: "Edit", tool_input: { file_path: join(root, "telemetry/ingest.py") } });
  assert.ok(blocked.block, "the stated rule still blocks");
  assert.doesNotMatch(blocked.block, /Why, from the enabled generic direction/, "the why switch is off");
  execFileSync("git", ["checkout", "-q", "--", "telemetry/ingest.py"], { cwd: root });
  // both off: not in use
  assert.equal(runDirection(["set", "repetition-cost", "--up-front", "off", root]).exitCode, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".vibegraph", "skills.json"), "utf-8")).enabled, []);
  assert.doesNotMatch(ctxOf(hook("prompt", { session_id: "u2", prompt: INGEST })), /## Generic direction/);
});
