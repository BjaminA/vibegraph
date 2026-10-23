// A stated rule as a person reads it (2026-10-22, src/shared/rule_readable.ts):
// the Rules panel showed a drafted rule's reason inside its text and the
// drafting gate's note ("proposed from the architecture (model); rests on
// crossing:1, …") as its WHY. Split into plain rows; the stored rule unchanged.
//
//   npm run test:rule-readable
import { test } from "node:test";
import assert from "node:assert/strict";
import { bestSentence, factsInWords, proposalWhyInWords, readableRule, splitWhy } from "../src/shared/rule_readable.ts";

test("a drafted rule: its reason, the sentence it came from, that it is not checked, who proposed it, what it rests on", () => {
  const r = readableRule({
    source: "human",
    text: "The nightly job must rebuild out/ only by running tools/build.py, and must run tools/lint.py on the result. (why: The job runs build.py and lint.py as separate commands, and out/ is a build artefact.)",
    note: "proposed from the architecture (claude:default); rests on crossing:1, crossing:3, crossing:6, funnel:tools.nightly +1",
    cite: { file: "CLAUDE.md", line: 27, quote: "**Build with the tools** — out/ is written by tools/build.py only. Validate before committing: `python3 tools/lint.py` must be clean, and the tests must pass." },
  });
  assert.equal(r.statement, "The nightly job must rebuild out/ only by running tools/build.py, and must run tools/lint.py on the result.");
  assert.equal(r.why, "The job runs build.py and lint.py as separate commands, and out/ is a build artefact.");
  assert.match(r.check, /^Not checked automatically: Claude Code is told the rule; no edit is blocked by it\.$/);
  assert.equal(r.source, "Proposed by Claude from the project's architecture; you ratified it.");
  assert.deepEqual(r.basedOn, ["3 hops between processes", "tools.nightly, the module the calls go through", "1 more"]);
  assert.equal(r.model, "claude:default");
  assert.equal(r.quote.where, "CLAUDE.md:27");
  assert.ok(!r.quote.text.includes("**"), "markdown emphasis is not part of the sentence");
});

test("a check the drafting gate removed says why, in words, even when the note was cut short", () => {
  const r = readableRule({
    source: "agent",
    text: "Only billing/charge.ts calls pay. (why: a second caller once charged twice.)",
    note: "proposed from the architecture (claude:default); rests on funnel:billing.charge — its check was removed: it cannot be decided on this code (the IR knows no definition of `pay` and no call to it",
  });
  assert.match(r.check, /^Not checked automatically: VibeGraph's map of the code has no definition of `pay` and no call to it, so a check could only ever say it cannot tell\./);
  assert.equal(r.source, "Proposed by Claude from the project's architecture; it waits for you to ratify it.");
  const violated = readableRule({ text: "x", checked: true, note: "proposed from the architecture (m); rests on tool:fetch — VIOLATED on the current code: api/x.ts:12; dropped from the scope: ghost.ts" });
  assert.equal(violated.check, "Checked, and the code breaks it today: api/x.ts:12.");
  assert.deepEqual(violated.notes, ["Left out of its scope, as this project has none of them: ghost.ts."]);
});

test("a person's own rule: its text whole, its note as written, nothing invented", () => {
  const r = readableRule({ source: "human", text: "Settled entries are never edited (they are mirrored once).", note: "from the incident review", checked: true });
  assert.equal(r.statement, "Settled entries are never edited (they are mirrored once).");
  assert.equal(r.why, null, "a parenthesis is not a reason");
  assert.deepEqual([r.check, r.source, r.notes], [null, null, ["from the incident review"]]);
});

test("the pieces: a reason after other parentheses, fact ids in words, the sentence most about the rule, a proposed check", () => {
  assert.deepEqual(splitWhy("Only a.ts connects (b.ts is the one exception). (why: a connection syncs both ways.)"),
    { statement: "Only a.ts connects (b.ts is the one exception).", why: "a connection syncs both ways." });
  assert.deepEqual(factsInWords(["tool:fetch", "boundary:fetch", "harvest:docs/a.md:3", "zone:orders/status", "direction:funnel:sqlite3", "mystery:1"]),
    ["the fetch tool", "calls leaving through fetch", "the sentence at docs/a.md:3", "the orders/status data zone", "the code's habit of reaching sqlite3 through one module", "mystery:1"]);
  assert.equal(bestSentence("Use the CLI. Only an exchange record is ever connected through link.ts. Run lint first.", "only exchange record connected link.ts"),
    "Only an exchange record is ever connected through link.ts.");
  assert.equal(proposalWhyInWords("proposed from the architecture (m); rests on funnel:a.b, tool:fetch; passes on the current code"),
    "Claude proposes this check from the project's architecture, based on a.b, the module the calls go through, the fetch tool. The code passes it today.");
});
