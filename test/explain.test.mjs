/**
 * C2 (PLAN-v6) — explain prompt + attribution unit.
 *
 * The honesty-critical pieces: the attribution makes clear the output is
 * interpretation (not a resolved fact) and does NOT change the node's state;
 * the prompt forces the model to hedge and not claim resolution.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/explain.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { explainPrompt, EXPLAIN_ATTRIBUTION } from "../src/server/explain.ts";

test("the attribution labels interpretation, not fact, and preserves the node's state", () => {
  assert.match(EXPLAIN_ATTRIBUTION, /interpretation/i);
  assert.match(EXPLAIN_ATTRIBUTION, /NOT a resolved fact/);
  assert.match(EXPLAIN_ATTRIBUTION, /does not change the node's unresolved\/external classification/);
});

test("the prompt forces hedged inference, never asserting resolution", () => {
  const p = explainPrompt("x = F.relu(self.conv1(x))");
  assert.match(p, /UNRESOLVED or EXTERNAL/);
  assert.match(p, /INTERPRETATION, not a resolved fact/);
  assert.match(p, /hedge/i);
  assert.match(p, /do NOT claim certainty/);
  assert.match(p, /```python\nx = F\.relu/);
});
