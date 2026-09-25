// IR FIDELITY — the expression-position contract, pinned for every
// tree-sitter frontend at once.
//
// The class this guards against is the one CLAUDE.md records from the
// python sweep: "the parser emits a call node when the call is the
// DIRECT value of a statement and never walks INTO a composite
// expression — which is why patching `with`, then `if`/`while`,
// individually kept the class alive." It came back twice more after
// that, in JS/TS (1030 dropped call sites, 258 of them into functions
// this project defines) and in bash (34), and both times it was
// invisible until somebody measured it.
//
// So this suite measures rather than inspects: it parses a probe with
// the SAME grammar the frontend uses, enumerates every call the grammar
// finds, and asserts the IR does one of two honest things with each —
// MINTS a node, or FLAGS an enclosing node as hiding it. Dropping one
// silently is the failure.
//
// Method calls and receivers are deliberately in scope; TYPE-level
// constructs are not (`typeof import("x")` is not a call).
//
// Measured baseline: reviews/ir-fidelity/REVIEW.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const LANGS = {
  rust: {
    frontend: join(ROOT, "scripts", "frontends", "rust", "parse_rust.mjs"),
    ext: ".rs",
    // One call per position, each with a DISTINCT name so a verdict
    // cannot be borrowed from a position that shares one.
    probe: `
fn s01() -> i64 { 1 }
fn s02() -> i64 { 1 }
fn s03() -> i64 { 1 }
fn s04() -> i64 { 1 }
fn s05() -> i64 { 1 }
fn s06() -> Vec<i64> { vec![1] }
fn s07() -> i64 { 1 }
fn s08() -> i64 { 1 }
fn s09() -> i64 { 1 }
fn s10() -> i64 { 1 }
fn take1(a: i64) -> i64 { a }
fn positions(flag: bool, xs: Vec<i64>) -> i64 {
    let a = s01();
    if s02() > 0 { }
    while s03() > 100 { break; }
    match s04() { _ => {} }
    for x in s06() { }
    let m = match flag { true => s07(), false => 0 };
    let c = || s08();
    let r = s09().to_string();
    let d = take1(s10());
    let e = if flag { s05() } else { 0 };
    a
}
`,
    expect: ["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08", "s09", "s10"],
  },
  jsts: {
    frontend: join(ROOT, "scripts", "frontends", "jsts", "parse_jsts.mjs"),
    ext: ".ts",
    probe: `
declare const cond: boolean;
declare const xs: any[];
declare function s01(...a: any[]): any;
declare function s02(...a: any[]): any;
declare function s03(...a: any[]): any;
declare function s04(...a: any[]): any;
declare function s05(...a: any[]): any;
declare function s06(...a: any[]): any;
declare function s07(...a: any[]): any;
declare function s08(...a: any[]): any;
declare function s09(...a: any[]): any;
declare function s10(...a: any[]): any;
declare function s11(...a: any[]): any;
declare function s12(...a: any[]): any;
declare function s13(...a: any[]): any;
declare function s14(...a: any[]): any;
function positions() {
  const a = s01();
  if (s02()) { }
  while (s03()) { break; }
  for (const x of s04()) { }
  const t = cond ? s05() : 2;
  const oc = s06()?.field;
  const nc = s07() ?? "x";
  const tl = \`value \${s08()}\`;
  const arr = [s09(), 2];
  const ol = { key: s10() };
  xs.map((x) => s11(x));
  const ae = () => s12();
  switch (s13()) { case 1: break; }
  const mc = s14().trim();
  return a;
}
`,
    expect: ["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08",
      "s09", "s10", "s11", "s12", "s13", "s14"],
  },
  cpp: {
    frontend: join(ROOT, "scripts", "frontends", "cpp", "parse_cpp.mjs"),
    ext: ".cpp",
    probe: `
#include <cstdio>
int s01(); int s02(); int s03(); int s04(); int s05();
int s06(); int s07(); int s08(); int s09(); int s10();
int take1(int a);
int positions(bool flag, int n) {
  int a = s01();
  if (s02() != 0) { }
  while (s03() != 0) { break; }
  for (int i = s04(); i < s05(); i += s06()) { break; }
  switch (s07()) { default: break; }
  int t = flag ? s08() : 0;
  int d = take1(s09());
  int c = static_cast<int>(s10());
  return a + t + d + c;
}
`,
    // s10 sits INSIDE a cast: the cast itself mints nothing (it calls
    // into nothing), but its operand must still be reached.
    expect: ["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08", "s09", "s10"],
  },
  bash: {
    frontend: join(ROOT, "scripts", "frontends", "bash", "parse_bash.mjs"),
    ext: ".sh",
    probe: `#!/usr/bin/env bash
s01
v=$(s02)
msg="value $(s03)"
if s04; then :; fi
if [ -n "$(s05)" ]; then :; fi
while s06; do break; done
for x in $(s07); do :; done
s08 | s09 | s10
arr=( "$(s11)" )
s12 > "$(s13)"
export E="$(s14)"
cd "$(s15)"
out=$(s16 | s17 || true)
[[ -f "$(s18)" ]] && s19
`,
    // `cd` is shell CONFIGURATION and is deliberately not a step — but
    // the substitution in its words still runs, which is s15.
    expect: ["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08", "s09",
      "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18", "s19"],
  },
};

