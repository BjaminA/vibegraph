// The Brief's checks (2026-10-08, the review of the first Brief, B7–B13), on a
// copy of test/fixtures/system/views_demo with two rules a person stated, a
// probe that writes status, the project's handover and a tool's feedback log
// (test/brief_checks_setup.mjs). Each check is asserted the way it refuses or
// warns, through the same parse and review the CLI, the card and the inbox use.
//
//   npm run test:brief-checks
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { briefChecksProject } from "./brief_checks_setup.mjs";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { briefInputs } from "../src/server/brief_inputs.ts";
import { parseBrief } from "../src/server/brief_validate.ts";
import { reviewBrief } from "../src/server/brief_review.ts";
import { citationChange } from "../src/server/brief_store.ts";
import { modelSource } from "../src/server/model_source.ts";

const { tmp, proj } = briefChecksProject();
after(() => rmSync(tmp, { recursive: true, force: true }));
const env = buildPolyglotEnvelope(proj).envelope;
const model = archModelForEnvelope(env, buildStackIndex(env, proj), buildCrossingIndex(env), proj);
const inputs = (notes) => briefInputs(proj, model, { notes });
const { facts, vocab, opVocab } = inputs();
const parse = (spec, f = facts, omitted = []) => parseBrief(JSON.stringify({ spec: { function: [], method: [], feature: [], ...spec }, omitted }), f, vocab, opVocab, { model: "test" });
const reasons = (b) => b.refused.map((r) => `${r.item}: ${r.reason}`).join("\n");

const APP = "cluster:cli-package-script:app", GATEWAY = "cluster:cli-package-script:gateway", DECIDER = "cluster:scripts:decider";
const PROBE_EDGE = "cluster:scripts:.->zone:ledger/status:uses:write";
const DECIDER_WRITE = "cluster:scripts:decider->zone:ledger/status:uses:write";

test("B8: evidence has a role; a method line resting only on a test or a rule is refused", () => {
  assert.equal(facts.roles.get("decider/src/transitions.ts:7"), "enforce", "the function rule c1 guards is where it is applied");
  assert.equal(facts.roles.get(PROBE_EDGE), "verify", "a write made only by a probe tests the rule");
  assert.equal(facts.roles.get("rule:c1"), "declare");
  assert.equal(facts.roles.get("docs/HANDOVER.md:3"), "doc");
  const b = parse({ method: [
    { text: "Enforces one writer of status: a live probe's write is refused.", words: ["enforces"], cites: [PROBE_EDGE, "rule:c1"] },
    { text: "Enforces one writer of status in the transition function.", words: ["enforces"], cites: ["decider/src/transitions.ts:7"], boxes: [DECIDER] },
  ] }).brief;
  assert.deepEqual(b.spec.method.map((l) => l.text), ["Enforces one writer of status in the transition function."]);
  assert.match(reasons(b), /rests only on verify \/ declare evidence/);
  const r = reviewBrief({ function: [], feature: [], method: [{ text: "Validates each request in the decider.", words: ["validates"], cites: [DECIDER_WRITE] }] }, facts);
  assert.match(r.lines[0].warnings.join("\n"), /"validates" with no \[enforce\] citation/, "a mechanism word with no [enforce] evidence is shown");
  assert.deepEqual(r.lines[0].byRole, { use: [DECIDER_WRITE] });
});

