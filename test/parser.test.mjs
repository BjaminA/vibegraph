// IR parser tests:
//   1. Snapshot — parse_cst.py output for sample_advanced.py must equal the committed fixture.
//   2. Schema validation — the fixture must validate against schemas/ir.schema.json.
//   3. M4a — cross_file_link.py output for test/fixtures/project/ must equal
//      the committed snapshot AND every enriched IR must validate against the schema.
//
// Run: npm run test:ir

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));

const FIXTURE_PY = join(ROOT, "test", "fixtures", "sample_advanced.py");
const FIXTURE_IR = join(ROOT, "test", "fixtures", "sample_advanced.ir.json");
const PROJECT_DIR = join(ROOT, "test", "fixtures", "project");
const PROJECT_IR = join(PROJECT_DIR, "project.ir.json");
const AERO_DIR = join(ROOT, "test", "fixtures", "threads", "aero_demo");
const AERO_IR = join(AERO_DIR, "aero_demo.ir.json");
const AERO_FILES = ["main.py", "data.py", "processing.py", "registry.py", "models.py"];
const FLASK_DIR = join(ROOT, "test", "fixtures", "threads", "flask_demo");
const FLASK_IR = join(FLASK_DIR, "flask_demo.ir.json");
const FLASK_FILES = ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"];
const SCHEMA = join(ROOT, "schemas", "ir.schema.json");
const PARSER = join(ROOT, "scripts", "parse_cst.py");
const LINKER = join(ROOT, "scripts", "cross_file_link.py");
const PYDEPS = join(ROOT, ".pydeps");

test("parse_cst.py output matches sample_advanced.ir.json (snapshot)", () => {
  const result = spawnSync("python3", [PARSER, FIXTURE_PY], {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
  });

  assert.equal(result.status, 0, `parser failed: ${result.stderr}`);

  const actual = JSON.parse(result.stdout);
  const expected = JSON.parse(readFileSync(FIXTURE_IR, "utf-8"));

  assert.deepStrictEqual(
    actual,
    expected,
    "Live parser output differs from committed fixture. Either the parser changed (regenerate the fixture if intentional) or the fixture is stale.",
  );
});

test("sample_advanced.ir.json validates against ir.schema.json", () => {
  const schema = JSON.parse(readFileSync(SCHEMA, "utf-8"));
  const data = JSON.parse(readFileSync(FIXTURE_IR, "utf-8"));

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const ok = validate(data);
  assert.equal(
    ok,
    true,
    ok
      ? ""
      : `Schema validation failed:\n${JSON.stringify(validate.errors, null, 2)}`,
  );
});

// ── M4a: cross-file project IR ──────────────────────────────────────

test("project/ cross-file link output matches project.ir.json (snapshot)", () => {
  // Parse each project file (with --module-path), then pipe the assembled
  // {filePath: IR} map through cross_file_link.py. Keys are relative
  // filenames so the snapshot is stable across machines (the linker
  // treats targetFile as opaque).
  const files = {};
  for (const fname of ["main.py", "models.py", "utils.py"]) {
    const modPath = fname.slice(0, -3);
    const r = spawnSync(
      "python3",
      [PARSER, join(PROJECT_DIR, fname), "--module-path", modPath],
      { env: { ...process.env, PYTHONPATH: PYDEPS }, encoding: "utf-8", cwd: ROOT },
    );
    assert.equal(r.status, 0, `parser failed for ${fname}: ${r.stderr}`);
    files[fname] = JSON.parse(r.stdout);
  }
  const linker = spawnSync("python3", [LINKER], {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files }),
  });
  assert.equal(linker.status, 0, `linker failed: ${linker.stderr}`);
  const actual = JSON.parse(linker.stdout).files;
  const expected = JSON.parse(readFileSync(PROJECT_IR, "utf-8"));

  assert.deepStrictEqual(
    actual,
    expected,
    "Live cross-file linker output differs from committed snapshot. Either parser/linker changed (regenerate the snapshot if intentional) or the snapshot is stale.",
  );
});

