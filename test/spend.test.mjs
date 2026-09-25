// What a run COST — the ledger, and the two honesty rules it keeps.
//
// Built after head-to-head #3 (2026-09-21) printed every plain arm's cost
// and had to leave the orchestrated arm's column "not recorded": both
// headless spawn sites parsed the CLI envelope for `.result` and dropped
// `total_cost_usd`, so a nine-spawn run could say which models ran and
// never what they cost.
//
//   npm run test:spend
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSpend, costOf, emptySpend, spendSentence } from "../src/server/spend.ts";

test("the cost is the CLI's own figure, and anything that is not one is null", () => {
  assert.equal(costOf({ total_cost_usd: 1.764974 }), 1.764974);
  assert.equal(costOf({ total_cost_usd: 0 }), 0, "a true zero is a figure, not an absence");
  // A malformed envelope must never add to a total someone will quote.
  for (const bad of [null, undefined, "1.5", {}, { total_cost_usd: "1.5" }, { total_cost_usd: -1 }, { total_cost_usd: NaN }, { total_cost_usd: Infinity }]) {
    assert.equal(costOf(bad), null, JSON.stringify(bad));
  }
});

test("a spawn that reported no cost is unpriced, never free", () => {
  let s = emptySpend();
  s = addSpend(s, "worker", 1.5);
  s = addSpend(s, "worker", null);   // a local Ollama route, or a failure
  s = addSpend(s, "worker", 0);      // a genuine zero
  assert.equal(s.usd, 1.5);
  assert.equal(s.spawns, 3);
  assert.equal(s.unpriced, 1, "the null is unpriced; the 0 is not");
  assert.deepEqual(s.byKind.worker, { usd: 1.5, spawns: 3, unpriced: 1 });
});

test("the ledger is pure and splits by kind", () => {
  const base = emptySpend();
  let s = addSpend(base, "brief", 0.9);
  s = addSpend(s, "worker", 1.1);
  s = addSpend(s, "review", 0.5);
  assert.deepEqual(base, emptySpend(), "addSpend never mutates its input");
  assert.equal(s.spawns, 3);
  assert.ok(Math.abs(s.usd - 2.5) < 1e-9);
  assert.deepEqual(Object.keys(s.byKind).sort(), ["brief", "review", "worker"]);
});

test("the sentence names the total, the spawns and the split; a floor says it is one", () => {
  let s = emptySpend();
  s = addSpend(s, "brief", 0.9);
  s = addSpend(s, "worker", 1.1);
  const priced = spendSentence(s);
  assert.match(priced, /Cost: \$2\.00 over 2 model spawn\(s\)/);
  assert.match(priced, /brief 1×\$0\.90/);
  assert.match(priced, /worker 1×\$1\.10/);
  assert.doesNotMatch(priced, /floor/, "nothing was unpriced, so the total is the total");

  const withUnpriced = spendSentence(addSpend(s, "worker", null));
  assert.match(withUnpriced, /1 spawn\(s\) reported no cost/);
  assert.match(withUnpriced, /floor, not the whole bill/);
});

test("a run with no spawns says nothing rather than $0.00", () => {
  assert.equal(spendSentence(emptySpend()), "");
  assert.equal(spendSentence(null), "");
  assert.equal(spendSentence(undefined), "");
});