test("B9: data claims are checked against the map — contradicted refuses, plan-only and unverifiable are shown", () => {
  const b = parse({
    function: [
      { text: "Serves clerks, who own the order requests.", words: ["serves"], cites: [`${APP}->zone:ledger/requests:uses:write`], claims: [{ subject: APP, verb: "owns", object: "zone:ledger/requests" }] },
      { text: "Decides order phases: the decider writes order status.", words: ["decides"], cites: [DECIDER_WRITE], claims: [{ subject: DECIDER, verb: "writes", object: "zone:ledger/status" }] },
    ],
    method: [{ text: "Watches requests: the decider reads each request as it is filed.", words: ["watches"], cites: ["plan:flows:order-request", DECIDER_WRITE], boxes: [DECIDER], claims: [{ subject: DECIDER, verb: "reads", object: "requests" }] }],
  }).brief;
  assert.match(reasons(b), /claim "[^"]*app owns zone:ledger\/requests" is contradicted: ledger\/requests is one partition per Role: it has no single owner/);
  assert.deepEqual(b.spec.function.map((l) => l.text), ["Decides order phases: the decider writes order status."]);
  assert.equal(b.spec.method.length, 1);
  const r = reviewBrief(b.spec, facts);
  assert.deepEqual(r.lines.find((l) => l.part === "function").claims.map((c) => c.verdict), ["supported"]);
  assert.match(r.lines.find((l) => l.part === "method").warnings.join("\n"), /rests on the plan only: the plan declares it \(plan:flows:order-request\); the code shows no such call/);
  assert.ok(r.gaps.some((g) => /plan:flows:order-request says .*decider reads ledger\/requests; the code shows no such call/.test(g)), r.gaps.join("\n"));
  const own = parse({ function: [{ text: "Serves clerks: each role owns its own request partition.", words: ["serves"], cites: [`${APP}->zone:ledger/requests:uses:write`], claims: [{ subject: APP, verb: "owns", object: "zone:ledger/requests", partition: ["Person"] }] }] });
  assert.match(reasons(own.brief ?? { refused: [] }) || own.error, /partitioned by Role, not Person/);
});

test("B11: an absolute word needs a stated rule or an absence the map confirms", () => {
  const b = parse({ feature: [
    { text: "Only the decider applies a transition to status.", words: ["fail-closed"], cites: ["rule:c1", DECIDER_WRITE] },
    { text: "The partner gateway writes no order status.", words: ["per-identity-access"], cites: [`${GATEWAY}->zone:ledger/status:uses:read`], claims: [{ subject: GATEWAY, verb: "writes", object: "zone:ledger/status", not: true }] },
    { text: "The clerk app writes nothing to the ledger.", words: ["per-identity-access"], cites: [`${APP}->zone:ledger/records:uses:write`], claims: [{ subject: APP, verb: "writes", object: "*", not: true }] },
    { text: "Approvals are never changed by clerks.", words: ["audit-trail"], cites: ["cluster:scripts:.->zone:ledger/approver:uses:write"] },
  ] }).brief;
  assert.deepEqual(b.spec.feature.map((l) => l.text), ["Only the decider applies a transition to status.", "The partner gateway writes no order status."]);
  const why = reasons(b);
  assert.match(why, /claim "[^"]*app never writes \*" is contradicted: the code shows [^\n]*app write ledger\/records/);
  assert.match(why, /the absolute word "never" needs a stated rule that says it/);
});

test("B10 + B12: a process's main job, the people's rules and the salient mechanisms are covered or named", () => {
  const spec = { function: [], feature: [], method: [
    { text: "Funnels partner requests into the ledger through the gateway.", words: ["funnels"], cites: [`${GATEWAY}->zone:ledger/requests:uses:write`], boxes: [GATEWAY], claims: [{ subject: GATEWAY, verb: "writes", object: "zone:ledger/requests" }] },
    { text: "Enforces one writer of status in the transition function.", words: ["enforces"], cites: ["decider/src/transitions.ts:7", "rule:c1"], boxes: [DECIDER], claims: [{ subject: DECIDER, verb: "writes", object: "zone:ledger/status" }] },
  ] };
  const r = reviewBrief(spec, facts);
  const gw = r.lines.find((l) => l.text.startsWith("Funnels"));
  assert.match(gw.warnings.join("\n"), /presents a secondary operation of .*gateway as its main job — its primary is read ledger\/status/);
  assert.deepEqual(r.uncovered.rules, ["c2"], "c2 is cited by no line");
  assert.ok(r.uncovered.salient.includes("lib/store.ts"), "the store funnel every process goes through");
  assert.ok(!r.uncovered.salient.includes("decider/src/transitions.ts"), "cited at its enforce line");
  assert.ok(r.uncovered.primary.some((p) => /gateway: read ledger\/status/.test(p)));
  // the decider's part in the plan's flow STARTS by reading requests; writing
  // status follows from it — so a line saying only that it writes status
  // presents its secondary job as its main one
  assert.ok(r.uncovered.primary.some((p) => /decider: read ledger\/requests/.test(p)), r.uncovered.primary.join("\n"));
  assert.match(r.lines.find((l) => l.text.startsWith("Enforces")).warnings.join("\n"), /secondary operation of .*decider as its main job — its primary is read ledger\/requests \(declared by the plan\)/);
  const named = reviewBrief(spec, facts, { omitted: ["c2 — retention is a policy, nothing in the code shows it", "lib/store.ts is plumbing", "the gateway's reads"] });
  assert.deepEqual(named.uncovered.rules, []);
  assert.ok(!named.uncovered.salient.includes("lib/store.ts"));
  assert.match(r.summary, /^2 lines, 2 with warnings; 1 stated rule not covered; 2 core mechanisms not covered; \d processes without their main job stated$/);
  assert.equal(r.ratifyLabel, "Ratify 2 lines, 2 with warnings");
  // a brief written before claims: one note on the sheet, not a warning per line
  const legacy = reviewBrief({ function: [{ text: "Decides order phases: the decider writes status.", words: ["decides"], cites: [DECIDER_WRITE], boxes: [DECIDER] }], method: [], feature: [] }, facts);
  assert.deepEqual(legacy.lines[0].warnings, []);
  assert.match(legacy.summary, /data claims are prose only/);
});

