// Arch-view layer param-count formula — the pure function that fills the
// "18.5K"-style parameter badges. Regression pin for the neural-net
// rehearsal finding: a Conv/Linear layer whose trailing formula arg is
// supplied by KEYWORD (so the IR captures fewer positional args than the
// formula needs) must OMIT the count, never emit NaN.
//
// Run: npm run test:arch-params
// Imports the .ts source directly (Node strips types with --experimental-strip-types).

import { test } from "node:test";
import assert from "node:assert/strict";
import { paramCountFor } from "../src/webview/architecture/layer_params.ts";

test("Conv2d with 3 positional literals counts correctly", () => {
  // co*ci*k^2 + co = 32*3*9 + 32 = 896
  assert.equal(paramCountFor("Conv2d", ["3", "32", "3"]), 896);
});

test("Conv2d with keyword kernel_size omits the count (was NaN)", () => {
  // IR captures only positional args → ["16","32"]; kernel size is keyword.
  // Without a positional kernel size the formula variable is undefined; the
  // count must be omitted (undefined), NOT NaN.
  const c = paramCountFor("Conv2d", ["16", "32"]);
  assert.equal(c, undefined);
  assert.ok(!Number.isNaN(c), "must never be NaN");
});

test("Conv2d with a non-literal first arg omits the count", () => {
  assert.equal(paramCountFor("Conv2d", ["in_channels", "16", "3"]), undefined);
});

test("Linear with two positional literals counts (weight + bias)", () => {
  // i*o + o = 128*10 + 10 = 1290
  assert.equal(paramCountFor("Linear", ["128", "10"]), 1290);
});

test("Linear with out_features by keyword omits the count (was NaN)", () => {
  const c = paramCountFor("Linear", ["128"]);
  assert.equal(c, undefined);
  assert.ok(!Number.isNaN(c), "must never be NaN");
});

test("BatchNorm2d with one positional literal counts", () => {
  assert.equal(paramCountFor("BatchNorm2d", ["32"]), 64);
});

test("unknown layer type omits the count", () => {
  assert.equal(paramCountFor("Flatten", []), undefined);
});
