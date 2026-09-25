// What the C++ render review (reviews/cpp-render/REVIEW.md) found, pinned.
//
// `router_demo` exists because `geometry_demo` has no namespace, no
// out-of-line method called from elsewhere, no `+=` on an object and no
// range-for — so four real defects were invisible to the suite:
//
//   1. a namespaced project resolved NOTHING (0 reference edges, all files)
//   2. a `Class::method` call site never linked, even without a namespace
//   3. `obj += f()` was read as BINDING obj to f(), which made the
//      receiver tooltip state a fabricated origin
//   4. a range-for lost its type and wore Python's separator
//
//   npm run test:cpp-router
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FRONTEND = join(ROOT, "scripts", "frontends", "cpp", "parse_cpp.mjs");
const LINKER = join(ROOT, "scripts", "frontends", "cpp", "link_cpp.mjs");
const FIXTURE = join(ROOT, "test", "fixtures", "cpp", "router_demo");
const FILES_STDIN = ["router.h", "router.cpp", "main.cpp", "router_test.cpp"]
  .map((f) => `${f}\t${f}`).join("\n") + "\n";

function runPipe(cmd, args, input, opts = {}) {
  const r = spawnSync(cmd, args, { input, encoding: "utf-8", cwd: ROOT, ...opts });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

const { files: parsed, errors } = JSON.parse(
  runPipe(process.execPath, [FRONTEND, "--batch"], FILES_STDIN, { cwd: FIXTURE }),
);
assert.deepEqual(errors, {}, "the fixture must parse without drops");
const files = JSON.parse(runPipe(process.execPath, [LINKER], JSON.stringify({ files: parsed }))).files;

const refs = (f) => (files[f].edges ?? []).filter((e) => e.type === "reference");
const nodeById = (f, id) => (files[f].nodes ?? []).find((n) => n.id === id);

test("a namespaced project RESOLVES — it used to produce zero reference edges in every file", () => {
  const all = Object.keys(files).flatMap((f) => refs(f));
  assert.ok(all.length >= 4, `expected cross-file links, got ${all.length}`);
  assert.ok(all.every((e) => e.targetFile), "every one of them is cross-file here");
  const targets = all.map((e) => e.qualifiedTarget).sort();
  // A free function reached through its namespace, and an out-of-line
  // static method — the two shapes that used to be dropped.
  assert.ok(targets.includes("router.cpp:verdict_name"), targets.join(", "));
  assert.ok(targets.includes("router.cpp:Router::parse"), targets.join(", "));
});

test("the namespaces a file opens are recorded, because that is what lets a qualifier be dropped", () => {
  assert.deepEqual(files["router.cpp"].namespaces, ["net"]);
  assert.deepEqual(files["router.h"].namespaces, ["net"]);
  // A file that opens none stamps nothing — no fixture drifts for a
  // feature it does not use.
  assert.equal(files["main.cpp"].namespaces, undefined);
});

test("only a PROJECT namespace may be dropped: `std::` and a member call are still refused", () => {
  const unresolved = (files["main.cpp"].nodes ?? [])
    .filter((n) => (n.funcName ?? n.callTarget))
    .filter((n) => !refs("main.cpp").some((e) => e.source === n.id))
    .map((n) => n.funcName ?? n.callTarget);
  for (const callee of ["std::printf", "std::fprintf", "router.route", "router.add_sink"]) {
    assert.ok(unresolved.includes(callee), `${callee} must NOT resolve: ${unresolved.join(", ")}`);
  }
});

test("the overload stays unresolved: `route` has two definitions and the linker must refuse", () => {
  const defs = (files["router.cpp"].nodes ?? []).filter((n) => n.type === "function_def" && n.name === "Router::route");
  assert.equal(defs.length, 2, "the fixture states the overload");
  const routeCall = (files["main.cpp"].nodes ?? []).find((n) => (n.callTarget ?? n.funcName) === "router.route");
  assert.ok(routeCall, "the call is in the IR");
  assert.ok(!refs("main.cpp").some((e) => e.source === routeCall.id), "two definitions: no guessing");
});

test("an AUGMENTED assignment records its operator, so nothing reads `obj += f()` as a binding", () => {
  // `router += net::Router::parse(raw)` — was recorded as router BOUND to
  // that call, which made the receiver tooltip state a fabricated origin.
  const aug = (files["main.cpp"].nodes ?? []).find((n) => n.type === "assignment" && n.name === "router");
  assert.ok(aug, "the statement is in the IR");
  assert.equal(aug.augmented, "+=");
  assert.equal(aug.callTarget, "net::Router::parse", "the call is still recorded — only the BINDING claim is dropped");
  // A plain binding beside it keeps no operator.
  const plain = (files["main.cpp"].nodes ?? []).find((n) => n.type === "assignment" && n.name === "p");
  assert.equal(plain.augmented, undefined);
});

test("a range-for keeps its declared type and says `:` — the C++ separator, not Python's", () => {
  const loops = (files["main.cpp"].nodes ?? []).filter((n) => n.type === "for_loop");
  const range = loops.find((n) => n.iterName);
  assert.equal(range.target, "const std::string& raw", "the type is most of the header");
  assert.equal(range.iterName, "lines");
  assert.equal(range.iterSep, ":");
  // The classic for beside it keeps the whole header and no iterable.
  const classic = loops.find((n) => !n.iterName);
  assert.match(classic.target, /^size_t i = 0; i < lines\.size\(\); \+\+i$/);
  assert.equal(classic.iterSep, undefined);
});

test("the parser finds what a text sweep does not: destructors, the operator, the template, the tests", () => {
  const names = (f) => (files[f].nodes ?? []).filter((n) => n.type === "function_def").map((n) => n.name);
  const impl = names("router.cpp");
  for (const want of ["Sink::~Sink", "LogSink::~LogSink", "Router::~Router", "Router::operator+=", "verdict_name"]) {
    assert.ok(impl.includes(want), `${want} missing from ${impl.join(", ")}`);
  }
  assert.ok(names("router.h").includes("clamp_to"), "the template's body is parsed");
  const tests = names("router_test.cpp");
  assert.deepEqual(tests.sort(), ["RouterSuite.ClampHoldsTheBand", "RouterSuite.ParseSplitsOnColons", "RouterSuite.UnknownSinkThrows"]);
});

test("the linker is idempotent on this project too", () => {
  const again = JSON.parse(runPipe(process.execPath, [LINKER], JSON.stringify({ files }))).files;
  assert.deepEqual(again, files);
});