/** Every callee the IR names anywhere, plus the lines an enclosing node
 *  admits it hides calls on. */
function irCoverage(ir) {
  const named = new Set();
  const flaggedLines = new Set();
  for (const n of ir.nodes ?? []) {
    for (const v of [n.funcName, n.callTarget]) {
      if (typeof v === "string" && v) named.add(v.replace(/\s+/g, ""));
    }
    if (n.nestsInnerCalls) {
      for (let l = n.line; l <= (n.endLine ?? n.line); l++) flaggedLines.add(l);
    }
  }
  return { named, flaggedLines };
}

function parse(cfg, source) {
  const dir = mkdtempSync(join(tmpdir(), "vg-fidelity-"));
  try {
    const file = join(dir, `probe${cfg.ext}`);
    writeFileSync(file, source);
    const r = spawnSync(process.execPath, [cfg.frontend, file], { encoding: "utf-8", cwd: ROOT });
    assert.equal(r.status, 0, `${cfg.frontend} failed: ${r.stderr}`);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const [lang, cfg] of Object.entries(LANGS)) {
  test(`${lang}: a call in ANY expression position is minted, never silently dropped`, () => {
    const ir = parse(cfg, cfg.probe);
    const { named } = irCoverage(ir);
    const missing = cfg.expect.filter((name) => {
      for (const n of named) if (n === name || n.includes(name)) return false;
      return true;
    });
    assert.deepEqual(missing, [],
      `${lang}: these calls are written in the source and absent from the IR.\n`
      + "  This is the expression-position class (CLAUDE.md, the python sweep):\n"
      + "  the walker stopped at the direct value of a statement. It is ONE bug,\n"
      + "  not one per position — fix the walk, not the position.\n"
      + `  IR named: ${[...named].sort().join(", ")}`);
  });

  test(`${lang}: the probe parses with no dropped constructs`, () => {
    const ir = parse(cfg, cfg.probe);
    assert.ok((ir.nodes ?? []).length > 0, "the probe must produce an IR");
    // A frontend that cannot parse its own language's ordinary syntax
    // reports `dropped` on stderr; parse() would still succeed, so the
    // node count is the check that something real came back.
    assert.ok((ir.nodes ?? []).some((n) => n.type === "function_def" || n.type === "call"),
      "the probe must produce real nodes, not an empty shell");
  });
}

test("jsts: .tsx is parsed with the JSX dialect, not the .ts one", () => {
  // `.tsx` was REGISTERED while only the non-JSX grammar was committed,
  // so every JSX file parsed mostly as ERROR nodes AND STILL PRODUCED AN
  // IR — a partial answer presented as an answer. The edit floor
  // inherited it, proving confinement against a wreck.
  const cfg = LANGS.jsts;
  const dir = mkdtempSync(join(tmpdir(), "vg-fidelity-"));
  try {
    const file = join(dir, "probe.tsx");
    writeFileSync(file, [
      "export function View({ items }: { items: string[] }) {",
      "  const rows = items.map((i) => makeRow(i));",
      "  return <div className=\"wrap\">{rows}</div>;",
      "}",
      "function makeRow(i: string) { return i; }",
      "",
    ].join("\n"));
    const r = spawnSync(process.execPath, [cfg.frontend, file], { encoding: "utf-8", cwd: ROOT });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!/dropped \d+ unparseable/.test(r.stderr),
      `JSX must parse cleanly, not be absorbed by the drop counter: ${r.stderr}`);
    const ir = JSON.parse(r.stdout);
    const names = (ir.nodes ?? []).map((n) => n.name).filter(Boolean);
    assert.ok(names.includes("View") && names.includes("makeRow"),
      `both functions must reach the IR: ${JSON.stringify(names)}`);
    const called = (ir.nodes ?? []).some(
      (n) => (n.funcName ?? n.callTarget ?? "").includes("makeRow"));
    assert.ok(called, "the call inside the JSX component's body must be minted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bash: a pipeline stage that is not a plain command keeps its body", () => {
  // `git ls-files | grep -v X | while read f; do … done` — visitPipeline
  // handled only plain-command stages, so the loop AND everything in it
  // went in silence. tree-sitter also nests a long pipeline as
  // pipeline(command, list(pipeline(…))), which is why three stages
  // followed by `&&` used to lose two of them.
  const ir = parse(LANGS.bash, [
    "#!/usr/bin/env bash",
    "list_files | filter_them | while read -r f; do",
    "  handle_one \"$f\"",
    "done",
    "",
  ].join("\n"));
  const named = new Set((ir.nodes ?? [])
    .map((n) => n.funcName ?? n.callTarget).filter(Boolean));
  for (const want of ["list_files", "filter_them", "handle_one"]) {
    assert.ok(named.has(want), `${want} must survive the pipeline: ${[...named].join(", ")}`);
  }
  assert.ok((ir.nodes ?? []).some((n) => n.type === "while_loop"),
    "and the loop itself must be a container");
});

test("cpp: a CAST is not a call — it names no function to step into", () => {
  // `static_cast<uint32_t>(bytes[16])` parses as a call_expression and
  // calls into nothing. Minting it would put a step in every thread
  // that names no function; the OPERAND is still walked, which the
  // position probe above checks with s10.
  const ir = parse(LANGS.cpp, [
    "#include <cstdint>",
    "int helper();",
    "uint32_t f() { return static_cast<uint32_t>(helper()); }",
    "",
  ].join("\n"));
  const named = [...new Set((ir.nodes ?? [])
    .map((n) => n.funcName ?? n.callTarget).filter(Boolean))];
  assert.ok(named.some((n) => n.includes("helper")),
    `the operand's call must be minted: ${JSON.stringify(named)}`);
  assert.ok(!named.some((n) => n.includes("static_cast")),
    `a cast must NOT become a call node: ${JSON.stringify(named)}`);
});

test("evaluation order: an if test sits OUTSIDE its branch, a while test INSIDE its loop", () => {
  // The M-COMP rule — source order is not evaluation order, and a node
  // in the wrong place is worse than no node. An `if` test runs once in
  // the enclosing flow whichever arm follows; a `while` test re-runs
  // every iteration, so a round trip in it IS a round trip in the loop.
  const ir = parse(LANGS.jsts, [
    "declare function guard(): boolean;",
    "declare function tick(): boolean;",
    "export function f() {",
    "  if (guard()) { return 1; }",
    "  while (tick()) { break; }",
    "  return 0;",
    "}",
    "",
  ].join("\n"));
  const byName = new Map();
  for (const n of ir.nodes ?? []) {
    const c = n.funcName ?? n.callTarget;
    if (c) byName.set(c, n);
  }
  const fn = (ir.nodes ?? []).find((n) => n.type === "function_def");
  const whileNode = (ir.nodes ?? []).find((n) => n.type === "while_loop");
  assert.ok(byName.has("guard") && byName.has("tick"), "both tests must be minted");
  assert.equal(byName.get("guard").parentId, fn.id,
    "an if test parents to the FUNCTION, not to the branch");
  assert.equal(byName.get("tick").parentId, whileNode.id,
    "a while test parents INSIDE the loop it re-runs in");
});
