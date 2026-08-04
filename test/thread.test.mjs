// Thread extractor tests (M4b wave 2).
//
// 1. Snapshot — extract_thread.py output on the aero_demo project IR
//    must equal the committed thread fixture.
// 2. Shape invariants — every kind of ambiguity marker the renderer
//    will draw (conditional edges, external terminals, dynamic
//    terminals, the return-shape terminal) must be present, so a
//    fixture edit can't silently lose them.
//
// Run: npm run test:thread

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));

const AERO_DIR = join(ROOT, "test", "fixtures", "threads", "aero_demo");
const AERO_IR = join(AERO_DIR, "aero_demo.ir.json");
const AERO_THREAD = join(AERO_DIR, "aero_demo.thread.json");
const FLASK_DIR = join(ROOT, "test", "fixtures", "threads", "flask_demo");
const FLASK_IR = join(FLASK_DIR, "flask_demo.ir.json");
const INSERT_THREAD = join(FLASK_DIR, "insert.thread.json");
const EXC_DIR = join(ROOT, "test", "fixtures", "threads", "exc_demo");
const EXC_IR = join(EXC_DIR, "exc_demo.ir.json");
const EXC_THREAD = join(EXC_DIR, "run_job.thread.json");
const EXC_SEED_FILE = "jobs.py";
const EXC_SEED_ID = "module/run_job.fn";
const FLASK_IR_PATH = join(ROOT, "test", "fixtures", "threads", "flask_demo", "flask_demo.ir.json");
const EXTRACTOR = join(ROOT, "scripts", "extract_thread.py");
const PYDEPS = join(ROOT, ".pydeps");

const SEED_FILE = "main.py";
const SEED_ID = "module/compute_drag.fn";
const INSERT_SEED_FILE = "db.py";
const INSERT_SEED_ID = "module/insert.fn";

function runExtractor(irPath, seedFile, seedId) {
  return runExtractorOnIr(readFileSync(irPath, "utf-8"), seedFile, seedId);
}

/** Same, but over an in-memory project IR — for pinning a branch no
 *  committed fixture exercises (see the M-FS8 linker-miss test). */
