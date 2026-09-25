// M-RUST (PLAN-M-RUST.md) — Rust frontend snapshot + contract test.
// Regen: scripts/regen_rust.sh; never hand-edit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FRONTEND = join(ROOT, "scripts", "frontends", "rust", "parse_rust.mjs");
const LINKER = join(ROOT, "scripts", "frontends", "rust", "link_rust.mjs");
const DISCOVER = join(ROOT, "scripts", "frontends", "rust", "discover_rust.mjs");
const FIXTURE = join(ROOT, "test", "fixtures", "rust", "router_demo");
const SNAPSHOT = join(FIXTURE, "router_demo.ir.json");
const NODE_ID = /^module(\/[^/]+)*$/;
const FILES_STDIN =
  "src/lib.rs\tsrc/lib.rs\n"
  + "src/main.rs\tsrc/main.rs\n"
  + "src/router.rs\tsrc/router.rs\n"
  + "src/store.rs\tsrc/store.rs\n"
  + "tests/router_test.rs\ttests/router_test.rs\n";

function runPipe(cmd, args, input, opts = {}) {
  const r = spawnSync(cmd, args, { input, encoding: "utf-8", cwd: ROOT, ...opts });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

function parseAndLink() {
  const { files, errors } = JSON.parse(
    runPipe(process.execPath, [FRONTEND, "--batch"], FILES_STDIN, { cwd: FIXTURE }),
  );
  assert.deepEqual(errors, {}, "the fixture must parse without dropped constructs");
  return JSON.parse(runPipe(process.execPath, [LINKER], JSON.stringify({ files }))).files;
}

/** Every reference edge out of `file`, as {source, targetFile, qualifiedTarget}. */
function refsOf(files, file) {
  return (files[file].edges ?? []).filter((e) => e.type === "reference");
}

function nodeById(files, file, id) {
  return (files[file].nodes ?? []).find((n) => n.id === id) ?? null;
}

function nodesWhere(files, file, pred) {
  return (files[file].nodes ?? []).filter(pred);
}

test("rust frontend output matches router_demo.ir.json (snapshot)", () => {
  const linked = parseAndLink();
  assert.deepEqual(linked, JSON.parse(readFileSync(SNAPSHOT, "utf-8")),
    "snapshot drift — re-run scripts/regen_rust.sh and review the diff");
});

test("every router_demo IR validates against ir.schema.json at 2.0", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas", "ir.schema.json"), "utf-8"));
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  for (const [rel, ir] of Object.entries(files)) {
    assert.equal(ir.version, "2.0", `${rel} must be IR 2.0`);
    assert.equal(ir.language, "rust", `${rel} must carry the language discriminator`);
    assert.ok(validate(ir), `${rel}: ${JSON.stringify(validate.errors)}`);
    for (const n of ir.nodes) assert.match(n.id, NODE_ID, `${rel}: bad node id ${n.id}`);
  }
});

// ── Cargo convention ────────────────────────────────────────────────

test("the parser reads the manifest above each file: crate name, module path, roots", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  // `router-demo` in Cargo.toml is `router_demo` in a use path.
  for (const ir of Object.values(files)) assert.equal(ir.crateName, "router_demo");
  assert.equal(files["src/router.rs"].cratePath, "crate::router");
  assert.equal(files["src/store.rs"].cratePath, "crate::store");
  // A lib root, a bin root and an integration test are each a crate ROOT.
  for (const root of ["src/lib.rs", "src/main.rs", "tests/router_test.rs"]) {
    assert.equal(files[root].cratePath, "crate", root);
    assert.equal(files[root].crateRoot, true, root);
  }
  assert.equal(files["src/router.rs"].crateRoot, undefined,
    "a module file is not a crate root");
});

test("`mod x;` resolves to the file Cargo convention names", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  const targets = refsOf(files, "src/lib.rs").map((e) => e.targetFile).sort();
  assert.deepEqual(targets, ["src/router.rs", "src/store.rs"]);
});

test("a bin and an integration test both reach the lib by its CARGO name", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  for (const consumer of ["src/main.rs", "tests/router_test.rs"]) {
    const hit = refsOf(files, consumer)
      .find((e) => e.qualifiedTarget === "src/router.rs:Router::new");
    assert.ok(hit, `${consumer} must resolve Router::new through use router_demo::router`);
  }
});

// ── the three honesty rules ─────────────────────────────────────────

