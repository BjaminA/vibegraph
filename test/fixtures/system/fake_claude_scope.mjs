#!/usr/bin/env node
/**
 * Stub `claude -p --output-format json` for "Scope this node" against
 * test/fixtures/system/views_demo, scoping `tool:fetch`. Deliberately MIXED,
 * so the gate has work to do:
 *
 *   - "call" cites lib/store.ts:3 (shown: a call site)          — kept;
 *   - "store" cites the box's own id                            — circular, dropped → INFERRED;
 *   - "teleport" is not a vocabulary word                       — refused;
 *   - an out row to the decider cites an invented line          — dropped → INFERRED;
 *   - an in row from a box that does not exist                  — refused.
 *
 * Any other prompt gets an empty result.
 */
const prompt = process.argv[process.argv.length - 1] ?? "";
if (process.env.FAKE_SCOPE_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_SCOPE_DELAY_MS)));
const reply = {
  summary: "The HTTP client every process reaches the order ledger through.",
  words: [
    { word: "call", evidence: ["lib/store.ts:3"] },
    { word: "store", evidence: ["tool:fetch"] },
    { word: "teleport", evidence: ["lib/store.ts:3"] },
  ],
  in: [{ node: "cluster:ghost", what: "nothing", evidence: [] }],
  out: [{ node: "cluster:scripts:decider", what: "the ledger's answer", evidence: ["lib/store.ts:99"] }],
};
const text = prompt.includes("You are scoping ONE box") ? "```json\n" + JSON.stringify(reply, null, 2) + "\n```" : "";
process.stdout.write(JSON.stringify({ result: text, is_error: false, session_id: "fake-scope" }));
process.exit(0);
