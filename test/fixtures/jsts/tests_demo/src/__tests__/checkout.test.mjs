// A node:test suite in a .mjs file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkout } from "../price.ts";

test("checkout", () => {
  assert.equal(checkout(100), 90);
});
