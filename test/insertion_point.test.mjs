// M12.3 — pin every (kind, target_ir_type) cell in PLAN-v3.md §3.2's
// default-resolution table. The pure function lives at
// src/webview/threads/insertionPoint.ts; this file is the contract.
//
// Run: npm run test:insertion
//
// Imports the .ts source directly — Node 24 strips types natively
// with --experimental-strip-types (the npm script adds the flag).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveInsertionPoint,
  applyModifierOverride,
} from "../src/webview/threads/insertionPoint.ts";

// ── §3.2 rule 2 — statement-kind dropped on body-bearing → inside_end ──

const STATEMENT_KINDS = [
  "call",
  "assignment",
  "if_stmt",
  "for_loop",
  "while_loop",
  "raise_stmt",
];

const BODY_BEARING_TARGETS = [
  "function_def",
  "class_def",
  "for_loop",
  "if_stmt",
  "while_loop",
];

for (const kind of STATEMENT_KINDS) {
  for (const target of BODY_BEARING_TARGETS) {
    test(`§3.2 rule 2 — ${kind} on ${target} → inside_end`, () => {
      const r = resolveInsertionPoint(kind, target);
      assert.equal(r.kind, "resolved");
      assert.equal(r.point, "inside_end");
    });
  }
}

// ── §3.2 rule 3 — statement-kind on non-body → ambiguous, default after ──

const NON_BODY_TARGETS = [
  "call",
  "assignment",
  "return_stmt",
  "raise_stmt",
  "import",
  "import_from",
];

for (const kind of STATEMENT_KINDS) {
  for (const target of NON_BODY_TARGETS) {
    test(`§3.2 rule 3 — ${kind} on ${target} → ambiguous (default after)`, () => {
      const r = resolveInsertionPoint(kind, target);
      assert.equal(r.kind, "ambiguous");
      assert.deepEqual(r.options, ["before", "after"]);
      assert.equal(r.defaultPoint, "after");
    });
  }
}

// ── §3.2 rule 1 — return_stmt on function_def ──────────────────────────

test("§3.2 rule 1 — return_stmt on function_def with no existing return → inside_end", () => {
  const r = resolveInsertionPoint("return_stmt", "function_def", /* hasExistingReturn */ false);
  assert.equal(r.kind, "resolved");
  assert.equal(r.point, "inside_end");
});

test("§3.2 rule 1 — return_stmt on function_def with existing return → ambiguous (default before)", () => {
  const r = resolveInsertionPoint("return_stmt", "function_def", /* hasExistingReturn */ true);
  assert.equal(r.kind, "ambiguous");
  assert.equal(r.defaultPoint, "before");
  assert.deepEqual(r.options.sort(), ["before", "inside_end"]);
});

test("§3.2 — return_stmt on for_loop → inside_end (rare but legal)", () => {
  const r = resolveInsertionPoint("return_stmt", "for_loop");
  assert.equal(r.kind, "resolved");
  assert.equal(r.point, "inside_end");
});

test("§3.2 rule 5 — return_stmt on call (non-body) → rejected", () => {
  const r = resolveInsertionPoint("return_stmt", "call");
  assert.equal(r.kind, "rejected");
});

test("§3.2 rule 5 — return_stmt on module → rejected", () => {
  const r = resolveInsertionPoint("return_stmt", "module");
  assert.equal(r.kind, "rejected");
});

// ── §3.2 rule 4 — function_def / class_def on module ───────────────────

test("§3.2 rule 4 — function_def on module → inside_end (append at file scope)", () => {
  const r = resolveInsertionPoint("function_def", "module");
  assert.equal(r.kind, "resolved");
  assert.equal(r.point, "inside_end");
});

test("§3.2 rule 4 — class_def on module → inside_end", () => {
  const r = resolveInsertionPoint("class_def", "module");
  assert.equal(r.kind, "resolved");
  assert.equal(r.point, "inside_end");
});

