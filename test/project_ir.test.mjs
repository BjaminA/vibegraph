// Project envelope IR tests (PLAN-v2.md §1.1, §1.2, §4):
//   1. Snapshot — the v2.0 envelope built from each fixture's per-file
//      IR + entry-point discovery must equal the committed envelope JSON.
//   2. Schema validation — every snapshot validates against
//      schemas/project_ir.schema.json.
//   3. Cross-schema consistency — every per-file IR inside the envelope's
//      `files` map must still validate against the per-file IR schema.
//   4. Envelope-level invariants: symbolIndex is the union of per-file
//      indices; threads ships empty until M8.3.
//
// Snapshots are rebuilt from the committed per-file linker output
// (parser.test.mjs / discover_entry_points.test.mjs are the source of
// truth for those building blocks). This test focuses on the envelope
// wrapping itself.
//
// Run: npm run test:project-ir

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));

const AERO_DIR = join(ROOT, "test", "fixtures", "threads", "aero_demo");
const AERO_IR = join(AERO_DIR, "aero_demo.ir.json");
const AERO_PROJECT = join(AERO_DIR, "aero_demo.project.json");

const FLASK_DIR = join(ROOT, "test", "fixtures", "threads", "flask_demo");
const FLASK_IR = join(FLASK_DIR, "flask_demo.ir.json");
const FLASK_PROJECT = join(FLASK_DIR, "flask_demo.project.json");
const FLASK_MANUAL_SEEDS = join(FLASK_DIR, ".vibegraph", "manual_seeds.json");

const SYSTEM_DIR = join(ROOT, "test", "fixtures", "system", "system_demo");
const SYSTEM_IR = join(SYSTEM_DIR, "system_demo.ir.json");
const SYSTEM_PROJECT = join(SYSTEM_DIR, "system_demo.project.json");
const SYSTEM_MANUAL_SEEDS = join(SYSTEM_DIR, ".vibegraph", "manual_seeds.json");

const LIBRARY_DIR = join(ROOT, "test", "fixtures", "system", "library_only");
const LIBRARY_IR = join(LIBRARY_DIR, "library_only.ir.json");
const LIBRARY_PROJECT = join(LIBRARY_DIR, "library_only.project.json");

const ENVELOPE_SCHEMA = join(ROOT, "schemas", "project_ir.schema.json");
const PER_FILE_SCHEMA = join(ROOT, "schemas", "ir.schema.json");
const DISCOVER = join(ROOT, "scripts", "discover_entry_points.py");
const EXTRACT = join(ROOT, "scripts", "extract_thread.py");
const SYSTEM = join(ROOT, "scripts", "build_system_tier.py");
const PYDEPS = join(ROOT, ".pydeps");

// Mirrors server.ts:buildProjectEnvelope + the M8.2.4 / M8.3.1 / M19.1
// wiring through runDiscoverEntryPoints + runExtractAllThreads +
// runBuildSystemTier. Kept inline so the test stays hermetic — no import
// from server.ts. When the wrapper or wiring changes, both have to change.
function buildEnvelope(files, manualSeedsPath = null, projectRoot = null) {
  const symbolIndex = [];
  for (const ir of Object.values(files)) {
    if (ir.symbolIndex) symbolIndex.push(...ir.symbolIndex);
  }
  const discArgs = [DISCOVER];
  if (manualSeedsPath) discArgs.push("--manual-seeds", manualSeedsPath);
  const dr = spawnSync("python3", discArgs, {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files }),
  });
  assert.equal(dr.status, 0, `discover failed: ${dr.stderr}`);
  const entryPoints = JSON.parse(dr.stdout).entryPoints;

  const seeds = entryPoints.map((e) => ({
    seedFile: e.file,
    seedId: e.irNodeId,
    entryPointId: e.id,
  }));
  const er = spawnSync("python3", [EXTRACT, "--batch-seeds"], {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files, seeds }),
  });
  assert.equal(er.status, 0, `extract failed: ${er.stderr}`);
  const threads = JSON.parse(er.stdout).threads;

  // M19.1 — roll up into the system tier (PLAN-v5 §1.3).
  const sr = spawnSync("python3", [SYSTEM], {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files, entryPoints, threads, projectRoot }),
  });
  assert.equal(sr.status, 0, `system-tier build failed: ${sr.stderr}`);
  const system = JSON.parse(sr.stdout).system;

  return { version: "2.1", files, symbolIndex, entryPoints, threads, system };
}

