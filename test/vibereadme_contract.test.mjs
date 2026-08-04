/**
 * VibeReadme body contract (2026-08-04).
 *
 * A project VibeReadme is generated FROM the IR, so — like a thread-skill —
 * its shape is gated before anything is persisted. The section that matters
 * most is the last one: every other section makes claims about the codebase,
 * and "Not statically known" is what bounds them. A VibeReadme without it
 * would read as complete when it is not, which is worse than having none.
 *
 * Run: npm run test:vibereadme
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateVibeReadmeBody,
  VIBEREADME_REQUIRED_SECTIONS,
  VIBEREADME_MAX_CHARS,
} from "../src/server/vibereadme_contract.ts";

const good = [
  "## What this is",
  "A small PyTorch project.",
  "",
  "## How it is organised",
  "- data.py — loading.",
  "",
  "## Entry points",
  "- cli: train.py:main",
  "",
  "## External surface",
  "Reads data/pump.csv.",
  "",
  "## Not statically known",
  "Runtime tensor shapes.",
].join("\n");

test("a well-formed body passes", () => {
  const r = validateVibeReadmeBody(good);
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("every required section is required — including the honesty block", () => {
  for (const section of VIBEREADME_REQUIRED_SECTIONS) {
    const without = good
      .split("\n\n")
      .filter((b) => !b.startsWith(section))
      .join("\n\n");
    const r = validateVibeReadmeBody(without);
    assert.equal(r.ok, false, `dropping "${section}" must fail`);
    assert.ok(r.problems.some((p) => p.includes(section)),
      `the refusal must name "${section}", got: ${r.problems.join("; ")}`);
  }
});

test("preamble before the first heading is refused", () => {
  const r = validateVibeReadmeBody("Here is your README!\n\n" + good);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /must start with/);
});

test("sections out of order are refused", () => {
  const swapped = good.replace(
    "## What this is\nA small PyTorch project.\n\n## How it is organised\n- data.py — loading.",
    "## How it is organised\n- data.py — loading.\n\n## What this is\nA small PyTorch project.",
  );
  const r = validateVibeReadmeBody(swapped);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /out of order|must start with/);
});

test("a duplicated section is refused", () => {
  const r = validateVibeReadmeBody(good + "\n\n## Entry points\n- again");
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /appears 2 times/);
});

test("an empty body is refused, not silently accepted", () => {
  assert.equal(validateVibeReadmeBody("").ok, false);
  assert.equal(validateVibeReadmeBody("   \n  ").ok, false);
});

test("a body past the ceiling is refused", () => {
  const bloated = good.replace("A small PyTorch project.", "x".repeat(VIBEREADME_MAX_CHARS + 10));
  const r = validateVibeReadmeBody(bloated);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /over the .* ceiling/);
});

test("a heading mentioned INSIDE prose does not satisfy the section", () => {
  // "## Entry points" only counts at line start — otherwise a model could
  // satisfy the contract by naming the sections in a paragraph about them.
  const inline = good.replace("## Entry points\n- cli: train.py:main",
    "## Entry points\n- see the section called ## External surface below");
  assert.equal(validateVibeReadmeBody(inline).ok, true, "still valid — real headings present");
  const fake = good.replace("## Not statically known\nRuntime tensor shapes.",
    "prose mentioning ## Not statically known inline");
  assert.equal(validateVibeReadmeBody(fake).ok, false,
    "a heading buried in prose must not count as the section");
});
