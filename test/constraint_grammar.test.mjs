/**
 * M-GRAMMAR — the CHECKABLE half of a stated constraint.
 *
 * The case this exists for, from reviews/h2h2/REPORT.md: a human stated
 * "region changes page through should_notify, and no other module may call
 * notify". The model reviewer read "routed through should_notify then
 * notify" and APPROVED, while the checker said
 * `notifyCallers = [telemetry/ingest.py]`. True as prose, false as fact.
 *
 * The floor under test is that there are THREE verdicts and never two: a
 * constraint the IR cannot answer must read `unverifiable`, because a
 * checker that silently passes what it could not check is worse than the
 * prose reviewer it replaces — it looks like proof.
 *
 * Run: npm run test:constraint-grammar
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkConstraint, describeCheck, enclosingFunction, isConstraintCheck,
} from "../src/server/constraint_grammar.ts";

// The fleet shape: alerts.py defines notify + should_notify; ingest.py is
// the module that must not call notify directly.
const FACTS = {
  references: [
    { fromFile: "telemetry/alerts.py", fromNodeId: "module/should_notify.fn/n.call", toFile: "telemetry/alerts.py", toName: "notify" },
    { fromFile: "telemetry/alerts.py", fromNodeId: "module/evaluate.fn/s.call", toFile: "telemetry/alerts.py", toName: "should_notify" },
  ],
  importsByFile: {
    "telemetry/http_client.py": ["requests"],
    "telemetry/storage.py": ["sqlite3"],
  },
  definedNames: ["notify", "should_notify", "evaluate", "insert_readings"],
  unresolved: [],
};

const withRef = (extra) => ({ ...FACTS, references: [...FACTS.references, extra] });

test("the measured miss is caught: a second module calling notify is VIOLATED", () => {
  const facts = withRef({
    fromFile: "telemetry/ingest.py", fromNodeId: "module/ingest_batch.fn/p.call",
    toFile: "telemetry/alerts.py", toName: "notify",
  });
  const r = checkConstraint(facts, {
    rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"],
  });
  assert.equal(r.verdict, "violated");
  assert.deepEqual(r.offenders, ["telemetry/ingest.py:module/ingest_batch.fn/p.call"]);
  // A reject has to be actionable: it names the file AND the call node.
  assert.match(r.reason, /called from outside file\(s\) telemetry\/alerts\.py/);
  assert.match(r.reason, /ingest_batch/);
});

test("the compliant shape passes, and SAYS what it could not follow", () => {
  const r = checkConstraint(FACTS, {
    rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"],
  });
  assert.equal(r.verdict, "pass");
  assert.deepEqual(r.offenders, []);
  assert.match(r.reason, /all 1 resolved call\(s\)/);
});

test("`calls-through` reads the GUARD, not the caller — the reading a first cut got wrong", () => {
  // "every call to notify goes through should_notify" does NOT mean "the
  // caller IS should_notify". Real code writes
  //     if not should_notify(...): return
  //     notify(event)
  // so the caller is `evaluate` and the guard is `should_notify`. Reading it
  // the other way flagged the fleet example's COMPLIANT code, and a false
  // violation rejects correct work. The honest reading: every function that
  // calls the target also calls the guard.
  const guarded = {
    ...FACTS,
    references: [
      { fromFile: "telemetry/alerts.py", fromNodeId: "module/evaluate.fn/g.call", toFile: "telemetry/alerts.py", toName: "should_notify" },
      { fromFile: "telemetry/alerts.py", fromNodeId: "module/evaluate.fn/n.call", toFile: "telemetry/alerts.py", toName: "notify" },
    ],
  };
  const ok = checkConstraint(guarded, { rule: "calls-through", target: "notify", through: "should_notify" });
  assert.equal(ok.verdict, "pass");
  // The limit is STATED in the verdict, not left for the reader to assume.
  assert.match(ok.reason, /NOT checked: that the guard actually governs the call/);

  // A function that pages WITHOUT consulting the guard is the real violation.
  const bad = {
    ...guarded,
    references: [...guarded.references, {
      fromFile: "telemetry/alerts.py", fromNodeId: "module/evaluate_region.fn/n.call",
      toFile: "telemetry/alerts.py", toName: "notify",
    }],
  };
  const r = checkConstraint(bad, { rule: "calls-through", target: "notify", through: "should_notify" });
  assert.equal(r.verdict, "violated");
  assert.deepEqual(r.offenders, ["telemetry/alerts.py:module/evaluate_region.fn/n.call"]);
  // Same FILE, so the file-scoped spelling would have missed it entirely.
  assert.equal(
    checkConstraint(bad, { rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"] }).verdict,
    "pass",
  );
});

test("`calls-through` is UNVERIFIABLE when the guard it names does not exist", () => {
  const r = checkConstraint(FACTS, { rule: "calls-through", target: "notify", through: "rate_limit" });
  assert.equal(r.verdict, "unverifiable");
  assert.match(r.reason, /does not exist in the project as spelled/);
});

test("a target the IR does not know is UNVERIFIABLE — never a pass", () => {
  const r = checkConstraint(FACTS, {
    rule: "callers-only", target: "page_oncall", files: ["telemetry/alerts.py"],
  });
  assert.equal(r.verdict, "unverifiable", "vacuous truth is the failure mode this exists to end");
  assert.match(r.reason, /NOT treated as satisfied/);
});

test("an unresolved call that COULD be the target is unverifiable, not a pass", () => {
  const facts = {
    ...FACTS,
    unresolved: [{ file: "telemetry/ingest.py", label: "handler.notify" }],
  };
  const r = checkConstraint(facts, {
    rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"],
  });
  assert.equal(r.verdict, "unverifiable");
  assert.match(r.reason, /could be it/);
  assert.match(r.reason, /telemetry\/ingest\.py: handler\.notify/);
});

test("unresolved calls that could NOT be the target leave a pass standing, WITH the caveat", () => {
  const facts = { ...FACTS, unresolved: [{ file: "telemetry/cli.py", label: "cmd.run" }] };
  const r = checkConstraint(facts, {
    rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"],
  });
  // Refusing every project with any dynamic call would make the grammar
  // useless; the honest middle is to pass and say what was not followed.
  assert.equal(r.verdict, "pass");
  assert.match(r.reason, /1 unresolved\/dynamic call\(s\).*not followed/);
});

test("a violation OUTRANKS an unresolved caveat — a fact beats a maybe", () => {
  const facts = {
    ...withRef({
      fromFile: "telemetry/ingest.py", fromNodeId: "module/ingest_batch.fn/p.call",
      toFile: "telemetry/alerts.py", toName: "notify",
    }),
    unresolved: [{ file: "telemetry/x.py", label: "notify" }],
  };
  const r = checkConstraint(facts, {
    rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"],
  });
  assert.equal(r.verdict, "violated");
});

// ── import-only: the funnel rule, made checkable ─────────────────────

test("import-only catches a module reaching past the project's funnel", () => {
  const facts = {
    ...FACTS,
    importsByFile: { ...FACTS.importsByFile, "telemetry/ingest.py": ["requests"] },
  };
  const r = checkConstraint(facts, {
    rule: "import-only", tool: "requests", files: ["telemetry/http_client.py"],
  });
  assert.equal(r.verdict, "violated");
  assert.deepEqual(r.offenders, ["telemetry/ingest.py"]);
});

test("import-only passes when the funnel is the only importer", () => {
  const r = checkConstraint(FACTS, {
    rule: "import-only", tool: "requests", files: ["telemetry/http_client.py"],
  });
  assert.equal(r.verdict, "pass");
});

test("import-only on a tool nobody imports is UNVERIFIABLE, not vacuously true", () => {
  const r = checkConstraint(FACTS, {
    rule: "import-only", tool: "httpx", files: ["telemetry/http_client.py"],
  });
  assert.equal(r.verdict, "unverifiable");
  assert.match(r.reason, /NOT treated as satisfied/);
});

// ── the boundary: a malformed check is refused, never coerced ─────────

test("validation refuses what it cannot evaluate", () => {
  assert.ok(isConstraintCheck({ rule: "callers-only", target: "notify", files: ["a.py"] }));
  assert.ok(isConstraintCheck({ rule: "callers-only", target: "notify", functions: ["b"] }));
  assert.ok(isConstraintCheck({ rule: "import-only", tool: "requests", files: ["a.py"] }));
  assert.ok(isConstraintCheck({ rule: "calls-through", target: "notify", through: "should_notify" }));

  // "callers only ... nowhere" is not a rule.
  assert.ok(!isConstraintCheck({ rule: "callers-only", target: "notify" }));
  assert.ok(!isConstraintCheck({ rule: "callers-only", target: "", files: ["a.py"] }));
  assert.ok(!isConstraintCheck({ rule: "import-only", tool: "requests" }));
  assert.ok(!isConstraintCheck({ rule: "nonsense", target: "x" }));
  assert.ok(!isConstraintCheck({ rule: "callers-only", target: "n", files: "a.py" }));
  assert.ok(!isConstraintCheck(null));
  assert.ok(!isConstraintCheck("callers-only notify"));
});

test("enclosingFunction reads the structural id rather than guessing", () => {
  assert.equal(enclosingFunction("module/ingest_batch.fn/p.call"), "ingest_batch");
  assert.equal(enclosingFunction("module/C.class/m.fn/x.call"), "m");
  assert.equal(enclosingFunction("module/top.assign"), null);
});

test("describeCheck reads like the sentence a human would have written", () => {
  assert.equal(
    describeCheck({ rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"] }),
    "callers of `notify` only in telemetry/alerts.py",
  );
  assert.equal(
    describeCheck({ rule: "import-only", tool: "requests", files: ["telemetry/http_client.py"] }),
    "`requests` imported only in telemetry/http_client.py",
  );
  assert.equal(
    describeCheck({ rule: "calls-through", target: "notify", through: "should_notify" }),
    "every call to `notify` goes through `should_notify`",
  );
});