test("envelope built from aero_demo per-file IRs matches aero_demo.project.json (snapshot)", () => {
  const files = JSON.parse(readFileSync(AERO_IR, "utf-8"));
  const actual = buildEnvelope(files, null, AERO_DIR);
  const expected = JSON.parse(readFileSync(AERO_PROJECT, "utf-8"));
  assert.deepStrictEqual(
    actual,
    expected,
    "aero_demo envelope drifted from the committed snapshot. Either buildProjectEnvelope / discover_entry_points changed (regenerate if intentional) or aero_demo.ir.json moved underneath it.",
  );
});

test("envelope built from flask_demo per-file IRs matches flask_demo.project.json (snapshot)", () => {
  const files = JSON.parse(readFileSync(FLASK_IR, "utf-8"));
  const actual = buildEnvelope(files, FLASK_MANUAL_SEEDS, FLASK_DIR);
  const expected = JSON.parse(readFileSync(FLASK_PROJECT, "utf-8"));
  assert.deepStrictEqual(
    actual,
    expected,
    "flask_demo envelope drifted from the committed snapshot.",
  );
});

test("envelope built from system_demo per-file IRs matches system_demo.project.json (snapshot)", () => {
  const files = JSON.parse(readFileSync(SYSTEM_IR, "utf-8"));
  const actual = buildEnvelope(files, SYSTEM_MANUAL_SEEDS, SYSTEM_DIR);
  const expected = JSON.parse(readFileSync(SYSTEM_PROJECT, "utf-8"));
  assert.deepStrictEqual(
    actual,
    expected,
    "system_demo envelope drifted from the committed snapshot. Either build_system_tier.py / discover / extract changed (regenerate if intentional) or the fixture moved underneath it.",
  );
});

test("envelope built from library_only per-file IRs matches library_only.project.json (snapshot)", () => {
  const files = JSON.parse(readFileSync(LIBRARY_IR, "utf-8"));
  const actual = buildEnvelope(files, null, LIBRARY_DIR);
  const expected = JSON.parse(readFileSync(LIBRARY_PROJECT, "utf-8"));
  assert.deepStrictEqual(
    actual,
    expected,
    "library_only envelope drifted from the committed snapshot. Either build_system_tier.py / discover / extract changed (regenerate if intentional) or the fixture moved underneath it.",
  );
});

