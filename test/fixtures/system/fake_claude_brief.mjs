#!/usr/bin/env node
/**
 * Stub `claude -p --output-format json` for "Brief this codebase" against
 * test/fixtures/system/views_demo. One cited function line, one method line
 * that names two boxes, one feature line whose citation was never shown (the
 * gate drops it: INFERRED), and a method line with no vocabulary word
 * (refused). Any other prompt gets an empty result.
 */
const prompt = process.argv[process.argv.length - 1] ?? "";
const reply = {
  spec: {
    function: [
      { text: "Decides when an order is released, by a state machine run in the decider.", words: ["decides"], cites: ["topology:sm:order-phase", "cluster:scripts:decider->zone:ledger/status:uses:write"], boxes: ["cluster:scripts:decider"] },
    ],
    method: [
      { text: "Partitions the ledger so the decider alone writes status.", words: ["partitions"], cites: ["topology:store:ledger", "cluster:scripts:decider->zone:ledger/status:uses:write"], boxes: ["cluster:scripts:decider", "zone:ledger/status"] },
      { text: "Teleports orders between hosts.", words: ["teleports"], cites: ["tool:fetch"] },
    ],
    feature: [{ text: "Every decision is kept for audit.", words: ["audit-trail"], cites: ["docs/AUDIT.md:3"] }],
  },
  omitted: ["the archiver: planned, not built"],
};
const text = prompt.includes("You are writing the BRIEF of a codebase") ? "```json\n" + JSON.stringify(reply, null, 2) + "\n```" : "";
process.stdout.write(JSON.stringify({ result: text, is_error: false, session_id: "fake-brief" }));
process.exit(0);