test("§3.2 rule 4 (extended) — function_def on class_def → inside_end (method)", () => {
  const r = resolveInsertionPoint("function_def", "class_def");
  assert.equal(r.kind, "resolved");
  assert.equal(r.point, "inside_end");
});

// ── §3.2 rule 5 — function_def / class_def on non-body → rejected ──────

for (const target of NON_BODY_TARGETS) {
  test(`§3.2 rule 5 — function_def on ${target} → rejected`, () => {
    const r = resolveInsertionPoint("function_def", target);
    assert.equal(r.kind, "rejected");
  });
  test(`§3.2 rule 5 — class_def on ${target} → rejected`, () => {
    const r = resolveInsertionPoint("class_def", target);
    assert.equal(r.kind, "rejected");
  });
}

// ── describe kind — defers to Claude path (M12.5) ──────────────────────

test("describe — resolves to 'after' as placeholder; Claude path overrides at commit time", () => {
  const r = resolveInsertionPoint("describe", "call");
  assert.equal(r.kind, "resolved");
  assert.equal(r.point, "after");
  assert.match(r.reason, /Claude path/);
});

// ── unknown target IR type ─────────────────────────────────────────────

test("unknown target type → rejected", () => {
  const r = resolveInsertionPoint("call", "yield_stmt");
  assert.equal(r.kind, "rejected");
  assert.match(r.reason, /no resolution rule/);
});

// ── modifier overrides (§4.2) ──────────────────────────────────────────

const noMods = { alt: false, shift: false, ctrl: false, meta: false };

test("§4.2 — no modifiers preserves the base resolution", () => {
  const base = resolveInsertionPoint("call", "function_def");
  const out = applyModifierOverride(base, noMods);
  assert.deepEqual(out, base);
});

test("§4.2 — shift overrides any resolution to 'before'", () => {
  const base = resolveInsertionPoint("call", "function_def");
  const out = applyModifierOverride(base, { ...noMods, shift: true });
  assert.equal(out.kind, "resolved");
  assert.equal(out.point, "before");
});

test("§4.2 — ctrl overrides to 'after'", () => {
  const base = resolveInsertionPoint("call", "function_def");
  const out = applyModifierOverride(base, { ...noMods, ctrl: true });
  assert.equal(out.kind, "resolved");
  assert.equal(out.point, "after");
});

test("§4.2 — cmd (meta) overrides to 'after' on macOS", () => {
  const base = resolveInsertionPoint("call", "function_def");
  const out = applyModifierOverride(base, { ...noMods, meta: true });
  assert.equal(out.kind, "resolved");
  assert.equal(out.point, "after");
});

test("§4.2 — alt upgrades a resolved point to ambiguous with that point as default", () => {
  const base = resolveInsertionPoint("call", "function_def"); // resolved inside_end
  const out = applyModifierOverride(base, { ...noMods, alt: true });
  assert.equal(out.kind, "ambiguous");
  assert.equal(out.defaultPoint, "inside_end");
  assert.deepEqual(out.options.sort(), ["after", "before", "inside_end", "inside_top"]);
});

test("§4.2 — alt on an already-ambiguous resolution preserves the original options", () => {
  const base = resolveInsertionPoint("call", "assignment"); // ambiguous before/after
  const out = applyModifierOverride(base, { ...noMods, alt: true });
  assert.equal(out.kind, "ambiguous");
  assert.deepEqual(out.options, ["before", "after"]);
});

test("§4.2 — shift wins over alt (no picker, force before)", () => {
  const base = resolveInsertionPoint("call", "assignment");
  const out = applyModifierOverride(base, { ...noMods, shift: true, alt: true });
  assert.equal(out.kind, "resolved");
  assert.equal(out.point, "before");
});

test("§4.2 — modifiers don't unreject a rejected base", () => {
  const base = resolveInsertionPoint("return_stmt", "call"); // rejected
  const out = applyModifierOverride(base, { ...noMods, shift: true });
  assert.equal(out.kind, "rejected");
});
