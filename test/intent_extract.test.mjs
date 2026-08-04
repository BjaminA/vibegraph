// Mode B intent-extractor tests (bug fix). The LLM tier had ZERO
// coverage, which let the brittle JSON-only parser ship — a multi-line
// function inside {"functionSource": "...\n..."} is invalid JSON, so the
// old extractor returned null and Mode B always errored.
//
// Imports the .ts module directly (Node strips types — see the npm flag).
//
// Run: npm run test:intent-extract

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFunctionSource } from "../src/server/intent_extract.ts";

test("extracts a ```python fenced function", () => {
  const out = extractFunctionSource("```python\ndef f(x):\n    return x + 1\n```");
  assert.equal(out, "def f(x):\n    return x + 1");
});

test("extracts a JSON wrapper with RAW newlines (the original bug)", () => {
  // Literal newlines inside the string → invalid JSON → JSON.parse throws.
  const out = extractFunctionSource('{"functionSource": "def f():\n    return 1"}');
  assert.equal(out, "def f():\n    return 1");
});

test("extracts a properly-escaped single-line JSON wrapper", () => {
  const out = extractFunctionSource('{"functionSource": "def f():\\n    return 1"}');
  assert.equal(out, "def f():\n    return 1");
});

test("extracts from a ```json fence", () => {
  const out = extractFunctionSource('```json\n{"functionSource": "def f():\\n    return 2"}\n```');
  assert.equal(out, "def f():\n    return 2");
});

test("extracts a bare function with no wrapper", () => {
  const out = extractFunctionSource("def f():\n    return 1");
  assert.equal(out, "def f():\n    return 1");
});

test("extracts a decorated function (preserves the decorator)", () => {
  const src = '@app.route("/x")\ndef f():\n    return 1';
  assert.equal(extractFunctionSource(src), src);
});

test("strips a prose preamble before a fenced function", () => {
  const out = extractFunctionSource("Here's the updated function:\n\n```python\ndef f():\n    return 9\n```\n\nHope that helps!");
  assert.equal(out, "def f():\n    return 9");
});

test("strips a prose preamble before a bare function", () => {
  const out = extractFunctionSource("Sure! Below is the function.\ndef f(a, b):\n    return a + b");
  assert.equal(out, "def f(a, b):\n    return a + b");
});

test("preserves quotes inside the function body (greedy JSON value)", () => {
  const out = extractFunctionSource('{"functionSource": "def f():\n    return \\"hi\\""}');
  assert.equal(out, 'def f():\n    return "hi"');
});

test("returns null for prose with no function", () => {
  assert.equal(extractFunctionSource("I cannot do that — it would require editing another file."), null);
});

test("returns null for empty / nullish input", () => {
  assert.equal(extractFunctionSource(""), null);
  assert.equal(extractFunctionSource(null), null);
  assert.equal(extractFunctionSource(undefined), null);
});
