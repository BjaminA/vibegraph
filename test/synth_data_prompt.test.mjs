/**
 * Sitting-3 — data-synth schema evidence (pure halves).
 *
 * The pump-lab holdout draft guessed 5 columns because the drafting prompt
 * held ONLY the reader function's source — the 9-column contract lived in a
 * helper (`_rows_to_tensors`) and in the sibling `data/pump.csv`. These
 * tests pin the two collectors and the prompt assembly:
 *
 *   buildPrompt            — helper/sibling sections present iff provided;
 *                            the replicate-the-sibling-schema rule rides only
 *                            with the extra context structure unchanged.
 *   collectSiblingSamples  — same-dir files sampled, same-extension first,
 *                            binary + oversized skipped, missing dir → [].
 *   collectHelperSources   — call-shaped names resolved against provided
 *                            defs, appearance order, self + builtins skipped.
 *
 * Run: npm run test:synth-data-prompt
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildPrompt, collectSiblingSamples, collectHelperSources,
} from "../src/server/run/synth_data.ts";

const READER = [
  "def evaluate_holdout(path=_HOLDOUT_PATH):",
  "    features, targets = _rows_to_tensors(_read_rows(path))",
  "    return _holdout_r2(features, targets)",
].join("\n");

// ── buildPrompt ─────────────────────────────────────────────────────────

test("no context → the original prompt shape (no evidence sections)", () => {
  const p = buildPrompt("data/holdout.csv", READER);
  assert.match(p, /drafting a SMALL example data file at "data\/holdout\.csv"/);
  assert.doesNotMatch(p, /helper functions/);
  assert.doesNotMatch(p, /SAME directory/);
});

test("helpers and siblings render as evidence sections with the schema rule", () => {
  const p = buildPrompt("data/holdout.csv", READER, {
    helpers: [{ name: "_rows_to_tensors", source: "def _rows_to_tensors(rows):\n    return data[:, :8], data[:, 8]" }],
    siblings: [{ path: "data/pump.csv", sample: "vibration,temperature,wear\n1.2,43.0,30.7", totalLines: 201 }],
  });
  assert.match(p, /helper functions the reader calls/);
  assert.match(p, /_rows_to_tensors/);
  assert.match(p, /SAME directory/);
  assert.match(p, /--- data\/pump\.csv \(first lines of 201\) ---/);
  assert.match(p, /vibration,temperature,wear/);
  assert.match(p, /REPLICATE its schema exactly/);
});

// ── collectSiblingSamples ───────────────────────────────────────────────

test("siblings: sampled with caps, same-extension first, binary skipped, no dir → []", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vg-synth-data-test-"));
  try {
    fs.mkdirSync(path.join(root, "data"));
    fs.writeFileSync(path.join(root, "data", "pump.csv"), "h1,h2,h3\n1,2,3\n4,5,6\n7,8,9\n10,11,12\n13,14,15\n16,17,18\n");
    fs.writeFileSync(path.join(root, "data", "notes.txt"), "some notes\n");
    fs.writeFileSync(path.join(root, "data", "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
    const s = collectSiblingSamples(root, "data/holdout.csv");
    assert.deepEqual(s.map((x) => x.path), ["data/pump.csv", "data/notes.txt"]); // .csv outranks; binary skipped
    assert.equal(s[0].totalLines, 8);
    assert.equal(s[0].sample.split("\n").length, 5); // first-lines cap
    assert.match(s[0].sample, /^h1,h2,h3/);

    assert.deepEqual(collectSiblingSamples(root, "absent/holdout.csv"), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── collectHelperSources ────────────────────────────────────────────────

test("helpers: resolved in appearance order; self + unresolvable names skipped", () => {
  const defs = new Map([
    ["_rows_to_tensors", { file: "data.py", line: 10, endLine: 12 }],
    ["_read_rows", { file: "data.py", line: 20, endLine: 24 }],
    ["evaluate_holdout", { file: "predict.py", line: 1, endLine: 3 }],
  ]);
  const read = (file, line, endLine) => `# ${file}:${line}-${endLine}\ndef helper(): ...`;
  const h = collectHelperSources(READER, defs, read);
  // Appearance order in the reader source; the reader's own def is excluded,
  // _holdout_r2 doesn't resolve (not in defs) → skipped.
  assert.deepEqual(h.map((x) => x.name), ["_rows_to_tensors", "_read_rows"]);
  assert.match(h[0].source, /data\.py:10-12/);
});

test("helpers: a failing snippet reader skips the helper, never throws", () => {
  const defs = new Map([["_read_rows", { file: "data.py", line: 1, endLine: 2 }]]);
  const h = collectHelperSources(READER, defs, () => { throw new Error("boom"); });
  assert.deepEqual(h, []);
});
