#!/usr/bin/env node
/**
 * Stub `claude -p --output-format json` for the M-RUN SM2.b synthesizer
 * unit test (test/synth_args.test.mjs). The real CLI emits a JSON envelope
 * whose `.result` is the model's reply TEXT; the model's own JSON therefore
 * sits as a string inside `.result`. This stub reproduces that shape
 * deterministically:
 *
 *  - prints {"result": <FAKE_SYNTH_RESPONSE>} and exits 0;
 *  - FAKE_SYNTH_RESPONSE defaults to '{"args":{}}';
 *  - FAKE_EXIT (if set) → exit with that code (no stdout) to test the
 *    non-zero-exit decline path.
 *
 * Automated tests never spawn the real `claude` (auth/cost — M10R.7).
 */
// FAKE_PROMPT_CAPTURE (optional): append the received prompt (the last argv)
// to this file so tests can assert what context actually reached the model.
if (process.env.FAKE_PROMPT_CAPTURE) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.FAKE_PROMPT_CAPTURE, process.argv[process.argv.length - 1] + "\n\x00\n");
}
const exitCode = process.env.FAKE_EXIT ? Number(process.env.FAKE_EXIT) : 0;
if (exitCode !== 0) {
  process.stderr.write("fake synth failure\n");
  process.exit(exitCode);
}
const modelText = process.env.FAKE_SYNTH_RESPONSE ?? '{"args":{}}';
process.stdout.write(JSON.stringify({ result: modelText, is_error: false, session_id: "fake" }));
process.exit(0);
