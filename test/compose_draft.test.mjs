// PLAN-v7 Stage 1b — the insertion-draft contract.
//
// Drives the deterministic json-format Claude stub via VG_CLAUDE_BIN (project
// convention; never spawns the real `claude`). Asserts draftInsertion:
//   - pulls the function out of the claude -p `.result` envelope's ```python
//     fence (via extractFunctionSource);
//   - accepts a bare (unfenced) function too;
//   - declines honestly (source: null + error) on a reply with no function,
//     on a non-zero exit, and never throws.
//
// The happy path is also covered end-to-end through the real spawn by
// test:e2e-plan-v7-1b; this is the fast, decline-path-covering unit.
//
// Run: npm run test:compose-draft

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { draftInsertion } from "../src/server/compose_draft.ts";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));
// The generic json stub echoes FAKE_SYNTH_RESPONSE into `.result` — exactly
// the envelope shape draftInsertion parses (reused; no draft-specific stub).
const STUB = join(ROOT, "test", "fixtures", "run_effects", "fake_claude_json.mjs");

async function withStub({ response, exit }, fn) {
  const prevBin = process.env.VG_CLAUDE_BIN;
  const prevResp = process.env.FAKE_SYNTH_RESPONSE;
  const prevExit = process.env.FAKE_EXIT;
  process.env.VG_CLAUDE_BIN = `node ${STUB}`;
  if (response !== undefined) process.env.FAKE_SYNTH_RESPONSE = response;
  if (exit !== undefined) process.env.FAKE_EXIT = String(exit);
  try {
    return await fn();
  } finally {
    if (prevBin === undefined) delete process.env.VG_CLAUDE_BIN; else process.env.VG_CLAUDE_BIN = prevBin;
    if (prevResp === undefined) delete process.env.FAKE_SYNTH_RESPONSE; else process.env.FAKE_SYNTH_RESPONSE = prevResp;
    if (prevExit === undefined) delete process.env.FAKE_EXIT; else process.env.FAKE_EXIT = prevExit;
  }
}

test("extracts a fenced ```python function from the .result envelope", async () => {
  const r = await withStub(
    { response: "```python\ndef helper(x):\n    return x + 1\n```" },
    () => draftInsertion("add a helper", "function_def foo", ROOT),
  );
  assert.equal(r.error, undefined);
  assert.match(r.source, /^def helper\(x\):/);
});

test("accepts a bare (unfenced) function too", async () => {
  const r = await withStub(
    { response: "def bare():\n    return 1\n" },
    () => draftInsertion("add bare", null, ROOT),
  );
  assert.match(r.source, /^def bare\(\):/);
});

test("declines (source: null + error) when the reply has no function", async () => {
  const r = await withStub(
    { response: "Sorry, I can't help with that." },
    () => draftInsertion("nope", null, ROOT),
  );
  assert.equal(r.source, null);
  assert.match(r.error, /no function extracted/);
});

test("declines honestly on a non-zero exit — never throws", async () => {
  const r = await withStub(
    { exit: 3 },
    () => draftInsertion("boom", null, ROOT),
  );
  assert.equal(r.source, null);
  assert.match(r.error, /claude -p exited 3/);
});
