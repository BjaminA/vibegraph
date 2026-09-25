// Quality layer, Run 3: the five verbs Run 1 forced, run against REAL
// threads and pinned by their raw verdicts. Every verb has at least one
// `violated` and one `unverifiable` here, so the discipline is visible
// rather than asserted (the brief's Run 3 requirement).
//
// Sources, and what each one is:
//   examples/fleet-telemetry          real example project (M-ORCH drills)
//   test/fixtures/quality/calib/      CONSTRUCTED shapes for `guards`; the
//                                     h2h2 blind sample was never committed
//   test/fixtures/comprehension/      the N+1 written eight ways (M-COMP)
//   test/fixtures/threads/run_demo    `swallowed` is a fixture of the defect
//   scripts/                          this repository's own code
//   git history                       co-changes over real commits
//
// Run: npm run test:quality-verbs

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildQualityFacts } from "../src/server/quality/facts.ts";
import { newRegistry } from "../src/server/quality/verbs/index.ts";
import { isBroadExcept } from "../src/server/quality/verbs/handles_failure.ts";
import { isCheckResult } from "../src/server/quality/check_registry.ts";
import { loadEnvelope, gitDelta } from "../scripts/quality_check.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = newRegistry();
const COMMIT = "test";

const envelopes = new Map();
function project(root, envelopePath) {
  const key = `${root}|${envelopePath ?? ""}`;
  if (!envelopes.has(key)) {
    const { absRoot, envelope, parseErrors } = loadEnvelope(root, envelopePath);
    assert.deepEqual(parseErrors, {}, `${root}: parse errors`);
    envelopes.set(key, { absRoot, envelope, stack: buildStackIndex(envelope, absRoot) });
  }
  return envelopes.get(key);
}
function run(root, check, extra = {}, envelopePath) {
  const { absRoot, envelope, stack } = project(root, envelopePath);
  const facts = buildQualityFacts({ envelope, root: absRoot, commit: COMMIT, stack, ...extra });
  const r = registry.run(facts, check);
  assert.ok(isCheckResult(r), `every verdict is a CheckResult: ${JSON.stringify(r)}`);
  assert.equal(r.provenance.kind, "derived");
  assert.equal(r.provenance.commit, COMMIT);
  return r;
}

test("registry: the five Run 1 verbs and nothing else", () => {
  assert.deepEqual(registry.rules().sort(), ["annotated", "co-changes", "guards", "handles-failure", "not-in-loop"]);
  for (const rule of registry.rules()) assert.ok(registry.get(rule).forcedBy.length >= 1, `${rule} names what forced it`);
});

// ── guards ───────────────────────────────────────────────────────────

const GUARDS = { rule: "guards", target: "notify", guard: "should_notify" };

test("guards: the five constructed bad shapes are the five offenders, the four good ones are not", () => {
  const r = run("test/fixtures/quality/calib", GUARDS, { scopeFiles: ["guards_demo.py"] });
  assert.equal(r.verdict, "violated");
  assert.deepEqual(r.offenders, [
    "guards_demo.py:module/bad_after.fn/notify.call",
    "guards_demo.py:module/bad_else_arm.fn/if@0/notify.call",
    "guards_demo.py:module/bad_negated_then.fn/if@0/notify.call",
    "guards_demo.py:module/bad_return_between.fn/notify.call",
    "guards_demo.py:module/bad_no_guard.fn/notify.call",
  ]);
  assert.match(r.reason, /comes AFTER the call it should govern/);
  assert.match(r.reason, /else-arm/);
  assert.match(r.reason, /return_stmt .* sits between/);
  assert.match(r.reason, /never calls `should_notify`/);
  for (const good of ["good_if_arm", "good_negated_return", "good_bound_then_if", "good_negated_else"]) {
    assert.ok(!r.offenders.some((o) => o.includes(good)), `${good} is not an offender`);
  }
});

test("guards: a target hidden behind a parameter receiver is unverifiable (dynamic), never a pass", () => {
  const r = run("test/fixtures/quality/calib", GUARDS, { scopeFiles: ["guards_unv.py"] });
  assert.equal(r.verdict, "unverifiable");
  assert.equal(r.cause, "dynamic");
  assert.deepEqual(r.at, ["guards_unv.py:module/unv_dynamic_target.fn/if@0/sink_notify.call"]);
  assert.match(r.reason, /Only a trace or a stated attribution can lift this/);
});