function runExtractorOnIr(ir, seedFile, seedId) {
  const r = spawnSync(
    "python3",
    [EXTRACTOR, "--seed-file", seedFile, "--seed-id", seedId],
    { env: { ...process.env, PYTHONPATH: PYDEPS }, encoding: "utf-8", cwd: ROOT, input: typeof ir === "string" ? ir : JSON.stringify(ir) },
  );
  assert.equal(r.status, 0, `extractor failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

test("extract_thread.py output matches aero_demo.thread.json (snapshot)", () => {
  const actual = runExtractor(AERO_IR, SEED_FILE, SEED_ID);
  const expected = JSON.parse(readFileSync(AERO_THREAD, "utf-8"));

  assert.deepStrictEqual(
    actual,
    expected,
    "Live thread extractor output differs from committed snapshot. Either the extractor changed (regenerate the snapshot if intentional) or the snapshot is stale.",
  );
});

test("aero_demo thread carries every ambiguity marker the renderer draws", () => {
  const thread = runExtractor(AERO_IR, SEED_FILE, SEED_ID);

  // 1. Seed node is present and tagged.
  const seed = thread.nodes.find((n) => n.kind === "seed");
  assert.ok(seed, "thread missing seed node");
  assert.equal(seed.id, "main:compute_drag");

  // 2. All five cross-file steps from compute_drag are present.
  const expectedSteps = [
    "data:fetch_state",
    "data:load_aircraft_config",
    "processing:normalize_conditions",
    "processing:apply_correction_factor",
    "registry:select_model",
  ];
  for (const sid of expectedSteps) {
    const n = thread.nodes.find((x) => x.id === sid && x.kind === "step");
    assert.ok(n, `thread missing step node ${sid}`);
  }

  // 3. Same-file step (density_from_temperature) was resolved — the
  //    extractor's local-name lookup is the M4a-linker gap-filler.
  const dft = thread.nodes.find((n) => n.id === "processing:density_from_temperature");
  assert.ok(dft, "thread missing same-file step density_from_temperature");
  assert.equal(dft.kind, "step", "density_from_temperature must classify as step, not dynamic");

  // 4. Dynamic-dispatch terminal: drag_coeff = model(...) is a runtime
  //    value call -- `model` is a LOCAL binding invoked at runtime, so
  //    this is GENUINE runtime dispatch. Renderer marks it "dynamic".
  const dyn = thread.nodes.find((n) => n.kind === "dynamic" && n.label === "model");
  assert.ok(dyn, "thread missing dynamic terminal for model(...)");

  // 4b. R3 — resolution-gap terminal: audit_drag(...) is a bare name that
  //     is neither a local binding nor resolvable, so it must classify as
  //     `unresolved` (a resolution gap), NEVER `dynamic` (runtime). This
  //     is the honesty split: "couldn't find it" must not read as
  //     "runtime-determined".
  const unres = thread.nodes.find((n) => n.kind === "unresolved" && n.label === "audit_drag");
  assert.ok(unres, "thread missing unresolved terminal for audit_drag(...)");
  assert.equal(unres.id, "unresolved:audit_drag", "unresolved id must be kind-prefixed");
  assert.ok(
    !thread.nodes.some((n) => n.kind === "dynamic" && n.label === "audit_drag"),
    "audit_drag must NOT be mislabeled dynamic",
  );

  // 5. External terminal: json.loads (library boundary inside
  //    load_aircraft_config). §5.5a — conditions.get is NO LONGER here:
  //    its receiver is a parameter, so it's honest `dynamic` dispatch
  //    (see the dedicated §5.5a test below), not a failed external import.
  const json = thread.nodes.find((n) => n.id === "external:json.loads");
  assert.ok(json, "thread missing external terminal json.loads");
  const condGet = thread.nodes.find((n) => n.id === "dynamic:conditions.get");
  assert.ok(condGet, "thread missing dynamic terminal conditions.get (param receiver)");
  assert.ok(
    !thread.nodes.some((n) => n.id === "external:conditions.get"),
    "conditions.get must NOT remain an external terminal",
  );
});

// §A — repeated call SITES are distinct ordered events, project-wide (not just
// PyTorch forward). `conditions.get` is called TWICE in normalize_conditions;
// it must surface as two distinct terminals (first bare id, repeat `@k`), each
// carrying its own real call-site irNodeId — never collapsed to one node.
test("§A: a repeated terminal de-collapses to one node per call site", () => {
  const thread = runExtractor(AERO_IR, SEED_FILE, SEED_ID);
  const gets = thread.nodes.filter((n) => n.label === "conditions.get");
  assert.equal(gets.length, 2, "conditions.get is called at 2 sites → 2 distinct terminals");
  // Additive id scheme: first occurrence bare, repeat suffixed.
  const ids = gets.map((n) => n.id).sort();
  assert.deepStrictEqual(ids, ["dynamic:conditions.get", "dynamic:conditions.get@1"]);
  // Each terminal is navigable — a real, distinct call-site irNodeId (no None).
  for (const n of gets) {
    assert.ok(n.irNodeId && n.irNodeId.startsWith("module/"), `terminal ${n.id} must carry a real call-site irNodeId`);
  }
  assert.notEqual(gets[0].irNodeId, gets[1].irNodeId, "the two sites must reference distinct IR nodes");

  // 6. Return-shape terminal anchored to the seed.
  const ret = thread.nodes.find((n) => n.kind === "return");
  assert.ok(ret, "thread missing return-shape terminal");
  assert.equal(ret.irNodeId, "module/compute_drag.fn/return@0");

  // 7. At least one conditional edge -- proves the if_stmt detection
  //    surfaced the renderer's dashed-edge marker.
  const conditionalEdges = thread.edges.filter((e) => e.kind === "conditional");
  assert.ok(
    conditionalEdges.length >= 1,
    `expected >=1 conditional edge from normalize_conditions; got ${conditionalEdges.length}`,
  );
  for (const e of conditionalEdges) {
    assert.equal(
      e.from,
      "processing:normalize_conditions",
      `conditional edge from unexpected source: ${e.from}`,
    );
  }
});

test("extract_thread.py output matches flask_demo:insert.thread.json (snapshot)", () => {
  // M17.2 pin: insert() wraps conn.execute / conn.commit / return in a
  // try block and conn.close in a finally block. The thread must surface
  // both as `container` nodes with the matching containerKind, and emit
  // `contains` edges from each container to every call/return inside it.
  const actual = runExtractor(FLASK_IR, INSERT_SEED_FILE, INSERT_SEED_ID);
  const expected = JSON.parse(readFileSync(INSERT_THREAD, "utf-8"));
  assert.deepStrictEqual(
    actual,
    expected,
    "Live thread extractor output differs from committed insert.thread.json snapshot.",
  );
});

test("flask_demo:insert thread carries try + finally container nodes (M17.2)", () => {
  // Shape pin: a future regression that drops container emission, or
  // forgets to chain returns through emit_container_chain, fails here
  // even if the snapshot was re-regenerated against a broken extractor.
  const thread = runExtractor(FLASK_IR, INSERT_SEED_FILE, INSERT_SEED_ID);

  const tryNode = thread.nodes.find(
    (n) => n.kind === "container" && n.containerKind === "try",
  );
  assert.ok(tryNode, "thread missing try container node");
  assert.equal(tryNode.irNodeId, "module/insert.fn/try@0");

  const finallyNode = thread.nodes.find(
    (n) => n.kind === "container" && n.containerKind === "finally",
  );
  assert.ok(finallyNode, "thread missing finally container node");
  assert.equal(finallyNode.irNodeId, "module/insert.fn/finally@0");

  // try contains conn.execute, conn.commit, and the return.
  const tryContains = thread.edges
    .filter((e) => e.from === tryNode.id && e.kind === "contains")
    .map((e) => e.to)
    .sort();
  // R4 — conn.* terminals reclassified external → dynamic (runtime-bound
  // local receiver); the containment shape itself is unchanged.
  assert.deepStrictEqual(
    tryContains,
    ["db:insert:return@0", "dynamic:conn.commit", "dynamic:conn.execute"],
    "try container should contain conn.execute + conn.commit + return",
  );

  // finally contains conn.close only.
  const finallyContains = thread.edges
    .filter((e) => e.from === finallyNode.id && e.kind === "contains")
    .map((e) => e.to);
  assert.deepStrictEqual(
    finallyContains,
    ["dynamic:conn.close"],
    "finally container should contain conn.close",
  );

  // M17.2 invariant: existing direct edges from seed are preserved.
  // The renderer overlays containers on top — it doesn't replace the
  // function→call edges.
  const directFromSeed = thread.edges.filter(
    (e) => e.from === "db:insert" && e.kind === "direct",
  );
  assert.ok(
    directFromSeed.length >= 4,
    `expected >=4 direct edges from seed (got ${directFromSeed.length})`,
  );
});

test("extractor stops at cycles without infinite recursion", () => {
  // Build a tiny synthetic project with a self-referential call. If the
  // visited-set isn't enforcing termination, this hangs the test.
  const ir = {
    "loop.py": {
      version: "1.1",
      modulePath: "loop",
      nodes: [
        { id: "module/loop.fn", type: "function_def", parentId: null,
          line: 1, endLine: 4, col: 0, endCol: 9, name: "loop", params: [], docstring: null },
        { id: "module/loop.fn/x.assign", type: "assignment", parentId: "module/loop.fn",
          line: 2, endLine: 2, col: 4, endCol: 11, name: "x",
          valueKind: "call", preview: "loop()", callTarget: "loop" },
      ],
      edges: [
        { type: "contains", source: "module/loop.fn", target: "module/loop.fn/x.assign" },
      ],
      symbolIndex: [],
    },
  };
  const r = spawnSync(
    "python3",
    [EXTRACTOR, "--seed-file", "loop.py", "--seed-id", "module/loop.fn"],
    {
      env: { ...process.env, PYTHONPATH: PYDEPS },
      encoding: "utf-8",
      cwd: ROOT,
      input: JSON.stringify({ files: ir }),
      timeout: 5000,
    },
  );
  assert.equal(r.status, 0, `extractor failed on cycle: ${r.stderr}`);
  const thread = JSON.parse(r.stdout);
  // Self-call must produce exactly one node (visited dedupes) and a
  // single self-edge -- the back-edge to the seed.
  const loopNodes = thread.nodes.filter((n) => n.id === "loop:loop");
  assert.equal(loopNodes.length, 1, "cycle must dedupe to one thread node");
  const selfEdges = thread.edges.filter(
    (e) => e.from === "loop:loop" && e.to === "loop:loop",
  );
  assert.equal(selfEdges.length, 1, "expected one self-edge on the cycle");
});

// R4 — head-local receiver honesty. A dotted call whose receiver is a
// local binding (`conn = _get_conn(); conn.execute(...)`) is GENUINE
// runtime dispatch: kind must be `dynamic` (never `external`, which sent
// the M13 resolver chasing a module named `conn` and surfacing "base
// module 'conn' is not importable"). The terminal carries
// `receiverBoundFrom` — the callee that bound the receiver — so the
// renderer can state the honest reason.
test("R4: dotted call on a local-bound receiver is dynamic, with receiverBoundFrom", () => {
  const thread = runExtractor(FLASK_IR, INSERT_SEED_FILE, INSERT_SEED_ID);

  // BEHAVIOUR: each conn.* terminal in db.py:insert is dynamic and
  // records that its receiver came from _get_conn.
  for (const method of ["execute", "commit", "close"]) {
    const node = thread.nodes.find((n) => n.label === `conn.${method}`);
    assert.ok(node, `thread missing conn.${method} terminal`);
    assert.equal(node.kind, "dynamic",
      `conn.${method} must be dynamic (runtime-bound local receiver), got ${node.kind}`);
    assert.equal(node.id, `dynamic:conn.${method}`);
    assert.equal(node.receiverBoundKind, "local-call",
      `conn.${method} must carry receiverBoundKind=local-call`);
    assert.equal(node.receiverBoundFrom, "_get_conn",
      `conn.${method} must carry receiverBoundFrom=_get_conn for the honest tooltip line`);
  }

  // The old dishonest shape must be gone entirely.
  const lying = thread.nodes.filter((n) => n.id.startsWith("external:conn."));
  assert.deepStrictEqual(lying, [], "external:conn.* terminals must not exist");
});

// §5.5a — a dotted call on a PARAMETER-bound receiver is honest dynamic
// dispatch, not a failed external import. `conditions.get` in aero's
// normalize_conditions (where `conditions` is a parameter) must classify
// `dynamic` with `receiverBoundKind: "param"` and NO binding callee. A
// dotted call on a genuinely-imported module (`json.loads`) stays
// `external` — the head-check must not over-sweep it.
test("§5.5a: param-bound receiver is dynamic; imported-module call stays external", () => {
  const thread = runExtractor(AERO_IR, SEED_FILE, SEED_ID);

  const param = thread.nodes.find((n) => n.label === "conditions.get");
  assert.ok(param, "thread missing conditions.get terminal");
  assert.equal(param.kind, "dynamic",
    `conditions.get (param receiver) must be dynamic, got ${param.kind}`);
  assert.equal(param.id, "dynamic:conditions.get");
  assert.equal(param.receiverBoundKind, "param",
    "conditions.get must carry receiverBoundKind=param");
  assert.equal(param.receiverBoundFrom, undefined,
    "a param-bound receiver has no binding callee, so no receiverBoundFrom");

  const mod = thread.nodes.find((n) => n.label === "json.loads");
  assert.ok(mod, "thread missing json.loads terminal");
  assert.equal(mod.kind, "external", `json.loads must stay external, got ${mod.kind}`);
  assert.equal(mod.receiverBoundKind, undefined,
    "json.loads is not a local binding — no receiverBoundKind");
});

// M24 — container logic-joins. Visual grammar: SOLID = always joins
// (kind "flow", label "always"), DASHED = conditional entry (fork
// arrows reuse kind "conditional", no label — an arrow into an arm must
// never claim the arm always executes). Assertions pin exact edge
// source/target ids + kind + label, not mere presence.
test("M24: try→finally emits a flow join with label 'always'", () => {
  const thread = runExtractor(FLASK_IR, INSERT_SEED_FILE, INSERT_SEED_ID);
  const flows = thread.edges.filter((e) => e.kind === "flow");
  assert.deepStrictEqual(flows, [{
    from: "db:insert.fn/try@0",
    to: "db:insert.fn/finally@0",
    kind: "flow",
    irSource: "module/insert.fn/finally@0",
    label: "always",
  }], "insert thread must carry exactly one flow join, try→finally");
});

test("M24: if forks — predecessor → both arms, nested elif composes via the else container", () => {
  const thread = runExtractor(FLASK_IR, "cli.py", "module/main.fn");

  const forks = thread.edges.filter(
    (e) => e.kind === "conditional" && e.to.includes("#"),
  );
  // Outer if: predecessor = the last same-scope call before it in
  // source order (args = parser.parse_args(), a via-local terminal).
  // Dashed arrows into BOTH arms; label must be absent — a fork arrow
  // never claims its arm always executes.
  const pred = "external:argparse.ArgumentParser.parse_args";
  const outerThen = forks.find((e) => e.to === "cli:main.fn/if@0#then");
  const outerElse = forks.find((e) => e.to === "cli:main.fn/if@0#else");
  assert.ok(outerThen, "missing fork into outer then arm");
  assert.ok(outerElse, "missing fork into outer else arm");
  assert.equal(outerThen.from, pred, "outer then fork must source from parse_args");
  assert.equal(outerElse.from, pred, "outer else fork must source from parse_args");
  assert.equal(outerThen.irSource, "module/main.fn/if@0");
  assert.ok(!("label" in outerThen), "fork arrows carry no label");
  assert.ok(!("label" in outerElse), "fork arrows carry no label");

  // Nested elif (if@0/if@0 sits inside the outer else arm): no
  // same-scope predecessor exists before it, so the fork sources from
  // its enclosing emitted container — the outer ELSE arm — never from
  // a node inside the sibling then arm.
  const nested = forks.find((e) => e.to === "cli:main.fn/if@0/if@0#then");
  assert.ok(nested, "missing fork into nested elif arm");
  assert.equal(nested.from, "cli:main.fn/if@0#else",
    "nested elif fork must source from the enclosing else container");
  assert.equal(nested.irSource, "module/main.fn/if@0/if@0");
  assert.ok(!("label" in nested), "fork arrows carry no label");

  // Exactly these three forks — no phantom arms.
  assert.equal(forks.length, 3, `expected 3 fork edges, got ${forks.length}`);

  // The try→finally join inside insert (reached via cmd_create) also
  // surfaces in this thread.
  const flows = thread.edges.filter((e) => e.kind === "flow");
  assert.deepStrictEqual(flows.map((e) => [e.from, e.to, e.label]), [
    ["db:insert.fn/try@0", "db:insert.fn/finally@0", "always"],
  ]);
});

test("M24: fork falls back to the function node when the if leads the body", () => {
  // aero normalize_conditions opens with its if — no predecessor call
  // exists, no enclosing container: fallback 2, the function node.
  const thread = runExtractor(AERO_IR, SEED_FILE, SEED_ID);
  const forks = thread.edges.filter(
    (e) => e.kind === "conditional" && e.to.includes("#"),
  );
  assert.deepStrictEqual(
    forks.map((e) => [e.from, e.to]),
    [
      ["processing:normalize_conditions", "processing:normalize_conditions.fn/if@0#then"],
      ["processing:normalize_conditions", "processing:normalize_conditions.fn/if@0#else"],
    ],
    "function-node fallback forks, then-arm first",
  );
  for (const f of forks) assert.ok(!("label" in f), "fork arrows carry no label");
});

// §5.6a — exception-path joins. exc_demo's run_job has a full
// try/except/finally, each band holding a call (on the `store`
// parameter — dynamic per §5.5a) so all three containers materialise.
test("extract_thread.py output matches exc_demo:run_job.thread.json (snapshot)", () => {
  const actual = runExtractor(EXC_IR, EXC_SEED_FILE, EXC_SEED_ID);
  const expected = JSON.parse(readFileSync(EXC_THREAD, "utf-8"));
  assert.deepStrictEqual(actual, expected,
    "Live extractor output differs from committed exc_demo snapshot — regenerate if intentional.");
});

test("§5.6a: try→except is 'on error', except→finally + try→finally are 'always'", () => {
  const thread = runExtractor(EXC_IR, EXC_SEED_FILE, EXC_SEED_ID);
  const tryId = "jobs:run_job.fn/try@0";
  const excId = "jobs:run_job.fn/except@0";
  const finId = "jobs:run_job.fn/finally@0";

  // try → except: CONDITIONAL (dashed), the error branch, labelled.
  const onError = thread.edges.find((e) => e.from === tryId && e.to === excId);
  assert.ok(onError, "missing try→except edge");
  assert.equal(onError.kind, "conditional", "try→except must be conditional (dashed)");
  assert.equal(onError.label, "on error");

  // except → finally and try → finally: both FLOW (solid), 'always'.
  const joins = thread.edges.filter((e) => e.to === finId && e.kind === "flow");
  assert.deepStrictEqual(
    joins.map((e) => [e.from, e.label]).sort(),
    [[excId, "always"], [tryId, "always"]],
    "finally must be joined 'always' from BOTH the try (success) and the except (handled)",
  );

  // The except band must NOT be claimed as an 'always' join — it's only
  // reached on error.
  assert.ok(
    !thread.edges.some((e) => e.to === excId && e.kind === "flow"),
    "an except band must never be a solid 'always' join",
  );
});

test("§5.6a: returns inside a try / except source from their band's last call", () => {
  const thread = runExtractor(EXC_IR, EXC_SEED_FILE, EXC_SEED_ID);
  // return record  (in try, after store.write) ← store.write
  // return None     (in except, after store.rollback) ← store.rollback
  const retEdges = thread.edges.filter(
    (e) => e.to.includes(":return@") && e.kind === "direct",
  );
  assert.deepStrictEqual(
    retEdges.map((e) => [e.from, e.to]).sort(),
    [
      ["dynamic:store.rollback", "jobs:run_job:return@1"],
      ["dynamic:store.write", "jobs:run_job:return@0"],
    ],
    "each return must flow from the last call in its OWN band, not the function head",
  );
});

test("M-FS2: a viaLocal call resolving to a PROJECT method steps in (never external)", () => {
  const RECEIVER_IR = join(ROOT, "test", "fixtures", "threads", "receiver_demo", "receiver_demo.ir.json");
  const thread = runExtractor(RECEIVER_IR, "main.py", "module/main.fn");
  // engine = Engine(4); engine.ignite(0.5) — the linker resolves the
  // receiver call to engine:Engine.ignite (viaLocal, in-project). The
  // thread walks INTO the method as a step (file + irNodeId → the editor
  // opens on click), instead of the old external terminal whose tooltip
  // claimed the source "can't be resolved" while the method's containers
  // painted two nodes away.
  const step = thread.nodes.find((n) => n.id === "engine:Engine.ignite");
  assert.ok(step, "expected a step node for the receiver-resolved project method");
  assert.equal(step.kind, "step");
  assert.equal(step.file, "engine.py");
  assert.equal(step.irNodeId, "module/Engine.class/ignite.fn");
  assert.ok(
    !thread.nodes.some((n) => n.id.startsWith("external:engine.Engine.ignite")),
    "the project method must not ALSO appear as an external terminal",
  );
  // The method's own control flow rides in under the step.
  assert.ok(
    thread.nodes.some((n) => n.kind === "container" && n.id.includes("ignite.fn/if@0")),
    "the stepped-into method's containers must be present",
  );
});

test("M-FS2: a viaLocal target NOT in the project stays an external terminal", () => {
  const LIB_IR = join(ROOT, "test", "fixtures", "system", "library_only", "library_only.ir.json");
  // train.py: model = CNNClassifier(); model.parameters() — `parameters`
  // is INHERITED from nn.Module, so it does not structurally exist in
  // model.py. Stepping in would be a lie; it stays an external terminal
  // keyed on the qualifiedTarget.
  const thread = runExtractor(LIB_IR, "train.py", "module/train_model.fn");
  const ext = thread.nodes.find((n) => n.id.startsWith("external:model.CNNClassifier.parameters"));
  assert.ok(ext, "inherited (structurally absent) method must stay external");
  assert.ok(
    !thread.nodes.some((n) => n.kind === "step" && n.id === "model:CNNClassifier.parameters"),
    "no step node may be invented for a method the file does not define",
  );
});

test("M-FS8: a bare name imported from an EXTERNAL module is external, with its qualified target", () => {
  const thread = runExtractor(FLASK_IR_PATH, "app.py", "module/list_users_route.fn");
  const jsonify = thread.nodes.find((n) => n.id === "external:jsonify");
  assert.ok(jsonify, "jsonify (from flask import jsonify) must classify external, not unresolved");
  assert.equal(jsonify.kind, "external");
  assert.equal(jsonify.qualifiedTarget, "flask.jsonify",
    "the import names the module — the resolver gets a genuinely importable target");
});

test("M-FS8: a PROJECT-module import the linker missed stays honestly unresolved", () => {
  // Claiming `external` about project code would be the M17.1 lie again;
  // a name imported from a PROJECT module with no reference edge stays a
  // visible resolution gap (contrast the flask.jsonify case above).
  //
  // Built in-memory, not from a fixture: this used to ride on flask_demo's
  // `return User(...)`, which was never a real linker miss — it was the
  // return-position reference-edge gap, now fixed in parse_cst.py
  // (_emit_local_ref). Pinning the branch needs a genuine miss, so we
  // hand-build one: `from helpers import Widget` with no edge emitted.
  const ir = {
    "app.py": {
      version: "1.1",
      modulePath: "app",
      symbolIndex: [],
      nodes: [
        { id: "module/helpers.import_from", type: "import_from", parentId: null,
          line: 1, endLine: 1, col: 0, endCol: 30, module: "helpers", names: ["Widget"] },
        { id: "module/build.fn", type: "function_def", parentId: null,
          line: 3, endLine: 4, col: 0, endCol: 20, name: "build", params: [],
          docstring: null, decorators: [], isAsync: false },
        { id: "module/build.fn/w.assign", type: "assignment", parentId: "module/build.fn",
          line: 4, endLine: 4, col: 4, endCol: 20, name: "w",
          valueKind: "call", preview: "Widget()", callTarget: "Widget" },
      ],
      edges: [
        { source: "module/build.fn", target: "module/build.fn/w.assign", type: "contains" },
      ],
    },
    // Present only so `helpers` counts as a PROJECT module, not a
    // third-party one — that distinction is the whole point of the branch.
    "helpers.py": { version: "1.1", modulePath: "helpers", symbolIndex: [], nodes: [], edges: [] },
  };
  const thread = runExtractorOnIr(ir, "app.py", "module/build.fn");
  const widget = thread.nodes.find((n) => n.id === "unresolved:Widget");
  assert.ok(widget, "project-module import with no ref edge must stay unresolved");
  assert.equal(widget.kind, "unresolved");
  assert.ok(
    !thread.nodes.some((n) => n.id.startsWith("external:Widget")),
    "must not be laundered into an external terminal",
  );
});

test("return-position construction resolves like the assignment form (same file)", () => {
  // The bug this pins: `f = Foo()` painted a step while `return Foo()`
  // painted an `unresolved` terminal, because visit_Return stamped a
  // callTarget but emitted no same-file reference edge, and the
  // extractor's fallback (resolve_same_file) matches function_def only.
  // models.py `find_user` ends in `return User(uid=..., ...)`.
  const thread = runExtractor(FLASK_IR_PATH, "models.py", "module/find_user.fn");
  const user = thread.nodes.find((n) => n.label === "User");
  assert.ok(user, "expected a node for the returned construction");
  assert.equal(user.kind, "step", "a same-file class construction is a step, not a resolution gap");
  assert.equal(user.file, "models.py");
  assert.equal(user.irNodeId, "module/User.class");
});
