// `payload-keys` (2026-09-28) — the checkable half of a payload-schema rule.
//
// A payload rule was prose: routed to the right threads by the IR, verified by
// nothing. The IR records the keys each call spells (`argKeys` — TypeScript
// object literals, and now Python keyword names and dict-literal keys), so a
// rule like "every page carries `json.region`, never `json.password`" is
// checked against the call sites themselves, through the real parsers.
//
// The floor under test: a key is ABSENT only where the call spells a literal
// at that level; a spread, a computed key or a variable payload makes it NOT
// VISIBLE, and that site is unverifiable — never a false violation.
//
//   npm run test:payload-check
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildQualityFacts } from "../src/server/quality/facts.ts";
import { checkConstraint, describeCheck, isConstraintCheck } from "../src/server/constraint_grammar.ts";
import { validateConstraintInput } from "../src/server/constraint_store.ts";
import { verbMayGate } from "../src/server/quality/standings.ts";
import { payloadKeys } from "../src/server/arch_payloads.ts";

const ROOT = "test/fixtures/payload/payload_demo";
let env, facts;
before(() => {
  env = buildPolyglotEnvelope(ROOT).envelope;
  facts = buildQualityFacts({ envelope: env, root: ROOT, commit: "test" });
});

const run = (check) => { assert.ok(isConstraintCheck(check), "well-formed"); return checkConstraint(facts, check); };
const fnOf = (offender) => /\/([A-Za-z_]+)\.fn\//.exec(offender)?.[1];

test("Python calls carry argKeys: keyword names and dict-literal keys, spreads marked", () => {
  const nodes = env.files["alerts.py"].nodes;
  const at = (fn) => nodes.find((n) => n.id.startsWith(`module/${fn}.fn/`) && n.funcName === "requests.post");
  assert.deepEqual(at("page").argKeys, [[], ["json", "json.device", "json.region", "json.value"], ["timeout"]]);
  assert.deepEqual(at("page_forwarded").argKeys[1], ["json", "json.device", "json.**extra"]);
  assert.deepEqual(at("page_opaque").argKeys[1], ["json"], "a variable payload: the name, nothing under it");
  assert.deepEqual(payloadKeys(at("page")), ["json", "json.device", "json.region", "json.value", "timeout"],
    "the architecture map's payload lens reads the same keys");
});

test("require: a missing key where the literal is visible is a violation; hidden sites are named, not failed", () => {
  const r = run({ rule: "payload-keys", target: "requests.post", require: ["json.device", "json.region"] });
  assert.equal(r.verdict, "violated");
  assert.deepEqual(r.offenders.map(fnOf), ["page_leaky"], "only the call whose literal visibly lacks region");
  assert.match(r.reason, /does not pass `json\.region`/);
  assert.ok(!r.offenders.some((o) => /page_forwarded|page_opaque/.test(o)), "spread and variable payloads are never offenders");
});

test("forbid: a spelled forbidden key is a violation naming the call", () => {
  const r = run({ rule: "payload-keys", target: "requests.post", forbid: ["json.password"] });
  assert.equal(r.verdict, "violated");
  assert.deepEqual(r.offenders.map(fnOf), ["page_leaky"]);
  assert.match(r.reason, /passes `json\.password`/);
});

test("pass says what it read; a rule no visible site can settle is unverifiable, not a pass", () => {
  const ok = run({ rule: "payload-keys", target: "requests.post", require: ["timeout"] });
  assert.equal(ok.verdict, "pass");
  assert.match(ok.reason, /all 4 call site\(s\).*values not checked/);

  const ts = run({ rule: "payload-keys", target: "publish", forbid: ["password"] });
  assert.equal(ts.verdict, "unverifiable", "sendSpread's `...base` could carry it");
  assert.match(ts.reason, /sendSpread/);
});

test("TypeScript: object-literal keys at a project function's call sites", () => {
  const r = run({ rule: "payload-keys", target: "publish", require: ["region"] });
  assert.equal(r.verdict, "violated");
  assert.deepEqual(r.offenders.map(fnOf), ["sendNoRegion"]);
  assert.match(r.reason, /does not pass `region`/);
});

test("no such call is unverifiable; malformed checks are refused at the boundary", () => {
  assert.equal(run({ rule: "payload-keys", target: "nowhere", require: ["x"] }).verdict, "unverifiable");
  assert.equal(isConstraintCheck({ rule: "payload-keys", target: "publish" }), false, "requires and forbids nothing");
  assert.equal(isConstraintCheck({ rule: "payload-keys", target: "publish", require: ["a.b.c"] }), false, "deeper than recorded");
  assert.equal(isConstraintCheck({ rule: "payload-keys", target: "", require: ["a"] }), false);
  const stored = validateConstraintInput({
    kind: "payload-schema", text: "every page carries device and region", scope: { all: true },
    check: { rule: "payload-keys", target: "requests.post", require: ["json.region"] },
  });
  assert.equal(stored.ok, true);
  assert.equal(validateConstraintInput({ kind: "payload-schema", text: "x", scope: { all: true }, check: { rule: "payload-keys", target: "p" } }).ok, false);
  assert.equal(describeCheck({ rule: "payload-keys", target: "publish", require: ["region"], forbid: ["password"] }),
    "every call to `publish` passes `region` and never passes `password`");
});

// Advisory until calibrated — and calibrated 2026-09-29 (record at 5b1de6c:
// 4/4 known-bad, 0 false positives over 61 good call sites), so it may gate.
test("calibrated: payload-keys may reject a packet, through its calibration record", () => {
  assert.equal(verbMayGate("payload-keys"), true);
  for (const v of ["callers-only", "import-only", "calls-through"]) assert.equal(verbMayGate(v), true);
});