test("every project/ enriched IR validates against ir.schema.json", () => {
  const schema = JSON.parse(readFileSync(SCHEMA, "utf-8"));
  const project = JSON.parse(readFileSync(PROJECT_IR, "utf-8"));

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  for (const [fname, ir] of Object.entries(project)) {
    const ok = validate(ir);
    assert.equal(
      ok,
      true,
      ok ? "" : `Schema validation failed for ${fname}:\n${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
});

test("cross-file edges resolve to existing target nodes", () => {
  // Sanity: every edge with targetFile must point at a node that actually
  // exists in the targetFile's IR. Catches drift between linker output
  // and the per-file node IDs.
  const project = JSON.parse(readFileSync(PROJECT_IR, "utf-8"));
  for (const [fname, ir] of Object.entries(project)) {
    for (const edge of ir.edges) {
      if (!edge.targetFile) continue;
      const target = project[edge.targetFile];
      assert.ok(
        target,
        `${fname}: edge ${edge.source} → ${edge.target} targets unknown file ${edge.targetFile}`,
      );
      const found = target.nodes.find((n) => n.id === edge.target);
      assert.ok(
        found,
        `${fname}: edge ${edge.source} → ${edge.target} (in ${edge.targetFile}) does not resolve — no such node id`,
      );
    }
  }
});

// ── M4b prep: aero_demo thread fixture ──────────────────────────────
//
// Same shape as the project/ snapshot tests above — the aero_demo
// fixture is the canonical input for the thread extractor (M4b wave 2)
// and the renderer (wave 3), so its IR must stay parser-stable.

test("threads/aero_demo cross-file link output matches aero_demo.ir.json (snapshot)", () => {
  const files = {};
  for (const fname of AERO_FILES) {
    const modPath = fname.slice(0, -3);
    const r = spawnSync(
      "python3",
      [PARSER, join(AERO_DIR, fname), "--module-path", modPath],
      { env: { ...process.env, PYTHONPATH: PYDEPS }, encoding: "utf-8", cwd: ROOT },
    );
    assert.equal(r.status, 0, `parser failed for ${fname}: ${r.stderr}`);
    files[fname] = JSON.parse(r.stdout);
  }
  const linker = spawnSync("python3", [LINKER], {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files }),
  });
  assert.equal(linker.status, 0, `linker failed: ${linker.stderr}`);
  const actual = JSON.parse(linker.stdout).files;
  const expected = JSON.parse(readFileSync(AERO_IR, "utf-8"));

  assert.deepStrictEqual(
    actual,
    expected,
    "aero_demo linker output differs from committed snapshot. Either parser/linker changed (regenerate the snapshot if intentional) or the snapshot is stale.",
  );
});

test("every threads/aero_demo enriched IR validates against ir.schema.json", () => {
  const schema = JSON.parse(readFileSync(SCHEMA, "utf-8"));
  const project = JSON.parse(readFileSync(AERO_IR, "utf-8"));

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  for (const [fname, ir] of Object.entries(project)) {
    const ok = validate(ir);
    assert.equal(
      ok,
      true,
      ok ? "" : `Schema validation failed for ${fname}:\n${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
});

test("aero_demo carries the thread-shaping markers the extractor needs", () => {
  // Wave-1 sanity: the fixture must exercise every code path the M4b
  // thread visitor cares about. If a future edit accidentally smooths
  // one of these out, the thread snapshot will silently lose its
  // ambiguity markers — catch it here.
  const project = JSON.parse(readFileSync(AERO_IR, "utf-8"));

  // 1. cross-file references from the seed (compute_drag) — five of them.
  const mainXfile = project["main.py"].edges.filter((e) => e.targetFile);
  assert.equal(
    mainXfile.length,
    5,
    `main.py expected 5 cross-file references from compute_drag; got ${mainXfile.length}`,
  );

  // 2. dynamic boundary: registry.select_model has no outbound reference
  //    edge into models.py (getattr is unresolvable). The thread extractor
  //    must mark this as "stops here — dynamic".
  const registryXfile = project["registry.py"].edges.filter((e) => e.targetFile);
  assert.equal(
    registryXfile.length,
    0,
    "registry.py select_model uses getattr — no static reference edge into models.py should exist",
  );

  // 3. dynamic call site in compute_drag: `drag_coeff = model(...)` —
  //    `model` is a runtime value; no targetFile edge should attach to
  //    drag_coeff.assign. Same boundary, downstream side.
  const dragAssignEdges = project["main.py"].edges.filter(
    (e) => e.source === "module/compute_drag.fn/drag_coeff.assign" && e.targetFile,
  );
  assert.equal(
    dragAssignEdges.length,
    0,
    "drag_coeff.assign calls a runtime value — must not have a cross-file reference",
  );

  // 4. non-trivial conditional in processing.normalize_conditions —
  //    the if must have an if_stmt node with at least two child branches
  //    that the renderer will mark with a dashed edge.
  const ifNodes = project["processing.py"].nodes.filter(
    (n) => n.type === "if_stmt" && n.parentId === "module/normalize_conditions.fn",
  );
  assert.equal(
    ifNodes.length,
    1,
    `processing.normalize_conditions should contain exactly 1 if_stmt; got ${ifNodes.length}`,
  );
});

// ── M8.2: flask_demo fixture ───────────────────────────────────────
//
// flask_demo exercises every M8.2 entry-point detection rule (cli /
// route / public_api / test). The IR snapshot pins parser stability
// (decorators round-trip, route handlers carry their @app.route(...)
// strings). Entry-point discovery is tested separately in
// test/discover_entry_points.test.mjs (M8.2.3).

test("threads/flask_demo cross-file link output matches flask_demo.ir.json (snapshot)", () => {
  const files = {};
  for (const fname of FLASK_FILES) {
    const modPath = fname.slice(0, -3);
    const r = spawnSync(
      "python3",
      [PARSER, join(FLASK_DIR, fname), "--module-path", modPath],
      { env: { ...process.env, PYTHONPATH: PYDEPS }, encoding: "utf-8", cwd: ROOT },
    );
    assert.equal(r.status, 0, `parser failed for ${fname}: ${r.stderr}`);
    files[fname] = JSON.parse(r.stdout);
  }
  const linker = spawnSync("python3", [LINKER], {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files }),
  });
  assert.equal(linker.status, 0, `linker failed: ${linker.stderr}`);
  const actual = JSON.parse(linker.stdout).files;
  const expected = JSON.parse(readFileSync(FLASK_IR, "utf-8"));

  assert.deepStrictEqual(
    actual,
    expected,
    "flask_demo linker output differs from committed snapshot. Either parser/linker changed (regenerate the snapshot if intentional) or the snapshot is stale.",
  );
});

test("flask_demo: effectKind=db on every wrapped DB call (IR 1.3)", () => {
  // Pin the M9.1 detection so a future tweak to _classify_effect_kind
  // that loses the `*.execute` receiver heuristic breaks loudly here,
  // not silently in the M9.4 effects panel.
  const project = JSON.parse(readFileSync(FLASK_IR, "utf-8"));
  // db.py: cursor = conn.execute(...) — both query and insert.
  // M17.2 reparented cursor.assign under try@0 (it sits inside the try
  // body), so match by name + enclosing function rather than exact ID.
  for (const fn of ["query", "insert"]) {
    const cursor = project["db.py"].nodes.find(
      (n) => n.type === "assignment" &&
        n.name === "cursor" &&
        n.id.startsWith(`module/${fn}.fn/`),
    );
    assert.ok(cursor, `db.py:${fn} should have a cursor.assign node`);
    assert.equal(cursor.effectKind, "db",
      `db.py:${fn}/cursor.assign should be effectKind=db; got ${cursor.effectKind ?? "undefined"}`);
  }
  // models.py:create_user: uid = insert(...) — bare `insert(...)` rule
  const uid = project["models.py"].nodes.find(
    (n) => n.id === "module/create_user.fn/uid.assign",
  );
  assert.ok(uid, "models.py:create_user should have a uid.assign node");
  assert.equal(uid.effectKind, "db",
    `models.py:create_user/uid.assign should be effectKind=db; got ${uid.effectKind ?? "undefined"}`);
});

test("flask_demo: isAsync emitted on every function_def (IR 1.3)", () => {
  // All flask_demo functions are sync. Pin both the field's presence
  // (always emitted, never undefined) and the false value so a future
  // parser regression that drops the field is caught.
  const project = JSON.parse(readFileSync(FLASK_IR, "utf-8"));
  for (const [fname, ir] of Object.entries(project)) {
    for (const fn of ir.nodes.filter((n) => n.type === "function_def")) {
      assert.equal(typeof fn.isAsync, "boolean",
        `${fname}:${fn.name} isAsync must be a boolean (got ${typeof fn.isAsync})`);
      assert.equal(fn.isAsync, false,
        `${fname}:${fn.name} should be sync (got isAsync=${fn.isAsync})`);
    }
  }
});

test("isAsync detection: parser emits true for `async def` (IR 1.3)", () => {
  // Inline parser run — flask_demo / aero_demo don't currently use
  // async, so we synthesise a tiny module to exercise the path.
  const tmpPath = join(ROOT, "test", "fixtures", "_tmp_async.py");
  writeFileSync(tmpPath, "async def fetch():\n    pass\n\ndef sync():\n    pass\n");
  try {
    const r = spawnSync("python3", [PARSER, tmpPath], {
      env: { ...process.env, PYTHONPATH: PYDEPS },
      encoding: "utf-8",
      cwd: ROOT,
    });
    assert.equal(r.status, 0, `parser failed: ${r.stderr}`);
    const ir = JSON.parse(r.stdout);
    const fns = Object.fromEntries(
      ir.nodes.filter((n) => n.type === "function_def").map((n) => [n.name, n]),
    );
    assert.equal(fns.fetch.isAsync, true, "async def fetch() must produce isAsync=true");
    assert.equal(fns.sync.isAsync, false, "def sync() must produce isAsync=false");
  } finally {
    unlinkSync(tmpPath);
  }
});

test("flask_demo route handlers carry their decorator source text (IR 1.2)", () => {
  // Pin the M8.2.1 contract: parser captures decorator strings and
  // discover_entry_points.py can match on them. If decorators ever
  // get dropped from FunctionDef emission again, route detection
  // breaks silently — this test catches it.
  const project = JSON.parse(readFileSync(FLASK_IR, "utf-8"));
  const app = project["app.py"];
  const expected = {
    list_users_route: 'app.route("/users")',
    get_user_route: 'app.route("/users/<int:uid>", methods=["GET"])',
    create_user_route: 'app.post("/users")',
  };
  for (const [name, decorator] of Object.entries(expected)) {
    const fn = app.nodes.find((n) => n.type === "function_def" && n.name === name);
    assert.ok(fn, `app.py missing function ${name}`);
    assert.deepStrictEqual(
      fn.decorators,
      [decorator],
      `${name} expected decorator [${JSON.stringify(decorator)}]; got ${JSON.stringify(fn.decorators)}`,
    );
  }
  // Sanity: undecorated functions still get an empty decorators array.
  for (const [fname, ir] of Object.entries(project)) {
    for (const fn of ir.nodes.filter((n) => n.type === "function_def")) {
      assert.ok(
        Array.isArray(fn.decorators),
        `${fname}:${fn.name} missing decorators array`,
      );
    }
  }
});

test("third-party / unresolvable calls emit no cross-file edge", () => {
  // utils.py imports nothing and calls print() — a builtin that has no
  // import-map entry. main.py uses __name__ (computed) and run() (local).
  // None of these should produce targetFile edges.
  const project = JSON.parse(readFileSync(PROJECT_IR, "utf-8"));
  const utilsXfile = project["utils.py"].edges.filter((e) => e.targetFile);
  assert.equal(utilsXfile.length, 0,
    "utils.py should emit no cross-file edges (no project imports)");

  // main.py: only the two known cross-file edges should be present.
  const mainXfile = project["main.py"].edges.filter((e) => e.targetFile);
  assert.equal(mainXfile.length, 2,
    `main.py expected exactly 2 cross-file edges (format_name + greet); got ${mainXfile.length}`);
  const targets = new Set(mainXfile.map((e) => e.qualifiedTarget));
  assert.ok(targets.has("utils:format_name"), "missing utils:format_name edge");
  assert.ok(targets.has("utils:greet"), "missing utils:greet edge");
});

// A `raise` carried a bespoke 40-char cap while every other preview-bearing
// node used PREVIEW_MAX, so a routine `raise ValueError(f"...")` reached the
// file view cut mid-expression — `ValueError(\n    f"length mismatch: {len(`
// — with nothing marking that a cut had happened.
test("raise keeps its full exception text, not a bespoke 40-char cut", () => {
  const src = [
    "def check(preds, targs):",
    "    if len(preds) != len(targs):",
    "        raise ValueError(",
    '            f"length mismatch: {len(preds)} predictions vs {len(targs)} targets"',
    "        )",
    "",
  ].join("\n");
  const tmp = join(tmpdir(), `vg-raise-${process.pid}.py`);
  writeFileSync(tmp, src, "utf-8");
  let ir;
  try {
    const r = spawnSync("python3", [PARSER, tmp],
      { env: { ...process.env, PYTHONPATH: PYDEPS }, encoding: "utf-8", cwd: ROOT });
    assert.equal(r.status, 0, `parser failed: ${r.stderr}`);
    ir = JSON.parse(r.stdout);
  } finally { unlinkSync(tmp); }
  const raised = ir.nodes.find((n) => n.type === "raise_stmt");
  assert.ok(raised, "expected a raise_stmt node");
  assert.ok(raised.exc.includes("targets"),
    `the tail of the message must survive; got ${JSON.stringify(raised.exc)}`);
  assert.ok(raised.exc.length > 40, "the old 40-char cap must be gone");
  assert.equal(raised.exc.split("\n").length, 3,
    "source newlines are preserved so the view can size the node to them");
});