test("guards: the fleet example's evaluate is governed (the real known-good); the pass says what it did not follow", () => {
  const r = run("examples/fleet-telemetry", GUARDS);
  assert.equal(r.verdict, "pass", r.reason);
  assert.match(r.reason, /telemetry\/alerts\.py:module\/evaluate\.fn/);
  assert.ok(r.notFollowed.some((s) => /exception short-circuits/.test(s)));
  assert.ok(r.notFollowed.some((s) => /semantically governs/.test(s)));
});

test("guards: a guard the project does not define is unverifiable (no-such-name)", () => {
  const r = run("examples/fleet-telemetry", { rule: "guards", target: "notify", guard: "should_page" });
  assert.equal(r.verdict, "unverifiable");
  assert.equal(r.cause, "no-such-name");
  assert.match(r.reason, /NOT treated as satisfied/);
});

// ── not-in-loop ──────────────────────────────────────────────────────

const COMP = "test/fixtures/comprehension/comp_demo";
const COMP_ENV = "test/fixtures/comprehension/comp_demo/comp_demo.project.json";

test("not-in-loop: every N+1 spelling in comp_demo is violated and page_once passes", () => {
  const check = { rule: "not-in-loop", role: "http-client" };
  const bad = ["fetch_loop", "fetch_comp", "fetch_dict", "fetch_genexp", "filter_live", "nm_loop", "nm_two_clauses", "nm_nested_comps", "t3_loop", "t3_clauses", "t3_nodes"];
  for (const fn of bad) {
    const r = run(COMP, check, { entryPointId: `fanout.py:${fn}` }, COMP_ENV);
    assert.equal(r.verdict, "violated", `${fn}: ${r.reason}`);
    assert.ok(r.offenders.every((o) => o.startsWith("fanout.py:module/")), `${fn}: offenders are file:node`);
    assert.match(r.reason, /runs once per iteration/);
  }
  const ok = run(COMP, check, { entryPointId: "fanout.py:page_once" }, COMP_ENV);
  assert.equal(ok.verdict, "pass");
  assert.match(ok.reason, /no loop on this thread/);
  assert.ok(ok.notFollowed.some((s) => /no loop container was reached/.test(s)));
});

test("not-in-loop: the two-clause comprehension names BOTH clauses (M-COMP.2), and the offender is the call, not the loop", () => {
  const r = run(COMP, { rule: "not-in-loop", role: "http-client" }, { entryPointId: "fanout.py:nm_two_clauses" }, COMP_ENV);
  assert.equal(r.verdict, "violated");
  assert.match(r.reason, /listcomp for uid in g/);
  assert.match(r.reason, /listcomp for g in groups/);
  for (const o of r.offenders) assert.doesNotMatch(o, /comp@\d+$/, `offender ${o} is a call site`);
});

test("not-in-loop: fleet's batched backfill passes by name, and a role-only check on a dict-iterating loop is honestly unverifiable", () => {
  const byName = run("examples/fleet-telemetry", { rule: "not-in-loop", target: "execute", except: ["insert_readings"] }, { entryPointId: "telemetry/backfill.py:backfill_from_file" });
  assert.equal(byName.verdict, "pass", byName.reason);
  // Was "3 loop(s) examined" until the h2h3 narrowing (2026-09-21): the
  // third is `for key in REQUIRED` in the schema validator, a module
  // constant bound to a literal tuple, so the source fixes how often it
  // runs. Two are still examined and the third is named, not dropped.
  assert.match(byName.reason, /2 loop\(s\) examined/);
  assert.match(byName.reason, /1 loop\(s\) not counted .* `for key in REQUIRED`/);
  assert.ok(byName.notFollowed.some((s) => /insert_readings/.test(s)));
  const byRole = run("examples/fleet-telemetry", { rule: "not-in-loop", role: "db" }, { entryPointId: "telemetry/ingest.py:ingest_batch" });
  assert.equal(byRole.verdict, "unverifiable");
  assert.equal(byRole.cause, "dynamic");
  assert.deepEqual(byRole.at, ["telemetry/normalize.py:module/normalize_reading.fn/unit.assign"]);
  assert.match(byRole.reason, /`raw\.get`/);
});

const BOUNDED = "test/fixtures/quality/bounded";