test("B12 docs: ranked by this code, a tool's own feedback left out, a project's exclusions honoured", () => {
  assert.match(facts.text, /docs\/HANDOVER\.md:3: The decider applies each transition/);
  assert.doesNotMatch(facts.text, /vibegraph-feedback/);
  writeFileSync(join(proj, ".vibegraph/brief-vocabulary.json"), JSON.stringify({ excludeDocs: ["docs/HANDOVER.md"] }));
  try { assert.doesNotMatch(inputs().facts.text, /HANDOVER/); } finally { rmSync(join(proj, ".vibegraph/brief-vocabulary.json")); }
});

test("B13 notes: each correction must be answered — a line cites it, or omitted says why", () => {
  const withNote = inputs(["Requests are kept per role; the decider reads every request."]);
  assert.equal(withNote.facts.roles.get("note:1"), "note");
  const ask = (spec, omitted = []) => parseBrief(JSON.stringify({ spec: { function: [], method: [], feature: [], ...spec }, omitted }), withNote.facts, withNote.vocab, withNote.opVocab, { model: "test" }).brief;
  const silent = ask({ function: [{ text: "Decides order phases in the decider.", words: ["decides"], cites: [DECIDER_WRITE] }] });
  assert.match(reasons(silent), /note:1: the person's note "Requests are kept per role/);
  assert.deepEqual(silent.notes, ["Requests are kept per role; the decider reads every request."]);
  const answered = ask({ method: [{ text: "Watches requests: the decider reads each role's requests.", words: ["watches"], cites: ["note:1", DECIDER_WRITE], boxes: [DECIDER], claims: [{ subject: DECIDER, verb: "reads", object: "zone:ledger/requests", partition: ["Role"] }] }] });
  assert.doesNotMatch(reasons(answered), /note:1/);
});

test("B7: one source for prompt and allow-list; a model copy without its source never reads as changed", () => {
  for (const m of facts.text.matchAll(/([\w@][\w@./-]*\.(?:ts|mjs|md)):(\d+)\b/g)) assert.ok(facts.cites.has(`${m[1]}:${m[2]}`), `${m[1]}:${m[2]} is printed, so it is citable`);
  assert.ok(facts.cites.has("tools/probe-status.ts:4"), "named inside an edge's basis (`file: … at line 4`), so citable");
  assert.equal(facts.roles.get("tools/probe-status.ts:4"), "verify");
  const saved = { scheme: 2, hashes: {}, basis: {}, codeHashes: {} };
  const p = parse({ feature: [{ text: "Only the decider applies a transition to status.", words: ["fail-closed"], cites: ["rule:c1", DECIDER_WRITE] }] }).brief;
  Object.assign(saved, { hashes: p.hashes, basis: p.basis, codeHashes: p.codeHashes });
  assert.ok(saved.codeHashes["rule:c1"], "the code rule c1 guards is hashed apart from the rule");
  const copy = { ...model };
  assert.equal(modelSource(copy), null, "a spread copy has no source");
  const noSource = briefInputs(proj, copy).facts;
  assert.equal(citationChange("rule:c1", saved, noSource), null, "the guarded code cannot be read: not known, never 'changed'");
  assert.equal(citationChange("rule:c1", saved, facts), null);
});
