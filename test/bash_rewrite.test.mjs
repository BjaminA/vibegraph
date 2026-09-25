// M-LANG4 (PLAN-M-LANG.md) — bash edit-floor contract:
//   * the SHARED confinement vectors (consumed by test_cst_rewrite.py
//     too — the two implementations cannot drift);
//   * each op end-to-end on a temp copy (wet write + JSON envelope);
//   * wet/dry parity (dry stdout === wet on-disk result, byte-for-byte);
//   * the errorKind taxonomy (parse_error / empty_source /
//     target_not_found / wrong_node_kind / diff_confinement_failed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REWRITER = join(ROOT, "scripts", "frontends", "bash", "rewrite_bash.mjs");
const VECTORS = join(ROOT, "test", "fixtures", "rewrite_confinement", "vectors.json");

const { verifyDiffConfined } = await import("../scripts/frontends/bash/rewrite_bash.mjs");

const FIXTURE_SRC = `#!/usr/bin/env bash
set -euo pipefail

greet() {
  echo "hello $1"
}

deploy() {
  rm -rf build/
  greet "world"
}

deploy
`;

function scratch(content = FIXTURE_SRC) {
  const dir = mkdtempSync(join(tmpdir(), "vg-bash-rewrite-"));
  const file = join(dir, "script.sh");
  writeFileSync(file, content);
  return { dir, file };
}

function run(file, op, nodeId, stdin, extraFlags = []) {
  const args = [REWRITER, file, op];
  if (nodeId) args.push(nodeId);
  args.push(...extraFlags);
  const r = spawnSync(process.execPath, args, {
    input: stdin ?? "", encoding: "utf-8", cwd: ROOT,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test("shared confinement vectors: Node agrees with Python on every vector", () => {
  const { vectors } = JSON.parse(readFileSync(VECTORS, "utf-8"));
  assert.ok(vectors.length >= 8);
  for (const v of vectors) {
    if (v.confined) {
      assert.doesNotThrow(
        () => verifyDiffConfined(v.pre, v.post, v.span, v.op),
        v.name,
      );
    } else {
      assert.throws(
        () => verifyDiffConfined(v.pre, v.post, v.span, v.op),
        (e) => e.kind === "diff_confinement_failed",
        v.name,
      );
    }
  }
});

test("replace_node: wet write confined to the target span", () => {
  const { dir, file } = scratch();
  try {
    const out = JSON.parse(run(file, "replace_node", "module/greet.fn/echo.call", 'echo "goodbye $1"'));
    assert.equal(out.success, true);
    const post = readFileSync(file, "utf-8");
    assert.match(post, /goodbye \$1/);
    assert.doesNotMatch(post, /hello \$1/);
    // everything outside the edited call is untouched
    assert.match(post, /rm -rf build\//);
    assert.match(post, /^#!\/usr\/bin\/env bash/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("wet/dry parity: dry-run stdout is byte-identical to the wet on-disk result", () => {
  const a = scratch();
  const b = scratch();
  try {
    const dry = run(a.file, "replace_node", "module/deploy.fn/rm.call", "rm -rf dist/", ["--dry-run"]);
    assert.equal(readFileSync(a.file, "utf-8"), FIXTURE_SRC, "dry-run must not write");
    const wet = JSON.parse(run(b.file, "replace_node", "module/deploy.fn/rm.call", "rm -rf dist/"));
    assert.equal(wet.success, true);
    assert.equal(dry, readFileSync(b.file, "utf-8"), "wet/dry op parity (the D5/D6 invariant)");
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test("insert_before / insert_after keep the anchor's indentation", () => {
  const { dir, file } = scratch();
  try {
    const out = JSON.parse(run(file, "insert_before", "module/deploy.fn/greet.call", 'echo "pre-greet"'));
    assert.equal(out.success, true);
    const post = readFileSync(file, "utf-8");
    assert.match(post, /  echo "pre-greet"\n  greet "world"/);
    const out2 = JSON.parse(run(file, "insert_after", "module/deploy.fn/greet.call", 'echo "post-greet"'));
    assert.equal(out2.success, true);
    assert.match(readFileSync(file, "utf-8"), /greet "world"\n  echo "post-greet"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("delete_node removes the statement and its blank husk", () => {
  const { dir, file } = scratch();
  try {
    const out = JSON.parse(run(file, "delete_node", "module/deploy.fn/rm.call"));
    assert.equal(out.success, true);
    const post = readFileSync(file, "utf-8");
    assert.doesNotMatch(post, /rm -rf/);
    assert.ok(post.includes('deploy() {\n  greet "world"'),
      "no whitespace husk where the deleted line was");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("replace_function_body: whole-function swap + signature parity guard", () => {
  const { dir, file } = scratch();
  try {
    // parity violation without the flag
    const bad = JSON.parse(run(file, "replace_function_body", "module/greet.fn",
      'salute() {\n  echo "hi"\n}'));
    assert.equal(bad.success, false);
    assert.equal(bad.errorKind, "wrong_node_kind");
    // same name passes; diff + newSource surfaced (Guard 1)
    const ok = JSON.parse(run(file, "replace_function_body", "module/greet.fn",
      'greet() {\n  echo "hi there $1"\n  logger -t app "$1"\n}'));
    assert.equal(ok.success, true);
    assert.ok(ok.diff, "whole-scope ops surface the diff");
    assert.ok(ok.newSource);
    assert.match(readFileSync(file, "utf-8"), /hi there \$1/);
    // --allow-signature-change lifts the guard
    const renamed = JSON.parse(run(file, "replace_function_body", "module/greet.fn",
      'salute() {\n  echo "hi"\n}', ["--allow-signature-change"]));
    assert.equal(renamed.success, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("errorKinds: empty_source, target_not_found, parse_error", () => {
  const { dir, file } = scratch();
  try {
    const empty = JSON.parse(run(file, "replace_node", "module/greet.fn/echo.call", "   \n"));
    assert.equal(empty.errorKind, "empty_source", "silent-delete guard (M10R central rule)");

    const missing = JSON.parse(run(file, "replace_node", "module/nope.fn", "echo x"));
    assert.equal(missing.errorKind, "target_not_found");

    const broken = JSON.parse(run(file, "replace_node", "module/greet.fn/echo.call", "if [ x ; then\ncase y"));
    assert.equal(broken.errorKind, "parse_error", "a splice that breaks the parse is rejected, not written");
    assert.equal(readFileSync(file, "utf-8"), FIXTURE_SRC, "nothing was written");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("deliberate confinement escape is rejected with the diff surfaced", () => {
  // Drive verifyDiffConfined the way the candidate loop does, with a
  // post that mutates a line outside the span — the formatter-damage
  // shape the ladder exists to catch.
  const pre = "one\ntwo\ntarget\nfour\n";
  const post = "one\nTWO_MUTATED\nnew_target\nfour\n";
  try {
    verifyDiffConfined(pre, post, [3, 3], "replace_node");
    assert.fail("must throw");
  } catch (e) {
    assert.equal(e.kind, "diff_confinement_failed");
    assert.ok(e.diff.includes("-two") && e.diff.includes("+TWO_MUTATED"),
      "the offending diff is surfaced, not swallowed (Guard 1)");
  }
});
