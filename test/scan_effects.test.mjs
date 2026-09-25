// M-RUN SM3 floor — the authoritative server-side effect scan.
//
// Three contracts:
//   1. AUTHORITY (the whole point): for a pure-LOOKING helper that hides a
//      side effect one frame down, the CLIENT pre-gate (planRunToNode) says
//      runnable but the SERVER scan REFUSES. The server does not trust the
//      client's purity claim; it re-derives effects interprocedurally.
//   2. NO OVER-REFUSAL: a genuinely-pure transitive chain is allowed by both.
//   3. RESOLUTION PARITY: scan_effects.py and extract_thread.py resolve the
//      same fixture's call sites to the same targets. This is the drift guard
//      for the duplicated resolution logic (Option 1, consolidate at the 3rd
//      consumer — see scan_effects.py header).
//
// Run: npm run test:scan-effects

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { planRunToNode } from "../src/webview/threads/runToNode.ts";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));
const PYDEPS = join(ROOT, ".pydeps");
const PYENV = { ...process.env, PYTHONPATH: PYDEPS };
const PARSE = join(ROOT, "scripts", "parse_cst.py");
const EXTRACT = join(ROOT, "scripts", "extract_thread.py");
const SCAN = join(ROOT, "scripts", "scan_effects.py");
const LINK = join(ROOT, "scripts", "cross_file_link.py");

