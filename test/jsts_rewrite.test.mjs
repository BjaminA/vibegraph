// M-LANG5b (PLAN-M-LANG.md) — JS/TS edit-floor contract. Third consumer
// of the shared confinement vectors (after test_cst_rewrite.py and
// test/bash_rewrite.test.mjs): all three implementations must agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REWRITER = join(ROOT, "scripts", "frontends", "jsts", "rewrite_jsts.mjs");
const VECTORS = join(ROOT, "test", "fixtures", "rewrite_confinement", "vectors.json");

const { verifyDiffConfined } = await import("../scripts/frontends/jsts/rewrite_jsts.mjs");

const FIXTURE_SRC = `import { readFile } from "node:fs/promises";

export interface Row {
  id: number;
}

export async function loadSeed(path) {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw);
}

export function summarize(rows) {
  console.log("rows", rows.length);
  return rows.length;
}

const total = summarize([]);
`;

function scratch(content = FIXTURE_SRC) {
  const dir = mkdtempSync(join(tmpdir(), "vg-jsts-rewrite-"));
  const file = join(dir, "mod.ts");
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

test("shared confinement vectors: the THIRD implementation agrees on every vector", () => {
  const { vectors } = JSON.parse(readFileSync(VECTORS, "utf-8"));
  assert.ok(vectors.length >= 8);
  for (const v of vectors) {
    if (v.confined) {
      assert.doesNotThrow(() => verifyDiffConfined(v.pre, v.post, v.span, v.op), v.name);
    } else {
      assert.throws(
        () => verifyDiffConfined(v.pre, v.post, v.span, v.op),
        (e) => e.kind === "diff_confinement_failed",
        v.name,
      );
    }
  }
});

test("replace_node: wet write confined; prettier formats the edit", () => {
  const { dir, file } = scratch();
  try {
    const out = JSON.parse(run(file, "replace_node", "module/summarize.fn/console_log.call",
      'console.warn("rows changed", rows.length);'));
    assert.equal(out.success, true);
    const post = readFileSync(file, "utf-8");
    assert.match(post, /console\.warn\("rows changed", rows\.length\);/);
    assert.doesNotMatch(post, /console\.log\("rows"/);
    assert.match(post, /import \{ readFile \} from "node:fs\/promises";/, "head untouched");
    assert.match(post, /const total = summarize\(\[\]\);/, "tail untouched");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// M-SKILLS.3 — an exported `interface` is EDITABLE. It emitted no node at
// all until a work-run packet escalated with "the interface declaration is
// unreachable through the CST edit", failed, and cost its arm the task
// (reviews/skills/drills/boundary-integrity.md). A node is also the ADDRESS
// an edit is sent to; without one the construct cannot be changed.
test("replace_node on an exported interface: addressable, confined, `export` kept", () => {
  const { dir, file } = scratch();
  try {
    const out = JSON.parse(run(file, "replace_node", "module/Row.interface",
      "export interface Row {\n  id: number;\n  region: string;\n}"));
    assert.equal(out.success, true, JSON.stringify(out));
    const post = readFileSync(file, "utf-8");
    assert.match(post, /region: string;/, "the new member landed");
    // The span covers the wrapping export_statement (M-LANG5b's rule), so
    // the keyword is replaced rather than doubled or dropped.
    assert.match(post, /export interface Row \{/, "still exported, exactly once");
    assert.equal((post.match(/export interface Row/g) ?? []).length, 1);
    assert.doesNotMatch(post, /export export/);
    assert.match(post, /import \{ readFile \} from "node:fs\/promises";/, "head untouched");
    assert.match(post, /const total = summarize\(\[\]\);/, "tail untouched");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("wet/dry parity: dry-run stdout is byte-identical to the wet on-disk result", () => {
  const a = scratch();
  const b = scratch();
  try {
    const dry = run(a.file, "replace_node", "module/loadSeed.fn/raw.assign",
      'const raw = await readFile(path, "latin1");', ["--dry-run"]);
    assert.equal(readFileSync(a.file, "utf-8"), FIXTURE_SRC, "dry-run must not write");
    const wet = JSON.parse(run(b.file, "replace_node", "module/loadSeed.fn/raw.assign",
      'const raw = await readFile(path, "latin1");'));
    assert.equal(wet.success, true);
    assert.equal(dry, readFileSync(b.file, "utf-8"), "the D5/D6 parity invariant");
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test("insert_before / insert_after / delete_node", () => {
  const { dir, file } = scratch();
  try {
    const ins = JSON.parse(run(file, "insert_before", "module/summarize.fn/console_log.call",
      'console.time("summarize");'));
    assert.equal(ins.success, true);
    assert.match(readFileSync(file, "utf-8"), /console\.time\("summarize"\);\n  console\.log/);

    const del = JSON.parse(run(file, "delete_node", "module/summarize.fn/console_log.call"));
    assert.equal(del.success, true);
    const post = readFileSync(file, "utf-8");
    assert.doesNotMatch(post, /console\.log\("rows"/);
    assert.match(post, /console\.time/, "the inserted line survives the delete");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("replace_function_body: parity guard + surfaced diff; isAsync preserved through reparse", () => {
  const { dir, file } = scratch();
  try {
    const bad = JSON.parse(run(file, "replace_function_body", "module/summarize.fn",
      "export function tally(rows) {\n  return rows.length;\n}"));
    assert.equal(bad.errorKind, "wrong_node_kind");

    const ok = JSON.parse(run(file, "replace_function_body", "module/summarize.fn",
      'export function summarize(rows) {\n  console.info("n =", rows.length);\n  return rows.length;\n}'));
    assert.equal(ok.success, true);
    assert.ok(ok.diff && ok.newSource, "whole-scope ops surface diff + newSource (Guard 1)");
    assert.match(readFileSync(file, "utf-8"), /console\.info/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("errorKinds: empty_source, target_not_found, parse_error — nothing written", () => {
  const { dir, file } = scratch();
  try {
    assert.equal(
      JSON.parse(run(file, "replace_node", "module/summarize.fn/console_log.call", "  \n")).errorKind,
      "empty_source",
    );
    assert.equal(
      JSON.parse(run(file, "replace_node", "module/nope.fn", "x()")).errorKind,
      "target_not_found",
    );
    assert.equal(
      JSON.parse(run(file, "replace_node", "module/summarize.fn/console_log.call", "if (x {")).errorKind,
      "parse_error",
    );
    assert.equal(readFileSync(file, "utf-8"), FIXTURE_SRC);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
