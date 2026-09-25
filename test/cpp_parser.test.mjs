// M-LANG5a (PLAN-M-LANG.md) — C++ frontend snapshot + contract test.
// Regen: scripts/regen_cpp.sh; never hand-edit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FRONTEND = join(ROOT, "scripts", "frontends", "cpp", "parse_cpp.mjs");
const LINKER = join(ROOT, "scripts", "frontends", "cpp", "link_cpp.mjs");
const DISCOVER = join(ROOT, "scripts", "frontends", "cpp", "discover_cpp.mjs");
const FIXTURE = join(ROOT, "test", "fixtures", "cpp", "geometry_demo");
const SNAPSHOT = join(FIXTURE, "geometry_demo.ir.json");
const NODE_ID = /^module(\/[^/]+)*$/;
const FILES_STDIN = "main.cpp\tmain.cpp\ngeometry.h\tgeometry.h\ngeometry.cpp\tgeometry.cpp\ngeometry_test.cpp\tgeometry_test.cpp\n";

function runPipe(cmd, args, input, opts = {}) {
  const r = spawnSync(cmd, args, { input, encoding: "utf-8", cwd: ROOT, ...opts });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

function parseAndLink() {
  const { files, errors } = JSON.parse(
    runPipe(process.execPath, [FRONTEND, "--batch"], FILES_STDIN, { cwd: FIXTURE }),
  );
  assert.deepEqual(errors, {}, "fixture must parse without drops");
  return JSON.parse(runPipe(process.execPath, [LINKER], JSON.stringify({ files }))).files;
}

const files = parseAndLink();

test("cpp frontend output matches geometry_demo.ir.json (snapshot)", () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  assert.deepEqual(files, snapshot, "drifted — regen via scripts/regen_cpp.sh if intentional");
});

test("every geometry_demo IR validates against ir.schema.json at 2.0", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas", "ir.schema.json"), "utf-8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const [fname, ir] of Object.entries(files)) {
    assert.equal(ir.version, "2.0", fname);
    assert.equal(ir.language, "cpp", fname);
    assert.ok(validate(ir), `${fname}: ${JSON.stringify(validate.errors)}`);
    for (const n of ir.nodes) assert.match(n.id, NODE_ID, `${fname}: ${n.id}`);
  }
});

test("header-convention linking: include geometry.h reaches the companion geometry.cpp", () => {
  const xf = files["main.cpp"].edges.filter((e) => e.type === "reference" && e.targetFile);
  const targets = xf.map((e) => e.qualifiedTarget).sort();
  assert.ok(targets.includes("geometry.cpp:area_sum"), "free fn resolves through header→companion");
  assert.ok(targets.includes("geometry.h:Circle"), "constructor links to the class (python parity)");
});

test("OVERLOAD HONESTY: scale has two definitions — the linker must refuse", () => {
  const main = files["main.cpp"];
  const scaleSite = main.nodes.find((n) => n.callTarget === "scale");
  assert.ok(scaleSite);
  const refs = new Set(main.edges.filter((e) => e.type === "reference").map((e) => e.source));
  assert.ok(!refs.has(scaleSite.id), "an overloaded name is never linked by guess");
  // both definitions really exist in geometry.cpp
  const defs = files["geometry.cpp"].nodes.filter((n) => n.type === "function_def" && n.name === "scale");
  assert.equal(defs.length, 2);
});

test("system includes never link; quoted includes keep their name shape", () => {
  const imports = files["main.cpp"].nodes.filter((n) => n.type === "import");
  const names = imports.map((n) => n.names[0]).sort();
  assert.deepEqual(names, ["<cstdio>", "<cstdlib>", "geometry.h"]);
});

test("effect vocabulary: fopen→fs, printf/fprintf→log, system→subprocess", () => {
  const main = files["main.cpp"];
  assert.equal(main.nodes.find((n) => n.name === "f").effectKind, "fs");
  assert.equal(main.nodes.find((n) => n.funcName === "system").effectKind, "subprocess");
  assert.equal(files["geometry.cpp"].nodes.find((n) => n.funcName === "printf").effectKind, "log");
});

test("out-of-class definitions keep the qualified name (named limit, honest)", () => {
  const geo = files["geometry.cpp"].nodes.filter((n) => n.type === "function_def");
  const names = geo.map((n) => n.name);
  assert.ok(names.includes("Circle::area"));
  assert.ok(names.includes("Circle::Circle"));
});

test("template call keeps its <T>: clamp2<double> stays un-linked", () => {
  const t = files["main.cpp"].nodes.find((n) => n.name === "t");
  assert.equal(t.callTarget, "clamp2<double>");
  const refs = new Set(files["main.cpp"].edges.filter((e) => e.type === "reference").map((e) => e.source));
  assert.ok(!refs.has(t.id));
});

test("discovery: main → cli, TEST(Suite, Name) → gtest test entry", () => {
  const { entryPoints } = JSON.parse(
    runPipe(process.execPath, [DISCOVER], JSON.stringify({ files })),
  );
  const byId = Object.fromEntries(entryPoints.map((e) => [e.id, e]));
  assert.equal(entryPoints.length, 2);
  assert.equal(byId["main.cpp:main"].kind, "cli");
  const t = byId["geometry_test.cpp:GeometrySuite.AreaOfUnitCircle"];
  assert.equal(t.kind, "test");
  assert.equal(t.framework, "gtest");
  assert.equal(t.label, "GeometrySuite.AreaOfUnitCircle");
});

test("PARITY: comment docstrings, declared return types, constructor args", () => {
  const as = files["geometry.cpp"].nodes.find((n) => n.name === "area_sum");
  assert.equal(as.docstring, "Sum the areas of `count` circles, logging how many were folded in.");
  assert.equal(as.returns, "double", "the declared type is C++'s always-literal `-> T`");
  const main = files["main.cpp"].nodes.find((n) => n.name === "main");
  assert.equal(main.docstring, "Measure one circle, scale and clamp the total, write the report.");
  assert.equal(main.returns, "int");
  // constructor-in-declarator syntax carries its args
  const c = files["main.cpp"].nodes.find((n) => n.name === "c");
  assert.deepEqual(c.args, ["2.0"]);
  // undocumented stays null
  const scale = files["geometry.cpp"].nodes.filter((n) => n.name === "scale");
  for (const s of scale) assert.equal(s.docstring, null);
});

test("linker is idempotent", () => {
  const relinked = JSON.parse(
    runPipe(process.execPath, [LINKER], JSON.stringify({ files })),
  ).files;
  assert.deepEqual(relinked, files);
});