function py(script, args, input) {
  const r = spawnSync("python3", [script, ...args], { env: PYENV, encoding: "utf-8", cwd: ROOT, input });
  assert.equal(r.status, 0, `${script} failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// Parse a single fixture file into a one-file project IR map keyed by `name`.
function parseFixture(relPath, name) {
  const ir = py(PARSE, [join(ROOT, relPath), "--module-path", name.replace(/\.py$/, "")], "");
  return { [name]: ir };
}

const findAssign = (ir, varName) =>
  ir.nodes.find((n) => n.type === "assignment" && n.name === varName).id;

// ── 1. AUTHORITY — client allows, server refuses (the interprocedural gap) ──
test("hidden transitive effect: client ALLOWS but server REFUSES", () => {
  const files = parseFixture("test/fixtures/run_effects/hidden_effect.py", "hidden_effect.py");
  const ir = files["hidden_effect.py"];
  const stopId = findAssign(ir, "total"); // N = `total = n + 1` inside main

  // The CLIENT pre-gate, fed the REAL thread + IR, sees no effect in main's
  // own body and a resolved `step` into read_config → it says runnable.
  const thread = py(EXTRACT, ["--seed-file", "hidden_effect.py", "--seed-id", "module/main.fn"],
    JSON.stringify({ files }));
  const plan = planRunToNode({ irNodeId: stopId, file: "hidden_effect.py" }, files, thread);
  assert.equal(plan.runnable, true, "client pre-gate should (wrongly) allow — it never descends into read_config");

  // The SERVER scan follows the call into read_config and finds the fs effect.
  const verdict = py(SCAN, ["--stop-file", "hidden_effect.py", "--stop-id", stopId],
    JSON.stringify({ files }));
  assert.equal(verdict.pure, false, "server must refuse the hidden transitive effect");
  assert.equal(verdict.offending.kind, "effect");
  assert.equal(verdict.offending.effectKind, "fs");
  assert.equal(verdict.offending.file, "hidden_effect.py");
});

// ── 1b. §5.5 FLOOR SAFETY — return-type-inferred receiver: client allows,
//        server refuses (the one-hop resolution must not loosen the floor) ──
test("§5.5 inferred receiver: client ALLOWS but server REFUSES (floor not loosened)", () => {
  const files = parseFixture("test/fixtures/run_effects/inferred_receiver.py", "inferred_receiver.py");
  const ir = files["inferred_receiver.py"];
  // Link so the §5.5 viaReturnType edge is emitted (parse alone won't).
  const linked = py(LINK, [], JSON.stringify({ files }))["files"];
  const lir = linked["inferred_receiver.py"];
  const stopId = findAssign(lir, "total"); // N = `total = row_id + 1`, after c.execute

  // CLIENT pre-gate: c.execute now resolves to honest-external (not dynamic,
  // no effectKind), so the client sees nothing to refuse → allows.
  const thread = py(EXTRACT, ["--seed-file", "inferred_receiver.py", "--seed-id", "module/main.fn"],
    JSON.stringify({ files: linked }));
  const plan = planRunToNode({ irNodeId: stopId, file: "inferred_receiver.py" }, linked, thread);
  assert.equal(plan.runnable, true, "client allows — external boundary, no effectKind, not dynamic");

  // SERVER floor: the viaReturnType marker forces a conservative refuse —
  // the external sqlite3.Connection.execute method's purity is unprovable.
  const verdict = py(SCAN, ["--stop-file", "inferred_receiver.py", "--stop-id", stopId],
    JSON.stringify({ files: linked }));
  assert.equal(verdict.pure, false, "server must refuse a return-type-inferred external receiver");
  assert.equal(verdict.offending.kind, "external-unprovable");
});

// ── 1c. PLAN-v7 6a FLOOR FIX — with-item effects are no longer invisible ──
// Before 6a, parse_cst had no With visitor: `with open(...) as f:` emitted
// ZERO nodes, so the floor judged the path pure while it opened a file (found
// during the Stage-5 orchestrator gate; also blinded SM3). Both with-item
// forms must now refuse, and the as-binding must register as a LOCAL binding
// so `f.read()` reports honest `dynamic`, not `unresolved`. The scan is
// invoked seed-style with --list-effects — the exact call shape the changeset
// floor (changesetProposeCore) uses.
test("PLAN-v7 6a: with-item effect refuses; as-binding stays dynamic-honest", () => {
  const files = parseFixture("test/fixtures/run_effects/with_item_effect.py", "with_item_effect.py");
  const ir = files["with_item_effect.py"];

  // Parser contract: the as-bound with-item is an assignment (the runtime
  // semantics of `with open(p) as f:` — `f = open(p)` + enter/exit)…
  const fAssign = ir.nodes.find((n) => n.type === "assignment" && n.name === "f");
  assert.ok(fAssign, "with-item `as f` must emit an assignment node");
  assert.equal(fAssign.callTarget, "open");
  assert.equal(fAssign.effectKind, "fs");
  // …and the bare with-item is a call node.
  const bareCall = ir.nodes.find(
    (n) => n.type === "call" && n.funcName === "open" && n.id.startsWith("module/append_log.fn/"),
  );
  assert.ok(bareCall, "bare with-item call must emit a call node");
  assert.equal(bareCall.effectKind, "fs");

  // Floor contract: both forms REFUSE with the honest fs offense.
  for (const fn of ["read_config", "append_log"]) {
    const verdict = py(SCAN, ["--seed-file", "with_item_effect.py", "--seed-id", `module/${fn}.fn`, "--list-effects"],
      JSON.stringify({ files }));
    assert.equal(verdict.pure, false, `${fn}: the with-item fs effect must refuse`);
    const fsOffense = verdict.offenses.find((o) => o.kind === "effect" && o.effectKind === "fs");
    assert.ok(fsOffense, `${fn}: offense list must name the fs effect`);
    assert.equal(fsOffense.target, "open");
  }

  // Honesty contract: `f.read()` through the with-binding is DYNAMIC
  // (genuine runtime dispatch via a local binding), never `unresolved`.
  const verdict = py(SCAN, ["--seed-file", "with_item_effect.py", "--seed-id", "module/read_config.fn", "--list-effects"],
    JSON.stringify({ files }));
  const fRead = verdict.offenses.find((o) => o.target === "f.read");
  assert.ok(fRead, "f.read must appear in the offense list");
  assert.equal(fRead.kind, "dynamic", "with-binding receiver must be dynamic, not unresolved");

  // No over-refusal: the sibling pure function still passes.
  const pureVerdict = py(SCAN, ["--seed-file", "with_item_effect.py", "--seed-id", "module/pure_len.fn", "--list-effects"],
    JSON.stringify({ files }));
  assert.equal(pureVerdict.pure, true, "pure sibling must not be over-refused");

  // The sqlite rehearsal shape: `with sqlite3.connect(p) as conn:` refuses
  // as a db effect (6a classifier addition — connect creates the db file;
  // it previously scanned PURE).
  const dbVerdict = py(SCAN, ["--seed-file", "with_item_effect.py", "--seed-id", "module/init_db.fn", "--list-effects"],
    JSON.stringify({ files }));
  assert.equal(dbVerdict.pure, false, "with sqlite3.connect(...) as conn must refuse");
  const dbOffense = dbVerdict.offenses.find((o) => o.target === "sqlite3.connect");
  assert.ok(dbOffense, "offense list must name sqlite3.connect");
  assert.equal(dbOffense.effectKind, "db");
});

// ── 1d. PLAN-v7 6d pre-flight finding — builtin exception constructors are
//        pure: `raise ValueError(...)` must NOT refuse (it previously
//        classified "unresolved" and forced a needless consent gate). ──
// ── 1d. M-TRAINED floor fix — the CROSS-FILE leg must not escape the scan ──
// Found 2026-07-21 by the failing test:e2e-artifact gate assertion: the server
// fed the scan a relative-KEYED map whose edges kept ABSOLUTE targetFile
// values, so every cross-file reference resolved to a file "outside" the map
// and the scanner silently allowed it — an unsandboxed, ungated real run
// through predict.py's `open`. Two contracts, on the real artifact_demo
// fixture: (a) a consistent feed refuses on the transitive cross-file fs
// effect; (b) the inconsistent feed shape REFUSES (feed-inconsistency
// offense) instead of scanning past the cross-file boundary.
test("cross-file effect refuses; absolute-targetFile feed fails safe", () => {
  const dir = "test/fixtures/threads/artifact_demo";
  const files = {};
  for (const f of ["predict.py", "test_predict.py", "train.py"]) {
    Object.assign(files, parseFixture(join(dir, f), f));
  }
  const linked = py(LINK, [], JSON.stringify({ files }))["files"];
  const stopId = findAssign(linked["test_predict.py"], "result");

  // (a) Consistent relative keyspace: the scan walks test_predict → predict
  // → load_weights and refuses on the fs effect two files away.
  const verdict = py(SCAN, ["--stop-file", "test_predict.py", "--stop-id", stopId, "--list-effects"],
    JSON.stringify({ files: linked }));
  assert.equal(verdict.pure, false, "cross-file fs effect must refuse");
  assert.ok(verdict.offenses.some((o) => o.kind === "effect" && o.effectKind === "fs" && o.file === "predict.py"),
    `expected the fs offense from predict.py, got ${JSON.stringify(verdict.offenses)}`);

  // (b) The bug shape: same map, but reference edges carry absolute
  // targetFile paths that match no key. Must refuse (unresolvable callee),
  // never report pure.
  const inconsistent = Object.fromEntries(Object.entries(linked).map(([k, ir]) => [k, {
    ...ir,
    edges: ir.edges.map((e) =>
      e.targetFile ? { ...e, targetFile: join(ROOT, dir, e.targetFile) } : e),
  }]));
  const v2 = py(SCAN, ["--stop-file", "test_predict.py", "--stop-id", stopId, "--list-effects"],
    JSON.stringify({ files: inconsistent }));
  assert.equal(v2.pure, false, "an unmatched targetFile must fail safe, not scan past the boundary");
  assert.ok(v2.offenses.some((o) => o.kind === "unresolved" && o.target === "predict"),
    `expected an unresolved feed-inconsistency offense, got ${JSON.stringify(v2.offenses)}`);
});

test("PLAN-v7 6d: raising builtin exceptions stays pure — no over-refusal", () => {
  const files = parseFixture("test/fixtures/run_effects/exc_pure.py", "exc_pure.py");
  const verdict = py(SCAN, ["--seed-file", "exc_pure.py", "--seed-id", "module/guarded_half.fn", "--list-effects"],
    JSON.stringify({ files }));
  assert.equal(verdict.pure, true, `guarded_half must scan pure (offenses: ${JSON.stringify(verdict.offenses)})`);
});

// ── 2. NO OVER-REFUSAL — a genuinely pure chain is allowed by both ──
test("genuinely pure transitive chain: both client and server allow", () => {
  const files = parseFixture("test/fixtures/run_effects/pure_chain.py", "pure_chain.py");
  const ir = files["pure_chain.py"];
  const stopId = findAssign(ir, "result");

  const thread = py(EXTRACT, ["--seed-file", "pure_chain.py", "--seed-id", "module/compute.fn"],
    JSON.stringify({ files }));
  const plan = planRunToNode({ irNodeId: stopId, file: "pure_chain.py" }, files, thread);
  assert.equal(plan.runnable, true);

  const verdict = py(SCAN, ["--stop-file", "pure_chain.py", "--stop-id", stopId],
    JSON.stringify({ files }));
  assert.equal(verdict.pure, true, `server should allow a pure chain (got: ${verdict.reason})`);
  assert.equal(verdict.offending, null);
});

// ── 3. RESOLUTION PARITY — scan and extractor resolve calls identically ──
// Drift guard for the duplicated resolution logic. aero_demo exercises every
// terminal kind (step / external / dynamic / unresolved), so it is the strong
// case. We compare per call-site (callId): kind, and the resolved target for
// steps. Non-call-site thread constructs (synthetic `return`, `container`
// arms) are excluded — they are rendering artifacts, not resolution.
test("resolution parity with extract_thread.py on aero_demo", () => {
  const irRaw = readFileSync(join(ROOT, "test/fixtures/threads/aero_demo/aero_demo.ir.json"), "utf-8");
  const seedArgs = ["--seed-file", "main.py", "--seed-id", "module/compute_drag.fn"];

  // Scanner's full resolution map (walk everything, don't short-circuit).
  const scanRes = py(SCAN, [...seedArgs, "--resolution-only"], irRaw).resolution;
  const fromScan = new Map();
  for (const r of scanRes) {
    const kind = r.kind === "viaLocal-external" ? "external" : r.kind; // boundary, same as extractor
    fromScan.set(r.callId, kind === "step" ? `step:${r.targetId}` : kind);
  }

  // Extractor's resolution, derived from its edges (irSource = call-site id).
  const thread = py(EXTRACT, seedArgs, irRaw);
  const byId = new Map(thread.nodes.map((n) => [n.id, n]));
  const fromExtract = new Map();
  for (const e of thread.edges) {
    if (e.kind === "contains" || !e.irSource) continue;
    const to = byId.get(e.to) || {};
    if (to.kind === "return" || to.kind === "container") continue; // not a call resolution
    fromExtract.set(e.irSource, to.kind === "step" ? `step:${to.irNodeId}` : to.kind);
  }

  assert.deepEqual(
    Object.fromEntries([...fromScan].sort()),
    Object.fromEntries([...fromExtract].sort()),
    "scan_effects.py and extract_thread.py diverged on call resolution — the duplicated resolution logic has drifted.",
  );
});

// ── 4. IMPORT-TIME EFFECTS (2026-09-10) ──────────────────────────────
//
// `Scan.visit` walks the entry function's SUBTREE. A module-level statement
// is not a descendant of any function, so it was never scanned — while
// run_to_node.py executes the module with `runpy.run_path`, which runs the
// whole top level. Measured both ways against this very script before the
// fix: `DB = sqlite3.connect(...)` at module level came back pure=True.
//
// No exotic syntax is needed to hit this. It is simply how a project holds a
// connection or a client.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

/** Parse several sources into one project IR map, each with its modulePath —
 *  which is what lets the scan follow an import to the file it names. */
function parseProject(sources) {
  const dir = mkdtempSync(join(tmpdir(), "vg-importtime-"));
  const files = {};
  for (const [name, src] of Object.entries(sources)) {
    const abs = join(dir, name.replace(/\//g, "_"));
    writeFileSync(abs, src, "utf-8");
    files[name] = py(PARSE, [abs, "--module-path", name.replace(/\.py$/, "").replace(/\//g, ".")], "");
  }
  return files;
}

const lastReturn = (ir) => ir.nodes.filter((n) => n.type === "return_stmt").pop().id;

test("a MODULE-LEVEL effect is on the path — it runs before the entry function does", () => {
  const files = parseProject({
    "app.py": "import sqlite3\n\n\nDB = sqlite3.connect('prod.db')\n\n\ndef run():\n    return 0\n",
  });
  const v = py(SCAN, ["--stop-file", "app.py", "--stop-id", lastReturn(files["app.py"]), "--list-effects"],
    JSON.stringify({ files }));
  assert.equal(v.pure, false, "module level runs on import — the floor must see it");
  assert.equal(v.offenses.length, 1);
  assert.equal(v.offenses[0].effectKind, "db");
  assert.equal(v.offenses[0].file, "app.py");
});

test("a CLASS BODY effect counts too — python runs it on import", () => {
  const files = parseProject({
    "app.py": "import sqlite3\n\n\nclass C:\n    DB = sqlite3.connect('prod.db')\n\n\ndef run():\n    return 0\n",
  });
  const v = py(SCAN, ["--stop-file", "app.py", "--stop-id", lastReturn(files["app.py"]), "--list-effects"],
    JSON.stringify({ files }));
  assert.equal(v.pure, false);
  assert.equal(v.offenses[0].effectKind, "db");
});

test("an IMPORTED module's top level is on the path too — import executes it", () => {
  const files = parseProject({
    "app.py": "from telemetry.store import fetch\n\n\ndef run():\n    return 0\n",
    "telemetry/store.py": "import sqlite3\n\n\nDB = sqlite3.connect('prod.db')\n\n\ndef fetch():\n    return 1\n",
  });
  // The import is never CALLED from run() — importing it is enough.
  const v = py(SCAN, ["--stop-file", "app.py", "--stop-id", lastReturn(files["app.py"]), "--list-effects"],
    JSON.stringify({ files }));
  assert.equal(v.pure, false, "a module imported but never called still runs its top level");
  assert.equal(v.offenses[0].file, "telemetry/store.py");
});

test("an effect INSIDE a function is not import-time — it runs when called", () => {
  // The distinction has to hold both ways, or every project with a helper
  // would refuse on import-time grounds it never earned.
  const files = parseProject({
    "app.py": "import sqlite3\n\n\ndef helper():\n    return sqlite3.connect('x')\n\n\ndef run():\n    return 0\n",
  });
  const v = py(SCAN, ["--stop-file", "app.py", "--stop-id", lastReturn(files["app.py"]), "--list-effects"],
    JSON.stringify({ files }));
  assert.equal(v.pure, true, "run() never calls helper(), and helper's body does not run on import");
});

test("a THIRD-PARTY import resolves to nothing and is skipped — no false refusal", () => {
  const files = parseProject({
    "app.py": "import os\nimport flask\nfrom collections import OrderedDict\n\n\ndef run():\n    return 0\n",
  });
  const v = py(SCAN, ["--stop-file", "app.py", "--stop-id", lastReturn(files["app.py"]), "--list-effects"],
    JSON.stringify({ files }));
  assert.equal(v.pure, true, "their side effects are not ours to scan, and never were");
});

test("the GATE mode refuses too, and says the effect is at import time", () => {
  const files = parseProject({
    "app.py": "import sqlite3\n\n\nDB = sqlite3.connect('prod.db')\n\n\ndef run():\n    return 0\n",
  });
  const v = py(SCAN, ["--stop-file", "app.py", "--stop-id", lastReturn(files["app.py"])],
    JSON.stringify({ files }));
  assert.equal(v.pure, false);
  assert.match(v.reason, /IMPORT time/);
  assert.match(v.reason, /before the entry function does/);
});

// ── 5. EVERY EXPRESSION POSITION (M-SWEEP W1, 2026-09-10) ────────────
//
// The parser emitted a call node only when the call was the DIRECT value
// of a statement, so 20 of 30 in-function positions produced NO node and
// the floor could not see them. It was one bug, not twenty: nothing walked
// INTO a composite expression, which is why `with`, then `if`/`while`,
// were each patched individually and the class kept coming back.
//
// These pin the positions that leaked, one representative per FAMILY. The
// point is not the individual cases — it is that a call anywhere in an
// expression reaches the floor, so the class cannot quietly reopen.

const EFFECT = 'requests.post("u", json={})';

/** A one-function module whose body is `lines`, ending in `return 0`. */
function bodyIr(lines) {
  const src = `import requests\n\n\ndef run():\n${lines.map((l) => `    ${l}`).join("\n")}\n    return 0\n`;
  const dir = mkdtempSync(join(tmpdir(), "vg-w1-"));
  const abs = join(dir, "m.py");
  writeFileSync(abs, src, "utf-8");
  return py(PARSE, [abs, "--module-path", "m"], "");
}

const POSITIONS = {
  "comprehension element": [`xs = [${EFFECT} for _ in range(2)]`],
  "comprehension iterable": [`xs = [x for x in ${EFFECT}]`],
  "dict-comprehension value": [`d = {k: ${EFFECT} for k in range(2)}`],
  "generator inside a call": [`g = list(${EFFECT} for _ in range(2))`],
  "for iterable": [`for x in ${EFFECT}:`, "    pass"],
  "assert": [`assert ${EFFECT}`],
  "boolean short-circuit": [`x = False or ${EFFECT}`],
  "ternary branch": [`x = 1 if True else ${EFFECT}`],
  "f-string interpolation": [`s = f"{${EFFECT}}"`],
  "list-literal element": [`xs = [${EFFECT}]`],
  "dict-literal value": [`d = {"k": ${EFFECT}}`],
  "starred argument": [`x = max(*[${EFFECT}])`],
  "chained comparison": [`x = 0 < len(${EFFECT}) < 9`],
  "unary not": [`x = not ${EFFECT}`],
  "slice bound": ["xs = [1, 2, 3]", `y = xs[:len(${EFFECT})]`],
  "lambda body": [`fn = lambda: ${EFFECT}`, "fn()"],
  "tuple return": [`return ${EFFECT}, 201`],
};

for (const [name, lines] of Object.entries(POSITIONS)) {
  test(`W1: an effectful call in a ${name} reaches the floor`, () => {
    const ir = bodyIr(lines);
    const files = { "m.py": ir };
    const stop = ir.nodes.filter((n) => n.type === "return_stmt").pop();
    const v = py(SCAN, ["--stop-file", "m.py", "--stop-id", stop.id, "--list-effects"],
      JSON.stringify({ files }));
    assert.equal(v.pure, false, `${name}: the floor must see this call`);
    assert.ok(v.offenses.some((o) => o.effectKind === "http"),
      `${name}: expected the http effect, got ${JSON.stringify(v.offenses)}`);
  });
}

test("W1: a DEF-TIME call parents OUTSIDE the function, where it runs", () => {
  // A parameter default runs when the `def` executes — at import — even if
  // the function is never called. Filed inside the function it would be
  // invisible twice over: import_time_offenses skips anything inside a
  // function, and an uncalled helper is in no entry function's subtree.
  const dir = mkdtempSync(join(tmpdir(), "vg-w1-def-"));
  const abs = join(dir, "m.py");
  writeFileSync(abs, `import requests\n\n\ndef helper(x=${EFFECT}):\n    return x\n\n\ndef run():\n    return 0\n`, "utf-8");
  const ir = py(PARSE, [abs, "--module-path", "m"], "");
  const effect = ir.nodes.find((n) => n.effectKind === "http");
  assert.ok(effect, "the default-argument call must be a node");
  assert.ok(!effect.id.includes(".fn/"),
    `a def-time call belongs at module scope, got ${effect.id}`);
  // And the floor sees it even though `helper` is never called.
  const stop = ir.nodes.filter((n) => n.type === "return_stmt" && n.id.startsWith("module/run.fn")).pop();
  const v = py(SCAN, ["--stop-file", "m.py", "--stop-id", stop.id, "--list-effects"],
    JSON.stringify({ files: { "m.py": ir } }));
  assert.equal(v.pure, false, "an uncalled helper's default still runs on import");
});

test("W1: nesting is unchanged — a nested call is a NEST, not a second node", () => {
  // The sweep fires at depth 1 only. `f(g())` keeps its existing shape:
  // one node for the outer call with g minted beneath it, never two
  // sibling nodes — which would change what `nests` means everywhere.
  // A bare expression statement, so visit_Expr emits a `call` node (an
  // assignment would emit an `assignment` node carrying callTarget instead).
  const ir = bodyIr(["len(str(3))"]);
  const outer = ir.nodes.filter((n) => n.type === "call" && n.funcName === "len");
  assert.equal(outer.length, 1, "one node for the outermost call");
  assert.equal(outer[0].nestsInnerCalls, true, "and the nest is stamped, as before");
  assert.equal(ir.nodes.filter((n) => n.funcName === "str" && n.parentId === outer[0].id).length, 1,
    "the inner call is minted BENEATH the outer one, not beside it");
});
