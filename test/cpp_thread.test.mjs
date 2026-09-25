// M-LANG5a (PLAN-M-LANG.md) — C++ thread extraction contract:
// classify_cpp's honesty rules proven on the geometry_demo thread.
// Regen: scripts/regen_cpp.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "test", "fixtures", "cpp", "geometry_demo");
const files = JSON.parse(readFileSync(join(FIXTURE, "geometry_demo.ir.json"), "utf-8"));

function extractThreads() {
  const payload = JSON.stringify({
    files,
    seeds: [
      { seedFile: "main.cpp", seedId: "module/main.fn", entryPointId: "main.cpp:main" },
      { seedFile: "geometry_test.cpp", seedId: "module/GeometrySuite_AreaOfUnitCircle.fn", entryPointId: "geometry_test.cpp:GeometrySuite.AreaOfUnitCircle" },
    ],
  });
  const r = spawnSync("python3", [join(ROOT, "scripts", "extract_thread.py"), "--batch-seeds"], {
    input: payload, encoding: "utf-8", cwd: ROOT,
    env: { ...process.env, PYTHONPATH: join(ROOT, ".pydeps") },
  });
  assert.equal(r.status, 0, `extract_thread failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const out = extractThreads();
const main = out.threads.find((t) => t.entryPointId === "main.cpp:main");

test("cpp thread output matches geometry_demo.thread.json (snapshot)", () => {
  const snapshot = JSON.parse(readFileSync(join(FIXTURE, "geometry_demo.thread.json"), "utf-8"));
  assert.deepEqual(out, snapshot, "drifted — regen via scripts/regen_cpp.sh if intentional");
});

test("OVERLOAD HONESTY lands in the thread: scale is UNRESOLVED, a named gap", () => {
  const unres = main.nodes.filter((n) => n.kind === "unresolved").map((n) => n.label);
  assert.deepEqual(unres, ["scale"],
    "the overloaded call is the ONLY resolution gap — never guessed, never flattened to dynamic");
});

test("template dispatch and local receivers are DYNAMIC", () => {
  const dyn = main.nodes.filter((n) => n.kind === "dynamic").map((n) => n.id).sort();
  assert.ok(dyn.includes("dynamic:clamp2<double>"), "template call = compile-time dispatch");
  assert.ok(dyn.includes("dynamic:c.area"), "method on a local receiver (R4, C++ spelling)");
  assert.ok(dyn.includes("dynamic:shapes[i].area"), "member on a PARAM receiver, subscript stripped");
});

test("cross-file steps: header convention into geometry.cpp, constructor into geometry.h", () => {
  const steps = main.nodes.filter((n) => n.kind === "step").map((n) => n.id);
  assert.ok(steps.includes("geometry.cpp:area_sum"));
  assert.ok(steps.includes("geometry.h:Circle"), "the constructor walks into the class node");
  assert.ok(steps.includes("main.cpp:report"), "same-file helper is a step");
  assert.deepEqual(main.filesReached.sort(), ["geometry.cpp", "geometry.h", "main.cpp"]);
});

test("external terminals carry effectKind: fopen fs, system subprocess, printf log", () => {
  const byId = Object.fromEntries(main.nodes.map((n) => [n.id, n]));
  assert.equal(byId["external:fopen"].effectKind, "fs");
  assert.equal(byId["external:system"].effectKind, "subprocess");
  assert.equal(byId["external:fprintf"].effectKind, "log");
});

test("the gtest thread reaches geometry.cpp through the same convention", () => {
  const t = out.threads.find((th) => th.entryPointId === "geometry_test.cpp:GeometrySuite.AreaOfUnitCircle");
  assert.ok(t.nodes.some((n) => n.kind === "step" && n.id === "geometry.cpp:area_sum"));
});
