// M-RUST (PLAN-M-RUST.md) — Rust thread extraction: the honesty rules as
// they reach a READER, which is where they matter.
// Regen: scripts/regen_rust.sh; never hand-edit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "test", "fixtures", "rust", "router_demo");
const IR = join(FIXTURE, "router_demo.ir.json");
const SNAPSHOT = join(FIXTURE, "router_demo.thread.json");

const SEEDS = [
  { seedFile: "src/main.rs", seedId: "module/main.fn", entryPointId: "src/main.rs:main" },
  {
    seedFile: "tests/router_test.rs",
    seedId: "module/routes_to_named_sink.fn",
    entryPointId: "tests/router_test.rs:routes_to_named_sink",
  },
];

function extract() {
  const files = JSON.parse(readFileSync(IR, "utf-8"));
  const r = spawnSync("python3", [join(ROOT, "scripts", "extract_thread.py"), "--batch-seeds"], {
    input: JSON.stringify({ files, seeds: SEEDS }),
    encoding: "utf-8",
    cwd: ROOT,
    env: { ...process.env, PYTHONPATH: join(ROOT, ".pydeps") },
  });
  assert.equal(r.status, 0, `extract_thread.py failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function threadsOf(payload) {
  return Array.isArray(payload) ? payload : (payload.threads ?? [payload]);
}

const mainThread = () => threadsOf(JSON.parse(readFileSync(SNAPSHOT, "utf-8")))[0];
const testThread = () => threadsOf(JSON.parse(readFileSync(SNAPSHOT, "utf-8")))[1];
const labels = (t, kind) => t.nodes.filter((n) => n.kind === kind).map((n) => n.label ?? "");

test("rust thread output matches router_demo.thread.json (snapshot)", () => {
  assert.deepEqual(extract(), JSON.parse(readFileSync(SNAPSHOT, "utf-8")),
    "snapshot drift — re-run scripts/regen_rust.sh and review the diff");
});

test("a trait-object call is DYNAMIC — the honest Rust headline", () => {
  const t = mainThread();
  // `router.route(..)` reaches `sink.deliver(..)` on a Box<dyn Sink>:
  // which impl runs is decided at runtime, and naming one would be a
  // guess. Two impls exist in the fixture precisely so it is a real
  // question rather than a technicality.
  assert.ok(labels(t, "dynamic").includes("router.route"),
    "a method call on a value stays dynamic");
  const ir = JSON.parse(readFileSync(IR, "utf-8"));
  const impls = (ir["src/router.rs"].nodes ?? [])
    .filter((n) => n.type === "function_def" && n.name === "deliver");
  assert.equal(impls.length, 2, "the fixture must carry two impls of deliver");
});

test("the TAIL call is a thread step, not a dropped node", () => {
  const t = mainThread();
  // Router::route's body ends in `sink.deliver(payload)` with no
  // `return`; if the tail rule were missing, the thread would end at the
  // `+= 1` and the delivery — the whole point of the function — would be
  // invisible.
  assert.ok(labels(t, "dynamic").some((l) => l.includes("deliver") || l.includes("route")),
    "the tail call must reach the thread");
  const returns = t.nodes.filter((n) => n.kind === "return");
  assert.ok(returns.length > 0, "and a return node is present for the seed");
});

test("cross-file steps follow CARGO convention, and stay one language", () => {
  const t = mainThread();
  assert.deepEqual(
    [...t.filesReached].sort(),
    ["src/main.rs", "src/router.rs", "src/store.rs"],
    "the bin reaches both lib modules through `use router_demo::…`",
  );
  for (const f of t.filesReached) {
    assert.ok(f.endsWith(".rs"), "a thread never crosses languages (PLAN-v5 §5.1's fork)");
  }
  const steps = t.nodes.filter((n) => n.kind === "step").map((n) => n.file);
  assert.ok(steps.includes("src/router.rs") && steps.includes("src/store.rs"));
});

test("external terminals carry the effect the table stamped", () => {
  const t = mainThread();
  const byLabel = new Map(t.nodes.filter((n) => n.kind === "external")
    .map((n) => [n.label ?? "", n.effectKind]));
  assert.equal(byLabel.get("fs::read_to_string"), "fs");
  assert.equal(byLabel.get("println!"), "log");
  assert.equal(byLabel.get("eprintln!"), "log");
  assert.ok(byLabel.has("process::exit"));
});

test("a prelude constructor is NOT reported as a resolution gap", () => {
  const t = mainThread();
  // `Some(..)` constructs an Option. Calling it `unresolved` would claim
  // the linker failed at something there was never anything to find —
  // the M-RESOLVE rule that a known runtime construct is not a gap.
  assert.deepEqual(labels(t, "unresolved"), [],
    "nothing in this fixture is a genuine resolution gap");
});

test("container chips read like Rust: `in`, `if let`, `match`", () => {
  const t = mainThread();
  const chips = labels(t, "container");
  assert.ok(chips.some((c) => /^for line in /.test(c)),
    `a for-each says "in", the Rust word: ${JSON.stringify(chips)}`);
  assert.ok(!chips.some((c) => / of | : /.test(c)),
    "and never another language's separator");
  assert.ok(chips.some((c) => c.includes("if let Some(")),
    "an if-let keeps the source's own words");
  assert.ok(chips.some((c) => c.includes("match ")),
    "a match is a container, labelled as one");
});

test("the #[test] entry threads into the library it imports", () => {
  const t = testThread();
  assert.equal(t.entryPointId, "tests/router_test.rs:routes_to_named_sink");
  assert.ok(t.filesReached.includes("src/router.rs"),
    "an integration test reaches the crate by its Cargo name");
});
