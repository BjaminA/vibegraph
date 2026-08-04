/**
 * Sitting-3 — array-like parameter detection for the run-to-here synth gate.
 *
 * The literal synth (numbers/lists, never a torch.tensor) can't seed a
 * tensor-typed parameter, so a function that uses one crashes on
 * `.mean(dim=…)` before its target node (the pump-lab `fit_standardizer`
 * symptom). arraylikeParams flags such REQUIRED params so the gate declines
 * honestly up front. Biased for PRECISION — a false decline is worse than a
 * miss (a miss just falls back to the honest crash).
 *
 * Run: npm run test:arg-shape
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  usesParamAsArray, requiredParamNames, arraylikeParams, arraylikeDeclineReason,
} from "../src/server/run/arg_shape.ts";

// The exact pump-lab function that crashed.
const FIT_STANDARDIZER = [
  "def fit_standardizer(column):",
  '    """Fit a Standardizer to a tensor over its first dimension."""',
  "    mean = column.mean(dim=0)",
  "    std = column.std(dim=0, unbiased=False)",
  "    std = torch.where(std < 1e-8, torch.ones_like(std), std)",
  "    return Standardizer(mean=mean, std=std)",
].join("\n");

// ── requiredParamNames ───────────────────────────────────────────────────

test("requiredParamNames: keeps required, drops defaults/self/cls/varargs/annotation", () => {
  assert.deepEqual(requiredParamNames(["column"]), ["column"]);
  assert.deepEqual(requiredParamNames(['path="data/pump.csv"']), []);       // default → not required
  assert.deepEqual(requiredParamNames(["self", "x", "*args", "**kw"]), ["x"]);
  assert.deepEqual(requiredParamNames(["cls", "n: int"]), ["n"]);           // annotation stripped
  assert.deepEqual(requiredParamNames(undefined), []);
});

// ── usesParamAsArray ─────────────────────────────────────────────────────

test("flags array-only method calls, attrs, lib calls, and matmul", () => {
  assert.equal(usesParamAsArray("y = x.mean(dim=0)", "x"), true);
  assert.equal(usesParamAsArray("z = w.reshape(-1, 8)", "w"), true);
  assert.equal(usesParamAsArray("s = a.shape[0]", "a"), true);
  assert.equal(usesParamAsArray("r = torch.where(cond, a, b)", "a"), true);
  assert.equal(usesParamAsArray("r = np.dot(m, v)", "v"), true);
  assert.equal(usesParamAsArray("y = x @ w", "x"), true);
});

test("does NOT flag literal-synthesizable usage (scalars, plain lists, dicts)", () => {
  // Standardizer.apply — arithmetic on a scalar; drill C must still run.
  assert.equal(usesParamAsArray("return (value - self.mean) / self.std", "value"), false);
  assert.equal(usesParamAsArray("total = len(rows)", "rows"), false);      // len() is fine on a list
  assert.equal(usesParamAsArray("for r in rows: pass", "rows"), false);
  assert.equal(usesParamAsArray("first = items[0]", "items"), false);      // single index → list ok
  assert.equal(usesParamAsArray("v = cfg['key']", "cfg"), false);          // dict access
  assert.equal(usesParamAsArray("s = name.upper()", "name"), false);       // str method, not array
  // A param whose NAME is a substring of another token must not false-match.
  assert.equal(usesParamAsArray("y = columns.mean(dim=0)", "column"), false);
});

// ── arraylikeParams (the wired entry point) ──────────────────────────────

test("the pump-lab fit_standardizer(column) flags `column`", () => {
  assert.deepEqual(arraylikeParams(FIT_STANDARDIZER, ["column"]), ["column"]);
});

test("target_stats(path=...) flags nothing (default arg, no tensor use)", () => {
  const src = [
    'def target_stats(path="data/pump.csv"):',
    "    _, y = _read_pump_rows(path)",
    "    return y.mean().item(), y.std(unbiased=False).item()",
  ].join("\n");
  // `path` has a default (not required) and `y` is a local, not a param.
  assert.deepEqual(arraylikeParams(src, ['path="data/pump.csv"']), []);
});

test("only REQUIRED array params are flagged (a tensor param WITH a default is skipped)", () => {
  const src = "def f(x, weights=None):\n    return x.matmul(weights)\n";
  assert.deepEqual(arraylikeParams(src, ["x", "weights=None"]), ["x"]);
});

// ── arraylikeDeclineReason ───────────────────────────────────────────────

test("decline reason names the params and the real-thread route", () => {
  const msg = arraylikeDeclineReason("fit_standardizer", ["column"]);
  assert.match(msg, /`column`/);
  assert.match(msg, /tensor\/array/);
  assert.match(msg, /torch\.tensor/);
  assert.match(msg, /real thread/i);
});
