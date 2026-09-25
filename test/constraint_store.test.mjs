/**
 * M-CONTRACT.3 — stated constraints: boundary validation, persistence,
 * deterministic routing by scope, and the provenance-per-line prompt
 * block with an honest budget. Pure module, temp dirs only.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/constraint_store.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateConstraintInput, addConstraint, loadConstraints, removeConstraint,
  routeConstraints, formatConstraintsBlock, findDuplicate, CONSTRAINTS_FILE, CONSTRAINT_KINDS,
  policySentence, STACK_RULES,
} from "../src/server/constraint_store.ts";

test("H2H #2: findDuplicate catches a restated constraint (containment either way, whitespace/case-insensitive), never a short or unrelated one", () => {
  const human = { id: "c2", kind: "payload-schema", text: "The /export CSV is consumed by the nightly BI job, which reads columns BY POSITION: device_id, ts, metric, value must stay the first four columns.", scope: { all: true }, source: "human", createdAt: "" };
  const other = { id: "c9", kind: "proxy", text: "Every outbound HTTP call leaves through telemetry/http_client.py.", scope: { all: true }, source: "human", createdAt: "" };
  const list = [human, other];
  // the brief restates the human constraint with a provenance suffix → duplicate
  assert.equal(findDuplicate(list, human.text + " (BI team contract)")?.id, "c2");
  // a shorter paraphrase that is a prefix of the existing one → duplicate
  assert.equal(findDuplicate(list, "the /export csv is consumed by the nightly bi job, which reads columns by position")?.id, "c2");
  // whitespace and case differences do not hide a twin
  assert.equal(findDuplicate(list, "  EVERY outbound   HTTP call leaves through telemetry/http_client.py. ")?.id, "c9");
  // genuinely new → null; tiny strings never match
  assert.equal(findDuplicate(list, "region is optional everywhere and appended last in every ordered structure"), null);
  assert.equal(findDuplicate(list, "csv"), null);
});

const now = () => new Date("2026-09-06T10:00:00Z");
const tmp = () => mkdtempSync(join(tmpdir(), "vg-constraints-"));

test("validation: kind enum, non-empty text, a scope that names something", () => {
  assert.equal(validateConstraintInput(null).ok, false);
  assert.match(validateConstraintInput({ kind: "vibes", text: "x", scope: { all: true } }).error, /kind must be one of/);
  assert.match(validateConstraintInput({ kind: "proxy", text: "  ", scope: { all: true } }).error, /non-empty/);
  assert.match(validateConstraintInput({ kind: "proxy", text: "x", scope: {} }).error, /scope must name/);
  assert.match(validateConstraintInput({ kind: "proxy", text: "x", scope: { files: [""] } }).error, /files/);
  const ok = validateConstraintInput({ kind: "payload-schema", text: " orders carry {id, total} ", scope: { entryPointIds: ["a.py:f"], files: ["api/"] }, note: "from the brief" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { kind: "payload-schema", text: "orders carry {id, total}", scope: { entryPointIds: ["a.py:f"], files: ["api/"] }, note: "from the brief" });
  // a missing scope defaults to everything (an objective applies everywhere)
  assert.deepEqual(validateConstraintInput({ kind: "objective", text: "ship v2" }).value.scope, { all: true });
  // M-STACK.2 — stack-policy joins the kinds; scope.stack takes tool names.
  assert.equal(CONSTRAINT_KINDS.length, 7);
  assert.ok(CONSTRAINT_KINDS.includes("stack-policy"));
  assert.match(validateConstraintInput({ kind: "invariant", text: "x", scope: { stack: ["has space"] } }).error, /invalid tool name/);
  const byTool = validateConstraintInput({ kind: "invariant", text: "x", scope: { stack: [" requests "] } });
  assert.deepEqual(byTool.value.scope, { stack: ["requests"] });
  assert.match(validateConstraintInput({ kind: "proxy", text: "x", scope: {} }).error, /tools \(stack\)/);
});

test("M-STACK.2 policy validation: required on stack-policy, `with` required for replace-with, allowed elsewhere", () => {
  const base = { kind: "stack-policy", text: "prefer the wrapper", scope: { stack: ["requests"] } };
  assert.match(validateConstraintInput(base).error, /kind stack-policy needs a policy/);
  assert.match(validateConstraintInput({ ...base, policy: { tool: "bad name", rule: "prefer" } }).error, /policy.tool/);
  assert.match(validateConstraintInput({ ...base, policy: { tool: "requests", rule: "ban" } }).error, /policy.rule must be one of/);
  assert.match(validateConstraintInput({ ...base, policy: { tool: "requests", rule: "replace-with" } }).error, /needs `with`/);
  assert.match(validateConstraintInput({ ...base, policy: { tool: "requests", rule: "prefer", role: "vibes" } }).error, /policy.role must be one of/);
  const ok = validateConstraintInput({
    ...base,
    policy: { tool: "requests", rule: "replace-with", with: "telemetry.http_client", role: "http-client", reason: " the proxy lives there " },
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.policy, {
    tool: "requests", rule: "replace-with", with: "telemetry.http_client",
    role: "http-client", reason: "the proxy lives there",
  });
  // A policy on another kind is ALLOWED (the fleet example's c1 is a
  // `proxy` constraint carrying one) — the checks read it wherever it is.
  const onProxy = validateConstraintInput({ kind: "proxy", text: "http leaves through the wrapper", scope: { all: true }, policy: { tool: "requests", rule: "forbid", with: "telemetry.http_client" } });
  assert.equal(onProxy.ok, true);
  assert.equal(onProxy.value.policy.rule, "forbid");
  assert.deepEqual([...STACK_RULES], ["require", "prefer", "forbid", "replace-with", "describe"]);
  // M-CMD.3 — `describe` CLASSIFIES: a role is required and `unknown` is not
  // one (it is the absence of a classification). The sentence says what it
  // is, not what to do about it.
  assert.match(validateConstraintInput({ ...base, policy: { tool: "@acme/sdk", rule: "describe" } }).error, /describe needs a `role`/);
  assert.match(validateConstraintInput({ ...base, policy: { tool: "@acme/sdk", rule: "describe", role: "unknown" } }).error, /describe needs a `role`/);
  const described = validateConstraintInput({ ...base, policy: { tool: "@acme/sdk", rule: "describe", role: "platform", reason: "one client for identity, data and commands" } });
  assert.equal(described.ok, true);
  assert.equal(policySentence(described.value.policy), "@acme/sdk is classified as platform SDK (a backend platform behind one client: identity, policy, data, commands)");
  assert.equal(policySentence({ tool: "requests", rule: "replace-with", with: "telemetry.http_client" }), "replace requests with telemetry.http_client");
  assert.equal(policySentence({ tool: "tensorflow", rule: "forbid", with: "torch" }), "forbid tensorflow in favour of torch");
  assert.equal(policySentence({ tool: "torch", rule: "require" }), "require torch");
  assert.equal(policySentence({ tool: "httpx", rule: "prefer", with: "requests" }), "prefer httpx over requests");
});

test("add / load / remove round-trip through .vibegraph/constraints.json with sequential ids", () => {
  const root = tmp();
  try {
    const a = addConstraint(root, { kind: "proxy", text: "all http goes via the nginx sidecar", scope: { all: true } }, "human", now);
    const b = addConstraint(root, { kind: "perf-lever", text: "batch order-item inserts", scope: { files: ["api/db.py"] } }, "orchestrator", now);
    assert.equal(a.id, "c1");
    assert.equal(b.id, "c2");
    assert.equal(a.source, "human");
    assert.equal(b.createdAt, "2026-09-06T10:00:00.000Z");
    const raw = JSON.parse(readFileSync(join(root, CONSTRAINTS_FILE), "utf-8"));
    assert.equal(raw.version, "1");
    assert.equal(raw.constraints.length, 2);
    assert.equal(removeConstraint(root, "c1"), true);
    assert.equal(removeConstraint(root, "c1"), false);
    const left = loadConstraints(root);
    assert.deepEqual(left.map((c) => c.id), ["c2"]);
    // ids never reuse a removed number
    assert.equal(addConstraint(root, { kind: "invariant", text: "x", scope: { all: true } }, "agent", now).id, "c3");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a mangled entry is dropped on load, never half-loaded; a bad file reads as empty", () => {
  const root = tmp();
  try {
    mkdirSync(join(root, ".vibegraph"), { recursive: true });
    writeFileSync(join(root, CONSTRAINTS_FILE), JSON.stringify({ version: "1", constraints: [
      { id: "c1", kind: "proxy", text: "ok", scope: { all: true }, source: "human", createdAt: "" },
      { id: "c2", kind: "nope", text: "bad kind", scope: { all: true } },
      { kind: "proxy", text: "no id", scope: { all: true } },
      { id: "c4", kind: "proxy", text: "unknown source → human", scope: { all: true }, source: "martian" },
    ] }));
    const list = loadConstraints(root);
    assert.deepEqual(list.map((c) => [c.id, c.source]), [["c1", "human"], ["c4", "human"]]);
    writeFileSync(join(root, CONSTRAINTS_FILE), "{ not json");
    assert.deepEqual(loadConstraints(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const C = (id, scope, source = "human", kind = "invariant") => ({ id, kind, text: `t-${id}`, scope, source, createdAt: "" });

test("routing is deterministic: all / entryPointIds / exact file / directory prefix — statement order kept", () => {
  const list = [
    C("c1", { all: true }),
    C("c2", { entryPointIds: ["api/app.py:create_order"] }),
    C("c3", { files: ["api/db.py"] }),
    C("c4", { files: ["gateway/"] }),
    C("c5", { files: ["api/"] }),
  ];
  const create = routeConstraints(list, { entryPointId: "api/app.py:create_order", filesReached: ["api/app.py", "api/db.py"] });
  assert.deepEqual(create.map((c) => c.id), ["c1", "c2", "c3", "c5"]);
  const gw = routeConstraints(list, { entryPointId: "gateway/server.ts:getOrders", filesReached: ["gateway/server.ts", "gateway/client.ts"] });
  assert.deepEqual(gw.map((c) => c.id), ["c1", "c4"]);
  const none = routeConstraints(list.slice(1), { entryPointId: null, filesReached: ["worker/main.cpp"] });
  assert.deepEqual(none, []);
});

test("M-STACK.2: a stack scope routes by the TOOLS a thread uses — dynamic, not a file list", () => {
  const list = [C("c1", { stack: ["requests", "httpx"] }), C("c2", { files: ["api/db.py"] })];
  // A thread that reaches requests only THROUGH the project wrapper still
  // uses requests — the fact follows the import graph, so the policy follows it.
  const viaWrapper = routeConstraints(list, {
    entryPointId: "telemetry/alerts.py:evaluate",
    filesReached: ["telemetry/alerts.py", "telemetry/http_client.py"],
    stack: ["telemetry.http_client", "requests"],
  });
  assert.deepEqual(viaWrapper.map((c) => c.id), ["c1"]);
  // A brand-new file that imports the tool is inside the scope with NO scope edit.
  const newFile = routeConstraints(list, { entryPointId: "telemetry/brand_new.py:go", filesReached: ["telemetry/brand_new.py"], stack: ["requests"] });
  assert.deepEqual(newFile.map((c) => c.id), ["c1"]);
  // No stack facts → a stack scope matches nothing (honest: no facts, no routing).
  assert.deepEqual(routeConstraints(list, { entryPointId: "x", filesReached: ["x.py"] }), []);
  assert.deepEqual(routeConstraints(list, { entryPointId: "x", filesReached: ["x.py"], stack: ["flask"] }), []);
});

test("the prompt block names its provenance per line and names what the budget drops", () => {
  assert.equal(formatConstraintsBlock([]), null);
  const block = formatConstraintsBlock([
    C("c1", { all: true }, "human", "proxy"),
    C("c2", { all: true }, "orchestrator", "payload-schema"),
    C("c3", { all: true }, "agent", "perf-lever"),
  ]);
  assert.match(block, /^## Constraints for this thread \(STATED — not IR fact/);
  assert.match(block, /- \[proxy · human-stated — authoritative\] t-c1/);
  assert.match(block, /- \[payload-schema · orchestrator-stated from the objective the human confirmed[^\]]*\] t-c2/);
  assert.match(block, /- \[perf-lever · agent-stated over MCP — NOT reviewed by a human\] t-c3/);
  const tight = formatConstraintsBlock([C("c1", { all: true }), C("c2", { all: true }), C("c3", { all: true })], 150);
  assert.match(tight, /t-c1/);
  assert.match(tight, /\[2 more constraint\(s\) omitted — over the 150-char budget/);
  assert.doesNotMatch(tight, /t-c3/);

  // M-STACK.2 — a policy leads with its imperative, then the human sentence,
  // then its reason. The provenance label is unchanged: a policy is STATED.
  const withPolicy = {
    ...C("c9", { stack: ["requests"] }, "human", "stack-policy"),
    policy: { tool: "requests", rule: "replace-with", with: "telemetry.http_client", reason: "the proxy lives in the wrapper" },
  };
  const policyBlock = formatConstraintsBlock([withPolicy]);
  assert.match(policyBlock, /- \[stack-policy · human-stated — authoritative\] replace requests with telemetry\.http_client — t-c9 \(reason: the proxy lives in the wrapper\)/);
});

// ── M-SWEEP W6 — several clauses of one constraint ───────────────────
//
// c3 is why this exists: "Operators are paged ONLY through alerts.notify,
// and only after alerts.should_notify has applied its dedup. No other
// module may call notify" is TWO checkable rules in one sentence, and a
// single `check` could only ever carry one. The h2h2 drill lost exactly
// the half a single check would have dropped — the dedup held, the module
// boundary did not.

test("W6: a constraint may carry SEVERAL checks, and each is validated", () => {
  const ok = validateConstraintInput({
    kind: "invariant",
    text: "Paged only through alerts.notify, only after should_notify, and from no other module.",
    scope: { files: ["telemetry/"] },
    checks: [
      { rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"] },
      { rule: "calls-through", target: "notify", through: "should_notify" },
    ],
  });
  assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
  assert.equal(ok.value.checks.length, 2);

  // The singular form still works — nothing already stored breaks.
  const single = validateConstraintInput({
    kind: "invariant", text: "Only alerts.py may call notify, after the flapping-sensor incident.",
    scope: { all: true },
    check: { rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"] },
  });
  assert.equal(single.ok, true);
  assert.equal(single.value.check.rule, "callers-only");
});

test("W6: ONE malformed clause refuses the whole constraint", () => {
  // Storing a constraint whose second clause does not parse would leave a
  // rule that LOOKS enforced and is not — the failure this grammar exists
  // to end, reintroduced through the back door.
  const r = validateConstraintInput({
    kind: "invariant", text: "Two clauses, one of them nonsense.", scope: { all: true },
    checks: [
      { rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"] },
      { rule: "callers-only", target: "notify" },
    ],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /checks\[1\]/);

  assert.equal(validateConstraintInput({
    kind: "invariant", text: "Empty clause list.", scope: { all: true }, checks: [],
  }).ok, false, "an empty list is not a rule");
});

// ── Quality layer: the eight-verb grammar at the constraint-store boundary ──
import { validateConstraintInput as validateAny } from "../src/server/constraint_store.ts";

test("quality layer: a stated constraint may carry any Run 1 verb, validated by the verb's own operand check; a malformed one is refused, never coerced", () => {
  const ok = validateAny({ kind: "invariant", text: "notify is guarded", scope: { files: ["telemetry/alerts.py"] }, check: { rule: "guards", target: "notify", guard: "should_notify" } });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(ok.value.check, { rule: "guards", target: "notify", guard: "should_notify" });
  const both = validateAny({ kind: "invariant", text: "t", scope: { all: true }, checks: [
    { rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"] },
    { rule: "co-changes", when: "telemetry/storage.py", require: "telemetry/migrations.py" },
    { rule: "handles-failure", scope: "files" },
    { rule: "annotated", at: "dynamic-receivers" },
    { rule: "not-in-loop", role: "db", except: ["insert_readings"] },
  ] });
  assert.equal(both.ok, true, JSON.stringify(both));
  assert.equal(both.value.checks.length, 5);
  const bad = validateAny({ kind: "invariant", text: "t", scope: { all: true }, check: { rule: "guards", target: "notify" } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /guards/);
  const badRole = validateAny({ kind: "invariant", text: "t", scope: { all: true }, checks: [{ rule: "not-in-loop", role: "database" }] });
  assert.equal(badRole.ok, false);
  assert.match(badRole.error, /checks\[0\]/);
  const unknown = validateAny({ kind: "invariant", text: "t", scope: { all: true }, check: { rule: "reachable", target: "x" } });
  assert.equal(unknown.ok, false, "a verb outside the eight is refused");
});
