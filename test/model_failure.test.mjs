// Model-call failures, typed (2026-10-22, the root-cause handoff RC6: "model-
// call failures are flattened to 'the model returned nothing'"). One table
// classifies what the CLI said into a kind with a remedy; the server's runner
// records it once and every caller says it; the command line's spawn uses the
// same table; and a setup run checks the model call once before it spends,
// stopping there instead of failing every step.
//
//   npm run test:model-failure
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { classifyModelFailure, modelFailureText } from "../src/shared/model_failure.ts";
import { modelNothingText, recordModelFailure } from "../src/server/model_failure_state.ts";
import { spawnClassifier } from "../scripts/cli/classify.mjs";
import { runSetup } from "../src/server/setup_run.ts";

const AUTH = "claude exited 1: Failed to authenticate. API Error: 401 OAuth session expired and could not be refreshed";

test("one table: each failure's kind, from what was said", () => {
  const kinds = {
    [AUTH]: "auth",
    "could not spawn claude: spawn claude ENOENT": "not-installed",
    "claude exited 1: Claude AI usage limit reached|1761100000": "rate-limit",
    "claude exited 1: API Error: 529 overloaded": "rate-limit",
    "claude exited null: the request timed out": "timeout",
    "claude output was not JSON": "bad-output",
    "claude returned an empty result": "bad-output",
    "claude exited 2: something else entirely": "exit",
  };
  for (const [said, kind] of Object.entries(kinds)) assert.equal(classifyModelFailure(said).kind, kind, said);
});

test("the words name the kind and the remedy", () => {
  const f = classifyModelFailure(AUTH, { cmd: "/usr/bin/claude" });
  const text = modelFailureText(f);
  assert.match(text, /^Claude Code is not logged in \(/);
  assert.match(text, /To fix: log Claude Code in again: run `claude` in a terminal and type \/login \(VibeGraph runs \/usr\/bin\/claude\), or set CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(modelFailureText(classifyModelFailure("claude exited 1: usage limit reached")), /To fix: wait for the usage limit to reset/);
});

test("the server's callers say the recorded failure, never a bare 'returned nothing'", () => {
  recordModelFailure(AUTH);
  assert.match(modelNothingText(), /^the model returned nothing: Claude Code is not logged in[\s\S]*To fix: log Claude Code in again/);
  recordModelFailure(null);
  assert.equal(modelNothingText(), "the model returned nothing", "a call that succeeded clears it");
  // every module that reports a failed model call reads the recorded one
  const dir = "src/server";
  const bare = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "model_failure_state.ts")
    .filter((f) => /error: "the model returned nothing"/.test(readFileSync(join(dir, f), "utf-8")));
  assert.deepEqual(bare, []);
});

test("the command line's spawn reports the kind and the remedy", () => {
  const r = spawnClassifier({ prompt: "hi", cwd: process.cwd(), env: { ...process.env, VG_CLAUDE_BIN: "node test/fixtures/claude/expired_claude.mjs" } });
  assert.equal(r.ok, false);
  assert.equal(r.failure.kind, "auth");
  assert.match(r.error, /^Claude Code is not logged in[\s\S]*To fix: log Claude Code in again/);
});

test("a setup run checks the model call once before spending, and stops there", async () => {
  const called = [];
  const steps = [];
  const state = () => ({ steps: [{ id: "rules", title: "Rules", status: "todo", core: true, facts: [], commands: [], now: { text: "", panel: "rules" } }], next: null, after: null, done: 0, of: 1, software: null });
  const ctx = {
    state, classify: async () => { called.push("classify"); return { ok: true }; }, software: async () => ({ ok: true }),
    groups: async () => { called.push("groups"); return { ok: true }; }, brief: async () => ({ ok: true }),
    rules: async () => { called.push("rules"); return { ok: true }; }, census: () => ({ ok: true }),
    settle: async () => {}, step: (t) => steps.push(t),
    preflight: async () => ({ ok: false, error: modelFailureText(classifyModelFailure(AUTH)) }),
  };
  const r = await runSetup(ctx);
  assert.equal(r.ok, false);
  assert.match(r.error, /^not run: Claude Code is not logged in/);
  assert.deepEqual(called, [], "no model step ran, so none failed for the same reason");
  assert.deepEqual(r.held.labels, ["Propose rules from the architecture"]);
  assert.ok(steps.includes("checking the model call works"));
  // a run that spends nothing needs no check
  const quiet = await runSetup({ ...ctx, state: () => ({ ...state(), steps: [] }), preflight: async () => { throw new Error("must not be called"); } });
  assert.match(quiet.error, /nothing for Claude to run/);
});