test("RULE 1 — a tail expression is a return, and carries its call", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  // `Router::route` ends with `sink.deliver(payload)` and no `return`.
  const tail = nodesWhere(files, "src/router.rs",
    (n) => n.type === "return_stmt" && n.callTarget === "sink.deliver")[0];
  assert.ok(tail, "the tail call must be a return_stmt");
  assert.equal(tail.tailExpression, true, "and must say it was written as a tail");
  // A CONTAINER tail is walked as the container, not minted as a return:
  // parse_line ends in a `match`, whose arms hold the values.
  const parseLine = nodesWhere(files, "src/router.rs",
    (n) => n.type === "function_def" && n.name === "parse_line")[0];
  const returnsUnder = nodesWhere(files, "src/router.rs",
    (n) => n.type === "return_stmt" && n.parentId === parseLine.id);
  assert.equal(returnsUnder.length, 0, "a match tail is a container, not a return");
  assert.ok(nodesWhere(files, "src/router.rs",
    (n) => n.type === "if_stmt" && (n.condition ?? "").startsWith("match ")).length > 0,
    "the match must be there as a container instead");
});

test("RULE 2 — a macro hiding a call is FLAGGED; one hiding none is not", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  const macros = nodesWhere(files, "src/main.rs",
    (n) => n.type === "call" && n.funcName === "println!");
  assert.equal(macros.length, 2, "main.rs has exactly two println! calls");
  // `println!("routed {} of {}", router.count, line_count(&store.raw))`
  const hiding = macros.find((n) => n.nestsInnerCalls);
  assert.ok(hiding, "the println! carrying line_count(..) must be flagged");
  assert.equal(hiding.nestExtracted, false,
    "a token tree is not expressions — nothing can be minted, and the node says so");
  // `println!("done")`
  assert.ok(macros.some((n) => !n.nestsInnerCalls),
    "the println! with no call inside must NOT be flagged");
});

test("RULE 3 — a PATH call links; a METHOD call and a turbofish never do", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  const linked = new Set(refsOf(files, "src/main.rs").map((e) => e.source));
  // Path call across files: no overload count needed, Rust has none.
  const storeOpen = nodesWhere(files, "src/main.rs",
    (n) => n.callTarget === "Store::open")[0];
  assert.ok(linked.has(storeOpen.id), "Store::open must resolve");
  // Method calls on a value: the receiver's type is not stated here.
  for (const method of ["router.add", "router.route", "store.raw.lines"]) {
    const nodes = nodesWhere(files, "src/main.rs",
      (n) => n.funcName === method || n.callTarget === method);
    assert.ok(nodes.length > 0, `${method} must be in the IR`);
    for (const n of nodes) {
      assert.ok(!linked.has(n.id), `${method} must NOT link — its receiver's type is unknown`);
    }
  }
});

// ── parity + vocabulary ─────────────────────────────────────────────

test("a trait impl records the trait in the type's bases", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  for (const name of ["LogSink", "DropSink"]) {
    const cls = nodesWhere(files, "src/router.rs",
      (n) => n.type === "class_def" && n.name === name)[0];
    assert.ok(cls, `${name} must be a class_def`);
    assert.deepEqual(cls.bases, ["Sink"], `${name} implements Sink, and the IR says so`);
  }
  // Two impl blocks for ONE type share one class_def (no Router.class@1).
  const routers = nodesWhere(files, "src/router.rs",
    (n) => n.type === "class_def" && n.name === "Router");
  assert.equal(routers.length, 1, "inherent and trait impls hang off one node");
});

test("an AUGMENTED assignment records its operator, so `self.count += 1` is not a binding", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  const aug = nodesWhere(files, "src/router.rs",
    (n) => n.type === "assignment" && n.name === "self.count")[0];
  assert.ok(aug, "the compound assignment must reach the IR");
  assert.equal(aug.augmented, "+=");
});

test("effect vocabulary: fs::read_to_string→fs, process::exit→subprocess, println!→log", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  const effect = (file, target) => nodesWhere(files, file,
    (n) => n.callTarget === target || n.funcName === target)[0]?.effectKind;
  assert.equal(effect("src/store.rs", "fs::read_to_string"), "fs");
  assert.equal(effect("src/main.rs", "process::exit"), "subprocess");
  assert.equal(effect("src/main.rs", "println!"), "log");
  assert.equal(effect("src/main.rs", "eprintln!"), "log");
  // A METHOD is never keyed by name alone — which type's method it is
  // needs the receiver, and claiming the effect would be the guess
  // M-BOUNDARY refuses.
  const method = nodesWhere(files, "src/main.rs", (n) => n.funcName === "router.add")[0];
  assert.equal(method.effectKind, undefined);
});