// h2h3 (2026-09-21): all five plain-Claude arms AND the orchestrated run
// wrote a migration looping over a module constant of one or two columns,
// and this verb reported every one violated against a clause whose story is
// an eleven-hour 2M-row backfill. A loop the SOURCE bounds runs a fixed
// number of times however much data arrives. The census found 6 such loops
// across the whole corpus and not one carries an effectful call, so the
// fixture had to be built before the narrowing could be pinned.
test("not-in-loop: a loop the SOURCE bounds is not a repetition, and the pass names every loop it did not count", () => {
  const r = run(BOUNDED, { rule: "not-in-loop", target: "execute" }, { entryPointId: "migrate_cli.py:main" });
  assert.equal(r.verdict, "pass", r.reason);
  assert.deepEqual(r.offenders, []);
  // All three shapes, each with the reason it was excluded.
  assert.match(r.reason, /3 loop\(s\) not counted/);
  assert.match(r.reason, /ADDED_COLUMNS, a module constant the source binds to a literal tuple/);
  assert.match(r.reason, /INDEXES, a module constant the source binds to a literal list/);
  assert.match(r.reason, /the literal collection \["journal_mode=WAL"/);
  // Never silent: the exclusion is in notFollowed too, which a pass must carry.
  assert.ok(r.notFollowed.some((n) => /not counted/.test(n)), r.notFollowed.join(" | "));
  assert.ok(r.notFollowed.some((n) => /condition inside the loop/.test(n)), "the guard limitation is named");
});

test("not-in-loop: the narrowing does not hide a real per-row call, and one verdict carries both facts", () => {
  const r = run(BOUNDED, { rule: "not-in-loop", target: "execute" }, { entryPointId: "ingest_cli.py:main" });
  assert.equal(r.verdict, "violated", r.reason);
  assert.deepEqual(r.offenders, ["store.py:module/insert_rows.fn/for@0/conn_execute.call"]);
  assert.match(r.reason, /runs once per iteration/);
  assert.match(r.reason, /`for row in rows`/);
  // The same thread's migration loop is excluded, and the violation says so.
  assert.match(r.reason, /1 loop\(s\) not counted/);
  assert.match(r.reason, /ADDED_COLUMNS/);
});

test("not-in-loop: the corpus verdicts are unchanged by the narrowing (it removed false positives, not findings)", () => {
  // comp_demo's N+1 spellings iterate a parameter; fleet's backfill batches.
  const still = run(COMP, { rule: "not-in-loop", role: "http-client" }, { entryPointId: "fanout.py:fetch_loop" }, COMP_ENV);
  assert.equal(still.verdict, "violated", still.reason);
  const batched = run("examples/fleet-telemetry", { rule: "not-in-loop", target: "execute", except: ["insert_readings"] }, { entryPointId: "telemetry/backfill.py:backfill_from_file" });
  assert.equal(batched.verdict, "pass", batched.reason);
  // fleet's schema validator loops over REQUIRED, a literal tuple: excluded
  // where it is reached, and it never carried an effectful call anyway.
  const ingest = run("examples/fleet-telemetry", { rule: "not-in-loop", target: "execute", except: ["insert_readings"] }, { entryPointId: "telemetry/ingest.py:ingest_batch" });
  assert.equal(ingest.verdict, "pass", ingest.reason);
  assert.match(ingest.reason, /REQUIRED/);
});

test("not-in-loop: without a thread in scope it is unverifiable (precondition), and malformed operands are refused", () => {
  const r = run("examples/fleet-telemetry", { rule: "not-in-loop", role: "db" });
  assert.equal(r.verdict, "unverifiable");
  assert.equal(r.cause, "precondition");
  const bad = run("examples/fleet-telemetry", { rule: "not-in-loop", role: "database" }, { entryPointId: "telemetry/ingest.py:ingest_batch" });
  assert.equal(bad.cause, "precondition");
  assert.match(bad.reason, /refused, not coerced/);
});

// ── handles-failure ──────────────────────────────────────────────────

test("handles-failure: run_demo's `swallowed` is the violation the fixture was built for", () => {
  const r = run("test/fixtures/threads/run_demo", { rule: "handles-failure", scope: "files" }, { scopeFiles: ["calc.py", "effects.py", "torchy.py", "broken.py"] });
  assert.equal(r.verdict, "violated");
  assert.deepEqual(r.offenders, ["calc.py:module/swallowed.fn/except@0"]);
  assert.match(r.reason, /EMPTY and BROAD/);
  assert.match(r.reason, /look the same to the IR/);
});

test("handles-failure: this repository's own scripts have ONE EMPTY arm left (files scope) and four honest unverifiables (thread scope)", () => {
  const { envelope } = project("scripts");
  const files = run("scripts", { rule: "handles-failure", scope: "files" }, { scopeFiles: Object.keys(envelope.files) });
  assert.equal(files.verdict, "violated");
  // Was THREE until 2026-09-21. The two in build_system_tier.py were this
  // verb's own finding, reported to Ben with the calibration and fixed when
  // he said to: `except Exception: pass` around a package.json read became
  // (OSError, UnicodeDecodeError, JSONDecodeError, AttributeError), and
  // `except Exception: continue` around a source read became
  // (OSError, UnicodeDecodeError). Both swallowed a bug in the code BESIDE
  // the call they were guarding, which is the defect the verb is for.
  //
  // The survivor is deliberate and stays: _Tracer.__call__ runs inside
  // sys.setprofile, where an exception escaping the profiler would kill
  // the traced program. A trace that loses one call site is honest; a
  // trace that kills the run it is observing is not.
  assert.deepEqual(files.offenders, [
    "trace_run.py:module/_Tracer.class/__call__.fn/except@0",
  ]);
  const byThread = {};
  for (const t of envelope.threads) {
    const r = run("scripts", { rule: "handles-failure", scope: "thread" }, { entryPointId: t.entryPointId });
    byThread[t.entryPointId] = r;
  }
  assert.equal(byThread["run_to_node.py:run"].verdict, "unverifiable");
  assert.equal(byThread["run_to_node.py:run"].cause, "precondition");
  assert.match(byThread["run_to_node.py:run"].reason, /only assign a fallback/);
  assert.equal(byThread["scan_effects.py:main"].verdict, "pass");
  assert.match(byThread["scan_effects.py:main"].reason, /returns/);

  // THE TWO SCOPES MUST AGREE ON ONE TREE (fixed 2026-09-23). Until then
  // the thread scope read its arms from the thread's own container list,
  // and the extractor emits a container only where a walked STEP sits
  // inside it — so an arm with no CALL in it was invisible. Measured with
  // one planted `except Exception:` in an ingest loop: `pass` produced no
  // container, `skipped = 1` produced none, only `errors.append(...)` did.
  // The thread scope was therefore blind to exactly the shape this verb
  // calls a violation, and said `pass — "no except arm on this thread"`
  // while the files scope on the same tree said `violated` and named the
  // node. Both expectations below were recording that blindness:
  //
  //  - trace_run.py:trace was `unverifiable` (cause "dynamic") because the
  //    only arm it could see was elsewhere; it now reports the SAME single
  //    offender the files scope names above — the deliberate tracer
  //    swallow, which is G13's node-scoped allowance, not a bug to fix.
  //  - cst_rewrite.py:main was `pass` (/prints/) because the one arm it
  //    could see printed. It now sees the four that only assign a
  //    fallback and answers `unverifiable` — a pass reached by not seeing
  //    the other arms is the false-pass family this verb exists to avoid.
  assert.equal(byThread["trace_run.py:trace"].verdict, "violated");
  assert.deepEqual(byThread["trace_run.py:trace"].offenders, [
    "trace_run.py:module/_Tracer.class/__call__.fn/except@0",
  ]);
  assert.equal(byThread["cst_rewrite.py:main"].verdict, "unverifiable", byThread["cst_rewrite.py:main"].reason);
  assert.match(byThread["cst_rewrite.py:main"].reason, /only assign a fallback/);
  // Every arm the thread scope reports sits in a file the thread REACHED —
  // a thread spans files, so this is the honest bound, not the seed's file.
  // (The first cut of this assertion demanded the seed's file and flagged
  // parse_cst.py's `visit_AugAssign` arm, which cst_rewrite.py:main really
  // does walk: filesReached is [cst_rewrite.py, parse_cst.py] and the
  // thread carries 28 nodes under that function.) The pairing behind it is
  // checked too: a thread node may name NO file, and falling back to the
  // seed's once paired `GraphBuilder.*` — which lives in parse_cst.py —
  // with cst_rewrite.py. Harmless there, but `module/main.fn` exists in
  // most files, so a function now counts only for a file that defines it.
  const reached = new Set(
    envelope.threads.find((t) => t.entryPointId === "cst_rewrite.py:main").filesReached,
  );
  for (const ref of byThread["cst_rewrite.py:main"].at ?? []) {
    const file = ref.slice(0, ref.indexOf(":"));
    assert.ok(reached.has(file), `arm in a file the thread never reached: ${ref}`);
  }
});

test("handles-failure: an EMPTY arm naming a narrow expected exception is handled, a broad one is the swallow (the calibration narrowing)", () => {
  // Django admin's checks.py: `except ImportError: continue` while probing
  // candidate paths, and `except TypeError: return False`. Neither is a
  // swallow; the review found seventeen such arms and no defect.
  const r = run("test/fixtures/scale/src", { rule: "handles-failure", scope: "files" }, { scopeFiles: ["checks.py"] });
  assert.equal(r.verdict, "pass", r.reason);
  assert.match(r.reason, /expects `ImportError` and skips it/);
  assert.ok(r.notFollowed.some((s) => /only one that can occur/.test(s)));
  assert.equal(isBroadExcept(null), true, "bare except is broad");
  assert.equal(isBroadExcept("Exception"), true);
  assert.equal(isBroadExcept("BaseException"), true);
  assert.equal(isBroadExcept("(ValueError, Exception)"), true);
  assert.equal(isBroadExcept("ImportError"), false);
  assert.equal(isBroadExcept("json.JSONDecodeError"), false);
  assert.equal(isBroadExcept("SomeException"), false, "a class merely named ...Exception is not the broad one");
});

test("handles-failure: a bash thread is unverifiable (precondition), never a pass", () => {
  const r = run("examples/fleet-telemetry", { rule: "handles-failure", scope: "thread" }, { entryPointId: "ops/backup.sh:main" });
  assert.equal(r.verdict, "unverifiable");
  assert.equal(r.cause, "precondition");
});

// ── annotated ────────────────────────────────────────────────────────

test("annotated: fleet's untyped receivers are named, its typed entry points pass, non-Python is unverifiable", () => {
  const norm = run("examples/fleet-telemetry", { rule: "annotated", at: "dynamic-receivers" }, { entryPointId: "telemetry/normalize.py:normalize_reading" });
  assert.equal(norm.verdict, "violated");
  assert.deepEqual(norm.offenders, ["telemetry/normalize.py:module/normalize_reading.fn"]);
  assert.match(norm.reason, /normalize_reading\(raw\) unannotated/);
  const ep = run("examples/fleet-telemetry", { rule: "annotated", at: "entry-point" }, { entryPointId: "telemetry/storage.py:readings_between" });
  assert.equal(ep.verdict, "pass", ep.reason);
  assert.ok(ep.notFollowed.some((s) => /a wrong type passes/.test(s)));
  const ts = run("examples/fleet-telemetry", { rule: "annotated", at: "entry-point" }, { entryPointId: "gateway/server.ts:getFleet" });
  assert.equal(ts.verdict, "unverifiable");
  assert.equal(ts.cause, "precondition");
  assert.match(ts.reason, /jsts/);
});

// ── co-changes ───────────────────────────────────────────────────────

const CO = { rule: "co-changes", when: "schemas/ir.schema.json", require: "src/shared/protocol.ts" };

test("co-changes over real history: M17.2's container kinds shipped without protocol.ts (violated); M9.1's effectKind shipped with it (pass)", () => {
  const bad = run("test/fixtures/quality/calib", CO, { runDelta: gitDelta("febac7f") });
  assert.equal(bad.verdict, "violated");
  assert.deepEqual(bad.offenders, ["schemas/ir.schema.json:module"]);
  assert.match(bad.reason, /febac7f/);
  const good = run("test/fixtures/quality/calib", CO, { runDelta: gitDelta("06c746b") });
  assert.equal(good.verdict, "pass");
  assert.ok(good.notFollowed.some((s) => /CONTENT of the change is not judged/.test(s)));
});

test("co-changes: an incomplete run is not-yet, an untouched trigger passes without binding, no delta is a precondition", () => {
  const partial = run("test/fixtures/quality/calib", CO, {
    runDelta: { entries: [{ packetId: "p1", file: "schemas/ir.schema.json", nodeId: null, change: "changed" }], complete: false },
  });
  assert.equal(partial.verdict, "unverifiable");
  assert.equal(partial.cause, "not-yet");
  const untouched = run("test/fixtures/quality/calib", CO, {
    runDelta: { entries: [{ packetId: "p1", file: "telemetry/alerts.py", nodeId: "module/notify.fn", change: "changed" }], complete: true },
  });
  assert.equal(untouched.verdict, "pass");
  assert.match(untouched.reason, /did not bind/);
  const none = run("test/fixtures/quality/calib", CO);
  assert.equal(none.verdict, "unverifiable");
  assert.equal(none.cause, "precondition");
});

test("co-changes: a node-level trigger binds only to that node", () => {
  const r = run("test/fixtures/quality/calib", { rule: "co-changes", when: "telemetry/storage.py:module/SCHEMA.assign", require: "telemetry/migrations.py" }, {
    runDelta: { entries: [
      { packetId: "p2", file: "telemetry/storage.py", nodeId: "module/SCHEMA.assign", change: "changed" },
      { packetId: "p2", file: "telemetry/storage.py", nodeId: "module/_get_conn.fn", change: "changed" },
    ], complete: true },
  });
  assert.equal(r.verdict, "violated");
  assert.deepEqual(r.offenders, ["telemetry/storage.py:module/SCHEMA.assign"]);
});
