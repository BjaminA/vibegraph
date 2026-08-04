/**
 * Thread-skill body contract (src/server/skill_contract.ts) — the shape
 * half of the draft-time gate (grounding half pinned in citations.test).
 *
 * Pinned: the four required sections once each in order, the no-preamble
 * rule, honest multi-problem reporting, ### subsections staying legal,
 * and the size ceiling tracking the routing budget constant so a
 * persisted skill can always actually inject.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/skill_contract.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSkillBody, skillBodyOverBudget, SKILL_REQUIRED_SECTIONS } from "../src/server/skill_contract.ts";
import { SKILL_INJECTION_BUDGET_CHARS } from "../src/server/thread_remit.ts";

const GOOD = [
  "## Purpose",
  "Trains the pump regressor.",
  "## Architecture",
  "`module/train.fn` calls `module/train_model.fn`.",
  "## Steps",
  "- load `module/load.fn`",
  "## Gotchas",
  "Keep the model in train mode.",
].join("\n");

test("a conforming body passes with no problems", () => {
  const r = validateSkillBody(GOOD);
  assert.deepEqual(r, { ok: true, problems: [] });
});

test("### subsections inside a section are legal", () => {
  const r = validateSkillBody(GOOD.replace("Keep the model", "### Ordering\nKeep the model"));
  assert.equal(r.ok, true);
});

test("preamble before ## Purpose is refused by name", () => {
  const r = validateSkillBody(`Here is the skill you asked for:\n\n${GOOD}`);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("no preamble")), r.problems.join("; "));
});

test("a missing section is named — and ALL problems report, not just the first", () => {
  const r = validateSkillBody("## Purpose\nx\n## Steps\ny");
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('"## Architecture"')));
  assert.ok(r.problems.some((p) => p.includes('"## Gotchas"')));
});

test("out-of-order sections are refused", () => {
  const r = validateSkillBody("## Purpose\nx\n## Steps\ny\n## Architecture\nz\n## Gotchas\nw");
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("out of order")), r.problems.join("; "));
});

test("a duplicated section is refused", () => {
  const r = validateSkillBody(`${GOOD}\n## Purpose\nagain`);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("2 times")), r.problems.join("; "));
});

test("prose mentioning a section name mid-line does NOT count as the heading", () => {
  const r = validateSkillBody(GOOD.replace("Trains the pump regressor.", "Trains it; see ## Gotchas below."));
  // The mid-line "## Gotchas" is not at a line start — body still conforms.
  assert.equal(r.ok, true);
});

test("empty body: one honest problem", () => {
  assert.deepEqual(validateSkillBody("   \n "), { ok: false, problems: ["body is empty"] });
});

test("size ceiling tracks the routing budget constant exactly", () => {
  assert.equal(skillBodyOverBudget("x".repeat(SKILL_INJECTION_BUDGET_CHARS)), false);
  assert.equal(skillBodyOverBudget("x".repeat(SKILL_INJECTION_BUDGET_CHARS + 1)), true);
});

test("the required-section list mirrors the drafting prompt", () => {
  assert.deepEqual([...SKILL_REQUIRED_SECTIONS], ["## Purpose", "## Architecture", "## Steps", "## Gotchas"]);
});
