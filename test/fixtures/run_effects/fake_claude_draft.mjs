#!/usr/bin/env node
/**
 * PLAN-v7 Stage 1b — stub `claude -p --output-format json` for the drafted
 * compose-propose loop (test/e2e/plan-v7-1b-draft-insert.spec.ts). The real
 * CLI wraps the model's reply TEXT in `.result`; draftInsertion then runs that
 * text through extractFunctionSource, which pulls the function out of a
 * ```python fence. This stub reproduces that shape deterministically so the
 * e2e never spawns the real `claude` (auth/cost — M10R.7):
 *
 *   - prints {"result": "```python\n<fn>\n```"} and exits 0.
 *
 * The function name (vg_draft_probe) is the marker the spec asserts on for
 * ghost render, byte-unchanged-until-accept, and post-accept reconciliation.
 */
const fn = "def vg_draft_probe():\n    return 99\n";
const result = "```python\n" + fn + "```";
process.stdout.write(JSON.stringify({ result, is_error: false, session_id: "fake-draft" }));
process.exit(0);
