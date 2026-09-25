// When a DERIVED quality-model binding may reject a packet.
//
// The rule that makes derived gating safe, pinned: a dimension nobody
// stated rejects only an offender the packet INTRODUCED. Measured on
// head-to-head #3 (2026-09-21) — arm A's p1 carried a derived
// resolvability violation naming three functions whose parameters were
// unannotated before the run began, so gating on the raw verdict would
// have rejected correct work.
//
//   npm run test:derived-gate
import { test } from "node:test";
import assert from "node:assert/strict";
import { derivedGate, newOffenders } from "../src/server/quality/derived_gate.ts";

const CAL = { mode: "gate-blocking", verbMayGate: true, verdict: "violated" };

test("an absent baseline is not an empty one", () => {
  assert.equal(newOffenders(["a.py:x"], undefined), undefined, "nobody looked");
  assert.deepEqual(newOffenders(["a.py:x"], []), ["a.py:x"], "looked, and found nothing before");
  assert.deepEqual(newOffenders(["a.py:x", "a.py:y"], ["a.py:x"]), ["a.py:y"]);
  assert.deepEqual(newOffenders(["a.py:x"], ["a.py:x", "a.py:y"]), [], "a fixed offender is not a new one");
});

test("the h2h3 case: an inherited violation advises, it does not reject", () => {
  const inherited = ["telemetry/schema.py:module/validate_batch.fn", "telemetry/normalize.py:module/normalize_reading.fn"];
  const d = derivedGate({ ...CAL, current: inherited, baseline: inherited });
  assert.equal(d.gates, false);
  assert.deepEqual(d.newOffenders, []);
  assert.match(d.why, /already there before the run/);
  assert.match(d.why, /does not reject a packet for code it inherited/);
});

test("an offender the packet introduced DOES reject, and the reason names it", () => {
  const d = derivedGate({ ...CAL, current: ["a.py:old", "a.py:new"], baseline: ["a.py:old"] });
  assert.equal(d.gates, true);
  assert.deepEqual(d.newOffenders, ["a.py:new"]);
  assert.match(d.why, /1 offender\(s\) this packet introduced: a\.py:new/);
});

test("all three conditions are load-bearing: mode, standing, baseline", () => {
  const withNew = { current: ["a.py:new"], baseline: [] };
  assert.equal(derivedGate({ ...CAL, ...withNew }).gates, true, "the control");
  // 1. one uncalibrated binding keeps the whole dimension advisory
  assert.equal(derivedGate({ ...CAL, ...withNew, mode: "advisory" }).gates, false);
  assert.match(derivedGate({ ...CAL, ...withNew, mode: "advisory" }).why, /not every binding it carries is calibrated/);
  // 2. the verb's own standing still decides (a DEMOTE or STALE verb never rejects)
  assert.equal(derivedGate({ ...CAL, ...withNew, verbMayGate: false }).gates, false);
  assert.match(derivedGate({ ...CAL, ...withNew, verbMayGate: false }).why, /standing does not allow it to reject/);
  // 3. no baseline means nothing can be shown to be new
  assert.equal(derivedGate({ ...CAL, current: ["a.py:new"], baseline: undefined }).gates, false);
  assert.match(derivedGate({ ...CAL, current: ["a.py:new"], baseline: undefined }).why, /no baseline was captured/);
});

test("only a violation rejects: a pass and an unverifiable never do, whatever moved", () => {
  for (const verdict of ["pass", "unverifiable"]) {
    const d = derivedGate({ ...CAL, verdict, current: ["a.py:new"], baseline: [] });
    assert.equal(d.gates, false, verdict);
    assert.match(d.why, new RegExp(`the verdict is ${verdict}`));
  }
});
