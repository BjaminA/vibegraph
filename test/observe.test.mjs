/**
 * B5 (PLAN-v6) — the runtime-observation honesty constant.
 *
 * The load-bearing rule, pinned: an observed dispatch target is a runtime
 * sample, explicitly NOT promoted to a static resolved fact.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/observe.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OBSERVE_NOTE } from "../src/server/observe.ts";

test("the note marks the observation a runtime sample, never static resolution", () => {
  assert.match(OBSERVE_NOTE, /Runtime sample/);
  assert.match(OBSERVE_NOTE, /NOT promoted to a static 'resolved' fact/);
  assert.match(OBSERVE_NOTE, /node stays dynamic/);
});
