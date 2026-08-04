// M-RUN SM2.b — the argument synthesizer contract.
//
// Drives a deterministic json-format Claude stub via VG_CLAUDE_BIN (project
// convention; never spawns the real `claude`). Asserts synthesizeArgs:
//   - parses the model's JSON out of the claude -p `.result` envelope;
//   - tolerates a ```json fence the model might wrap it in;
//   - coerces non-string values to source strings;
//   - declines honestly (args: null + reason) on garbage / wrong shape /
//     non-zero exit — never throws.
//
// Run: npm run test:synth-args

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { synthesizeArgs, resolveClaudeBin } from "../src/server/run/synth_args.ts";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));
const STUB = join(ROOT, "test", "fixtures", "run_effects", "fake_claude_json.mjs");

// Each case sets the stub binary + the model's reply text, runs synth, restores env.
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

test("resolveClaudeBin honors VG_CLAUDE_BIN (whitespace split)", () => {
  const prev = process.env.VG_CLAUDE_BIN;
  process.env.VG_CLAUDE_BIN = "node /tmp/x.mjs --flag";
  assert.deepEqual(resolveClaudeBin(), { cmd: "node", args: ["/tmp/x.mjs", "--flag"] });
  if (prev === undefined) delete process.env.VG_CLAUDE_BIN; else process.env.VG_CLAUDE_BIN = prev;
});

test("parses args out of the claude -p .result envelope", async () => {
  const r = await withStub({ response: '{"args":{"factor":"2.5","label":"\'hi\'"}}' },
    () => synthesizeArgs("compute", "def compute(factor, label):\n    ...", ROOT));
  assert.deepEqual(r.args, { factor: "2.5", label: "'hi'" });
});

test("tolerates a ```json fence around the model JSON", async () => {
  const r = await withStub({ response: '```json\n{"args":{"n":"3"}}\n```' },
    () => synthesizeArgs("f", "def f(n):\n    ...", ROOT));
  assert.deepEqual(r.args, { n: "3" });
});

test("coerces non-string values to source strings", async () => {
  // The model emitted a JSON number / bool instead of a string expression.
  const r = await withStub({ response: '{"args":{"n":3,"flag":true}}' },
    () => synthesizeArgs("f", "def f(n, flag):\n    ...", ROOT));
  assert.deepEqual(r.args, { n: "3", flag: "true" });
});

test("declines (null + reason) on non-JSON model reply", async () => {
  const r = await withStub({ response: "sorry, I cannot do that" },
    () => synthesizeArgs("f", "def f(n):\n    ...", ROOT));
  assert.equal(r.args, null);
  assert.match(r.error, /not JSON/);
});

test("declines on wrong shape (no args object)", async () => {
  const r = await withStub({ response: '{"result":"oops"}' },
    () => synthesizeArgs("f", "def f(n):\n    ...", ROOT));
  assert.equal(r.args, null);
  assert.match(r.error, /no args object/);
});

test("declines on non-zero exit (never throws)", async () => {
  const r = await withStub({ exit: 1 },
    () => synthesizeArgs("f", "def f(n):\n    ...", ROOT));
  assert.equal(r.args, null);
  assert.match(r.error, /exited 1/);
});