for (const [name, projectPath] of [["aero_demo", AERO_PROJECT], ["flask_demo", FLASK_PROJECT], ["system_demo", SYSTEM_PROJECT], ["library_only", LIBRARY_PROJECT]]) {
  test(`${name}.project.json validates against project_ir.schema.json`, () => {
    const schema = JSON.parse(readFileSync(ENVELOPE_SCHEMA, "utf-8"));
    const data = JSON.parse(readFileSync(projectPath, "utf-8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(data);
    assert.equal(
      ok,
      true,
      ok ? "" : `Envelope schema validation failed:\n${JSON.stringify(validate.errors, null, 2)}`,
    );
  });

  test(`every per-file IR inside ${name}.project.json validates against ir.schema.json`, () => {
    const perFileSchema = JSON.parse(readFileSync(PER_FILE_SCHEMA, "utf-8"));
    const data = JSON.parse(readFileSync(projectPath, "utf-8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(perFileSchema);
    for (const [fname, ir] of Object.entries(data.files)) {
      const ok = validate(ir);
      assert.equal(
        ok,
        true,
        ok ? "" : `Per-file IR validation failed for ${fname}:\n${JSON.stringify(validate.errors, null, 2)}`,
      );
    }
  });

  test(`${name}: symbolIndex is the union of every per-file IR's symbolIndex`, () => {
    const data = JSON.parse(readFileSync(projectPath, "utf-8"));
    const expectedTotal = Object.values(data.files).reduce(
      (acc, ir) => acc + (ir.symbolIndex?.length ?? 0),
      0,
    );
    assert.equal(
      data.symbolIndex.length,
      expectedTotal,
      `envelope symbolIndex (${data.symbolIndex.length}) must equal the sum of per-file lengths (${expectedTotal}).`,
    );
  });

  test(`${name}: threads has one entry per entry point`, () => {
    // M8.3.1 — the parse pipeline runs extract_thread.py over every
    // detected entry point and folds the result into envelope.threads.
    // Threads carry an entryPointId back-pointer + filesReached.
    const data = JSON.parse(readFileSync(projectPath, "utf-8"));
    assert.equal(
      data.threads.length,
      data.entryPoints.length,
      "every entry point should produce exactly one thread",
    );
    const epIds = new Set(data.entryPoints.map((e) => e.id));
    for (const t of data.threads) {
      assert.ok(t.version === "1.0", `thread has wrong inner version: ${t.version}`);
      assert.ok(epIds.has(t.entryPointId),
        `thread ${t.seed.qualifiedName} has unknown entryPointId ${t.entryPointId}`);
      assert.ok(Array.isArray(t.filesReached),
        `thread ${t.seed.qualifiedName} missing filesReached`);
    }
  });
}

test("M8.2: aero_demo entryPoints picks up the if-name-main cli signal", () => {
  // aero_demo/main.py ends with `if __name__ == "__main__": compute_drag(...)`.
  // M8.2 detection should classify compute_drag as kind=cli. Pinned so
  // a future tweak to detect_cli that breaks this is visible here, not
  // only in the snapshot diff.
  const data = JSON.parse(readFileSync(AERO_PROJECT, "utf-8"));
  const cli = data.entryPoints.filter((e) => e.kind === "cli");
  assert.equal(cli.length, 1, `expected exactly 1 cli entry; got ${cli.length}`);
  assert.equal(cli[0].qualifiedName, "main:compute_drag");
});

test("M8.2: flask_demo entryPoints covers all 5 EntryPointKind values", () => {
  // Mirror of the test:discover assertion, but pinned against the
  // committed envelope snapshot — protects against the snapshot
  // drifting away from the discovery output.
  const data = JSON.parse(readFileSync(FLASK_PROJECT, "utf-8"));
  const kinds = new Set(data.entryPoints.map((e) => e.kind));
  for (const k of ["cli", "route", "public_api", "test", "manual"]) {
    assert.ok(kinds.has(k), `flask_demo envelope missing kind=${k}`);
  }
});

test("M8.3: aero_demo compute_drag thread reaches the cross-file fixture files", () => {
  // compute_drag is the canonical multi-file thread fixture; it touches
  // main / data / processing / registry. Pinned here so a future
  // change to extract_thread.py that drops a hop is visible immediately.
  const data = JSON.parse(readFileSync(AERO_PROJECT, "utf-8"));
  const t = data.threads.find((t) => t.entryPointId === "main.py:compute_drag");
  assert.ok(t, "missing compute_drag thread");
  assert.deepStrictEqual(
    [...t.filesReached].sort(),
    ["data.py", "main.py", "processing.py", "registry.py"],
    "compute_drag thread should reach exactly main / data / processing / registry",
  );
});

test("M8.3: every flask_demo entry point produces a non-trivial thread", () => {
  // Sanity that the batch-extract path is wired correctly: every
  // EntryPoint round-trips into a thread with at least the seed node.
  const data = JSON.parse(readFileSync(FLASK_PROJECT, "utf-8"));
  for (const t of data.threads) {
    assert.ok(t.nodes.length >= 1,
      `thread ${t.seed.qualifiedName} should have at least the seed node`);
    assert.ok(t.filesReached.length >= 1,
      `thread ${t.seed.qualifiedName} should reach at least its seed file`);
    assert.ok(t.filesReached.includes(t.seed.file),
      `thread ${t.seed.qualifiedName} filesReached should include seed file ${t.seed.file}`);
  }
});

// ── M8.4 — unreachable-file handling (PLAN-v2.md §1.5) ─────────────
//
// The thread view renders only files in the active thread's
// filesReached[]. The thread renderer reads thread.nodes[] directly
// (extract_thread.py emits the static-reachable subset), so the
// "filtering" is structural: any unreached file simply has no nodes
// in the thread. These assertions pin that invariant — if a future
// extractor change starts emitting nodes outside the seed's reach,
// the thread view would silently start showing unrelated files.

test("M8.4: every flask_demo thread's filesReached is a subset of project files", () => {
  const data = JSON.parse(readFileSync(FLASK_PROJECT, "utf-8"));
  const projectFiles = new Set(Object.keys(data.files));
  for (const t of data.threads) {
    for (const f of t.filesReached) {
      assert.ok(projectFiles.has(f),
        `thread ${t.seed.qualifiedName} reaches file ${f} that's not in the project files map`);
    }
  }
});

test("M8.4: at least one flask_demo thread reaches a strict subset (proves filtering happens)", () => {
  // If every thread reached every file we'd have no evidence the
  // filtering is meaningful. flask_demo is designed so non-test
  // threads never reach test_flow.py; assert that property holds
  // (catches an accidental regression that links every file to every
  // thread, e.g. a lint that pulls in shared imports).
  const data = JSON.parse(readFileSync(FLASK_PROJECT, "utf-8"));
  const projectSize = Object.keys(data.files).length;
  const strictSubsetCount = data.threads.filter(
    (t) => t.filesReached.length < projectSize,
  ).length;
  assert.ok(strictSubsetCount > 0,
    `at least one thread should reach a strict subset of project files; got ${strictSubsetCount}/${data.threads.length}`);
});

test("M8.4: thread.nodes never reference a file outside filesReached", () => {
  // Inverse: every node's `file` (if non-null — terminals are null) must
  // be in filesReached. Catches a future extractor bug that emits a
  // node from one file but forgets to add it to filesReached.
  const data = JSON.parse(readFileSync(FLASK_PROJECT, "utf-8"));
  for (const t of data.threads) {
    const reach = new Set(t.filesReached);
    for (const n of t.nodes) {
      if (!n.file) continue; // external / dynamic terminals
      assert.ok(reach.has(n.file),
        `thread ${t.seed.qualifiedName} has node ${n.id} in ${n.file} but ${n.file} is not in filesReached`);
    }
  }
});

test("M8.4: non-test threads do NOT reach test_flow.py (negative case)", () => {
  // The convention: test seeds reach test files; route/cli/public_api
  // seeds do not. Pins this so the discovery script doesn't accidentally
  // pull tests into normal threads (e.g. via a future cross-file
  // reference rule that follows imports both ways).
  const data = JSON.parse(readFileSync(FLASK_PROJECT, "utf-8"));
  const epById = Object.fromEntries(data.entryPoints.map((e) => [e.id, e]));
  for (const t of data.threads) {
    const ep = epById[t.entryPointId];
    if (!ep || ep.kind === "test") continue;
    assert.ok(!t.filesReached.includes("test_flow.py"),
      `non-test thread ${t.seed.qualifiedName} (kind=${ep.kind}) should not reach test_flow.py`);
  }
});
