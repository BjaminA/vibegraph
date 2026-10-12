// How a reasoning spawn hands `claude -p` its prompt (2026-10-12: re-briefing
// eleven stale lines failed with `spawn ENAMETOOLONG` — the facts pack went on
// the command line, which the OS caps). A long prompt goes on stdin; a short one
// stays an argument. Proven with the Brief stub, which reads either way.
//
//   npm run test:reasoning-spawn
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promptArgs, promptStdin, PROMPT_ARG_MAX, REASONING_DENIED_TOOLS } from "../src/server/reasoning_tools.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STUB = join(ROOT, "test/fixtures/system/fake_claude_brief.mjs");

test("a short prompt is an argument; a long one goes on stdin", () => {
  assert.deepEqual([promptArgs("hi"), promptStdin("hi")], [["--", "hi"], undefined]);
  const long = "x".repeat(PROMPT_ARG_MAX + 1);
  assert.deepEqual([promptArgs(long), promptStdin(long)?.length], [[], long.length]);
});

test("a prompt past the OS argument cap reaches the model whole, on stdin", () => {
  const prompt = `You are writing the BRIEF of a codebase.\n${"FACT ".repeat(60_000)}`; // ~300 KB: past Linux's 128 KiB per argument
  const args = [STUB, "-p", "--disallowedTools", REASONING_DENIED_TOOLS.join(","), ...promptArgs(prompt)];
  const r = spawnSync(process.execPath, args, { input: promptStdin(prompt), encoding: "utf-8" });
  assert.equal(r.error, undefined, String(r.error));
  const out = JSON.parse(r.stdout);
  assert.equal(out.is_error, false, out.result);
  assert.match(out.result, /Decides when an order is released/, "the stub saw the Brief prompt and answered it");
});
