/**
 * A3 (PLAN-v6) — validateCitations pure-function unit.
 *
 * The post-hoc half of the grounded-citation contract: node-id-shaped tokens
 * in prose are split into grounded (exist in the IR) vs ungrounded
 * (hallucinated). Pins the node-id grammar match (backticked or bare), the
 * bare-`module` non-match, and dedup.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/citations.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCitations, isGroundedSkill } from "../src/server/citations.ts";

const KNOWN = new Set([
  "module/query.fn",
  "module/query.fn/cursor.assign",
  "module/insert.fn",
]);

test("splits grounded vs ungrounded citations", () => {
  const text =
    "The cursor is bound at `module/query.fn/cursor.assign`, inside `module/query.fn`. " +
    "It then calls `module/nonexistent.fn/x.assign`.";
  const r = validateCitations(text, KNOWN);
  assert.equal(r.ok, false);
  assert.deepEqual(r.grounded.sort(), ["module/query.fn", "module/query.fn/cursor.assign"]);
  assert.deepEqual(r.ungrounded, ["module/nonexistent.fn/x.assign"]);
});

test("ok=true when every citation is grounded", () => {
  const r = validateCitations("See `module/insert.fn` and `module/query.fn`.", KNOWN);
  assert.equal(r.ok, true);
  assert.equal(r.ungrounded.length, 0);
});

test("matches bare (non-backticked) ids too", () => {
  const r = validateCitations("flows through module/query.fn/cursor.assign here", KNOWN);
  assert.deepEqual(r.cited, ["module/query.fn/cursor.assign"]);
  assert.equal(r.ok, true);
});

test("a bare `module` word is NOT a citation", () => {
  const r = validateCitations("the module exports a query function", KNOWN);
  assert.deepEqual(r.cited, []);
  assert.equal(r.ok, true);
});

test("citations are de-duplicated", () => {
  const r = validateCitations("`module/query.fn` and again `module/query.fn`", KNOWN);
  assert.deepEqual(r.cited, ["module/query.fn"]);
});

test("no false ground when the IR is empty", () => {
  const r = validateCitations("`module/query.fn`", new Set());
  assert.equal(r.ok, false);
  assert.deepEqual(r.ungrounded, ["module/query.fn"]);
});

// gen-cwd-fix Step 3+4 — the grounding gate for a PERSISTED thread-skill.
// Accept only when the prose cites ≥1 real node id and zero hallucinated ones.

test("isGroundedSkill accepts prose citing only real node ids", () => {
  const body = "## Steps\nBinds at `module/query.fn/cursor.assign`, then `module/insert.fn`.";
  assert.equal(isGroundedSkill(body, KNOWN), true);
});

test("isGroundedSkill rejects prose with ANY hallucinated id", () => {
  const body = "Calls `module/query.fn` and the fictional `module/ghost.fn`.";
  assert.equal(isGroundedSkill(body, KNOWN), false);
});

test("isGroundedSkill rejects prose that cites no node id at all", () => {
  const body = "This thread reads from the database and writes a cache entry.";
  assert.equal(isGroundedSkill(body, KNOWN), false);
});

test("isGroundedSkill rejects everything when the IR is empty", () => {
  assert.equal(isGroundedSkill("`module/query.fn`", new Set()), false);
});