test("the fs boundary survives a method chain: the RECEIVER call is minted", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  // `fs::read_to_string(path).unwrap_or_default()` — the boundary is the
  // receiver, not an argument. Flagging alone would have left the thread
  // naming `unwrap_or_default` and never the file read.
  const inner = nodesWhere(files, "src/store.rs",
    (n) => n.type === "call" && n.callTarget === "fs::read_to_string")[0];
  assert.ok(inner, "the inner fs call must be a node of its own");
  assert.equal(inner.nested, true);
  assert.equal(inner.effectKind, "fs");
});

test("a call inside a closure ARGUMENT is minted, not merely flagged", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  // `.ok_or_else(|| unknown_sink(name))` — the whole error path.
  const call = nodesWhere(files, "src/router.rs",
    (n) => n.type === "call" && n.funcName === "unknown_sink")[0];
  assert.ok(call, "the closure body's call must be a node");
  const linkedSameFile = refsOf(files, "src/router.rs")
    .some((e) => e.source === call.id && !e.targetFile);
  assert.ok(linkedSameFile, "and it resolves to the definition beside it");
});

test("PARITY: doc comments, declared returns, attributes, params", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  const route = nodesWhere(files, "src/router.rs",
    (n) => n.type === "function_def" && n.name === "route")[0];
  assert.match(route.docstring ?? "", /Route one payload/,
    "a /// block above an item is its docstring");
  assert.equal(route.returns, "Result<(), String>");
  assert.deepEqual(route.params, ["&mut self", "name: &str", "payload: &str"]);
  // A //! module doc must not leak in as the first item's docstring.
  const firstImport = nodesWhere(files, "src/router.rs", (n) => n.type === "import_from")[0];
  assert.ok(firstImport, "the use must be there");
  // #[test] rides as a decorator, with the line a slice must start at.
  const t = nodesWhere(files, "tests/router_test.rs",
    (n) => n.type === "function_def" && n.name === "routes_to_named_sink")[0];
  assert.deepEqual(t.decorators, ["test"]);
  assert.equal(t.decoratorLine, t.line - 1, "a whole-node slice starts at the attribute");
});

test("a doc comment separated by a blank line is NOT the item's doc", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-rust-"));
  try {
    const f = join(dir, "detached.rs");
    writeFileSync(f, "/// Not attached.\n\n/// Attached.\nfn f() {}\n");
    const ir = JSON.parse(runPipe(process.execPath, [FRONTEND, f], ""));
    const fn = ir.nodes.find((n) => n.type === "function_def");
    assert.equal(fn.docstring, "Attached.",
      "contiguity decides: a blank line breaks the block");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discovery: main → cli, #[test] → cargo-test, with authored summaries", () => {
  const files = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  const { entryPoints } = JSON.parse(
    runPipe(process.execPath, [DISCOVER], JSON.stringify({ files })),
  );
  const main = entryPoints.find((e) => e.id === "src/main.rs:main");
  assert.ok(main, "fn main is the cli entry");
  assert.equal(main.kind, "cli");
  assert.equal(main.framework, null, "no #[tokio::main], so no runtime is claimed");
  assert.equal(main.summary, "Route every line of the table, then report what was routed.",
    "the item's own /// doc, NOT the file's //! module doc above it");
  const tests = entryPoints.filter((e) => e.kind === "test");
  assert.equal(tests.length, 3, "three #[test] functions");
  for (const t of tests) assert.equal(t.framework, "cargo-test");
  assert.equal(
    tests.find((e) => e.label === "routes_to_named_sink").summary,
    "A registered sink receives the payload.",
    "the authored doc line is the summary (python's docstring rule)",
  );
  // A method named `main` inside an impl is not an entry point.
  assert.equal(entryPoints.filter((e) => e.kind === "cli").length, 1);
});

test("linker is idempotent", () => {
  const once = parseAndLink();
  const twice = JSON.parse(
    runPipe(process.execPath, [LINKER], JSON.stringify({ files: once })),
  ).files;
  assert.deepEqual(twice, once, "a second link pass must change nothing");
});

test("a file with a syntax error is dropped and RECOVERED, never silently wrong", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-rust-"));
  try {
    const f = join(dir, "broken.rs");
    writeFileSync(f, "fn good() { let x = helper(); }\nfn bad( { \n");
    const r = spawnSync(process.execPath, [FRONTEND, "--batch"],
      { input: `${f}\tbroken.rs\n`, encoding: "utf-8", cwd: ROOT });
    assert.equal(r.status, 0, "the batch must survive a broken file");
    const { files, errors } = JSON.parse(r.stdout);
    assert.ok(errors[f], "the error map must name the file");
    assert.match(errors[f], /dropped \d+ unparseable construct/);
    assert.ok((files[f].nodes ?? []).some((n) => n.name === "good"),
      "and the parseable half is still there");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
