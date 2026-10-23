// Rule claims (2026-10-22, the root-cause handoff RC1: "anything a model
// writes about code is a claim until the IR confirms it"). A drafted rule
// states what the code does as typed claims; each is decided against the IR
// before the rule is stored, and again after every edit.
//
// Two synthetic projects, the same three shapes in Python and TypeScript:
// a nightly job that runs THREE scripts while its README names two, an
// enrich step that writes THREE fields while its docstring says one, and a
// folder whose one networked module breaks "this folder never touches the
// network".
//
//   npm run test:rule-claims
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { checkClaim, claimFactsFromEnvelope, correctedText, whyContradicts, writtenKey } from "../src/server/rule_claims.ts";
import { claimCorrectionInWords, claimInWords, isClaimCheck } from "../src/shared/rule_claim_types.ts";
import { gateRuleDraft } from "../src/server/rule_draft_gate.ts";
import { buildRuleDraftPrompt } from "../src/server/rule_draft.ts";
import { checkStatedRules } from "../src/server/constraint_report.ts";
import { validateConstraintInput } from "../src/server/constraint_store.ts";
import { readableRule } from "../src/shared/rule_readable.ts";

const DEMOS = {
  py: { root: "test/fixtures/claims/py_demo", job: "ops/nightly.py", run: ["ops/build_index.py", "ops/build_site.py", "ops/check_links.py"],
    writer: "records/enrich.py:enrich_codes", one: "records/enrich.py:mark_reviewed", oneField: "reviewed_at", fields: ["codes", "origins", "updated_at"],
    folder: "geometry/", clean: ["geometry/area.py", "geometry/bounds.py"], net: "geometry/download.py", tool: "requests" },
  ts: { root: "test/fixtures/claims/ts_demo", job: "scripts/nightly.ts", run: ["scripts/build_index.mjs", "scripts/build_site.mjs", "scripts/check_links.mjs"],
    writer: "src/records.ts:enrichCodes", one: "src/records.ts:markReviewed", oneField: "reviewedAt", fields: ["codes", "origins", "updatedAt"],
    folder: "src/geometry/", clean: ["src/geometry/area.ts", "src/geometry/bounds.ts"], net: "src/geometry/download.ts", tool: "axios" },
};
const built = {};
before(() => {
  for (const [k, d] of Object.entries(DEMOS)) {
    const env = buildPolyglotEnvelope(d.root).envelope;
    const stack = buildStackIndex(env, d.root);
    built[k] = { env, stack, facts: claimFactsFromEnvelope(env, stack) };
  }
});

for (const [lang, d] of Object.entries(DEMOS)) {
  test(`${lang}: "runs only" is corrected to every script the code runs`, () => {
    const v = checkClaim({ predicate: "runs-only", subject: [d.job], objects: ["build_site", "build_index"] }, built[lang].facts);
    assert.equal(v.verdict, "contradicted");
    assert.deepEqual(v.observed, d.run);
    assert.deepEqual(v.corrected.objects, d.run);
    assert.deepEqual(v.corrected.was, ["build_site", "build_index"], "what the model said is kept");
    assert.equal(checkClaim({ predicate: "runs-only", subject: [d.job], objects: d.run }, built[lang].facts).verdict, "verified");
  });

  test(`${lang}: "writes only" is corrected to every field the function writes`, () => {
    const v = checkClaim({ predicate: "writes-only", subject: [d.writer], objects: ["codes"] }, built[lang].facts);
    assert.equal(v.verdict, "contradicted");
    assert.deepEqual(v.corrected.objects, d.fields);
    assert.match(v.reason, /it also writes/);
    assert.equal(checkClaim({ predicate: "writes-only", subject: [d.one], objects: [d.oneField] }, built[lang].facts).verdict, "verified");
  });

  test(`${lang}: "never calls the network" over a folder narrows to the files that keep it`, () => {
    const v = checkClaim({ predicate: "never-calls", subject: [d.folder], objects: ["network"] }, built[lang].facts);
    assert.equal(v.verdict, "contradicted");
    assert.deepEqual(v.counterexamples.map((c) => c.file), [d.net]);
    assert.deepEqual(v.corrected.subject, d.clean);
    assert.deepEqual(v.corrected.wasSubject, [d.folder]);
    assert.equal(checkClaim({ predicate: "never-calls", subject: d.clean, objects: ["network"] }, built[lang].facts).verdict, "verified");
    assert.equal(checkClaim({ predicate: "reaches", subject: [d.net], objects: [d.tool] }, built[lang].facts).verdict, "verified");
  });

  test(`${lang}: a claim the code holds nothing about is unverifiable, never a pass`, () => {
    const f = built[lang].facts;
    assert.equal(checkClaim({ predicate: "runs-only", subject: ["nowhere/at_all.py"], objects: ["x"] }, f).verdict, "unverifiable");
    const v = checkClaim({ predicate: "runs-only", subject: [d.clean[0]], objects: ["build_site"] }, f);
    assert.equal(v.verdict, "unverifiable", "a file that runs nothing cannot decide a runs-only claim");
  });
}

test("a script run by a bare literal no one file answers to matches the path a claim names, either way round", () => {
  const facts = { env: { files: { "ops/beat.py": { nodes: [] } }, entryPoints: [] }, importsByFile: {}, roleOf: new Map(),
    commands: [{ file: "ops/beat.py", nodeId: "module/main.fn/x.call", ran: "build.py" }, { file: "ops/beat.py", nodeId: "module/main.fn/x.call@1", ran: "tools/check.py" }] };
  assert.equal(checkClaim({ predicate: "runs-only", subject: ["ops/beat.py"], objects: ["tools/build.py", "check.py"] }, facts).verdict, "verified");
  const v = checkClaim({ predicate: "runs-only", subject: ["ops/beat.py"], objects: ["tools/build.py"] }, facts);
  assert.equal(v.reason, "it also runs tools/check.py", "never \"it never runs tools/build.py\"");
});

test("Python assignment targets a name cannot spell carry their source text; ids unchanged", () => {
  const nodes = built.py.env.files["records/enrich.py"].nodes.filter((n) => n.type === "assignment");
  assert.deepEqual(nodes.map((n) => n.targetText), ['record["codes"]', 'record["origins"]', 'record["updated_at"]', 'record["reviewed_at"]']);
  assert.deepEqual(nodes.map((n) => n.id).slice(0, 2), ["module/enrich_codes.fn/?.assign", "module/enrich_codes.fn/?.assign@1"]);
  assert.equal(writtenKey({ name: "record.updatedAt" }), "updatedAt");
  assert.equal(writtenKey({ name: "total" }), null, "a bare local is no field");
});

test("a claim in words, its correction, and the corrected sentence", () => {
  const c = { rule: "claim", predicate: "runs-only", subject: ["ops/nightly.py"], objects: DEMOS.py.run, was: ["build_site.py", "build_index.py"] };
  assert.ok(isClaimCheck(c));
  assert.equal(claimInWords(c), "ops/nightly.py runs only ops/build_index.py, ops/build_site.py and ops/check_links.py");
  assert.match(claimCorrectionInWords(c), /^Corrected from the code: Claude said build_site\.py and build_index\.py; the code shows/);
  assert.equal(correctedText("It builds only by running build_site.py and build_index.py. It never writes pages itself.", c),
    "ops/nightly.py runs only ops/build_index.py, ops/build_site.py and ops/check_links.py. It never writes pages itself.");
  assert.match(whyContradicts({ predicate: "runs-only", objects: ["build_site.py"] }, "the job runs build_site.py and check_links.py"), /check_links\.py/);
  assert.equal(isClaimCheck({ rule: "claim", predicate: "guesses", subject: ["a"], objects: ["b"] }), false, "an unknown predicate is refused");
  assert.equal(isClaimCheck({ rule: "claim", predicate: "reaches", subject: ["../etc"], objects: ["b"] }), false);
});

test("the store takes a claim as a check clause and refuses a malformed one", () => {
  const ok = validateConstraintInput({ kind: "invariant", text: "t", scope: { all: true }, checks: [{ rule: "claim", predicate: "never-calls", subject: ["geometry/"], objects: ["network"] }] });
  assert.ok(ok.ok);
  const bad = validateConstraintInput({ kind: "invariant", text: "t", scope: { all: true }, check: { rule: "claim", predicate: "never-calls", subject: [], objects: ["network"] } });
  assert.equal(bad.ok, false);
});

test("the prompt asks for claims, in the shapes the gate decides", () => {
  const p = buildRuleDraftPrompt({ project: "p", counts: { files: 1, entryPoints: 1 }, items: [], stated: [], vocab: { entryPoints: [], folders: [], tools: [] } });
  assert.match(p, /## Claims: anything the rule says the code DOES/);
  for (const pred of ["runs-only", "writes-only", "imports-only", "never-calls", "reaches"]) assert.match(p, new RegExp(`"predicate":"${pred}"`));
  assert.match(p, /"claims":\[\]/);
});

// ── the gate: verified stored as a check, contradicted corrected / narrowed / refused ──
const DOSSIER = { project: "p", counts: { files: 8, entryPoints: 4 }, items: [{ id: "crossing:1", kind: "crossing", text: "the nightly job runs scripts" }], stated: [], vocab: { entryPoints: [], folders: [], tools: [] } };
const rule = (text, claims, extra = {}) => ({ kind: "invariant", text, why: extra.why ?? "the facts say so", scope: extra.scope ?? { files: ["ops/", "geometry/"] }, cites: ["crossing:1"], ...(claims ? { claims } : {}) });

function gate(rules) {
  const { env, stack, facts } = built.py;
  return gateRuleDraft(JSON.stringify({ rules }), DOSSIER, {
    existing: [], files: new Set(Object.keys(env.files)), entryPoints: new Set(env.entryPoints.map((e) => e.id)),
    tools: new Set(stack.tools.map((t) => t.tool)), claims: facts, model: "test",
  });
}

test("the gate corrects a contradicted claim from the code and stores it as a check", () => {
  const g = gate([rule("The nightly job builds only by running build_site.py and build_index.py. It never writes pages itself.",
    [{ predicate: "runs-only", subject: ["ops/nightly.py"], objects: ["build_site.py", "build_index.py"] }])]);
  assert.equal(g.accepted.length, 1, JSON.stringify(g.refused));
  const r = g.accepted[0];
  assert.match(r.input.text, /^ops\/nightly\.py runs only ops\/build_index\.py, ops\/build_site\.py and ops\/check_links\.py\. It never writes pages itself\. \(why:/);
  const clause = r.input.checks.find((c) => c.rule === "claim");
  assert.deepEqual(clause.was, ["build_site.py", "build_index.py"]);
  assert.equal(r.verdict, "pass");
  assert.match(r.input.note, /its claim was corrected from the code/);
});

test("the gate narrows a folder claim, refuses an uncorrectable one, refuses a why that contradicts its claim", () => {
  const g = gate([
    rule("The geometry folder never touches the network.", [{ predicate: "never-calls", subject: ["geometry/"], objects: ["network"] }], { scope: { files: ["geometry/"] } }),
    rule("The area module reaches requests.", [{ predicate: "reaches", subject: ["geometry/area.py"], objects: ["requests"] }]),
    rule("The area module runs only the site build.", [{ predicate: "runs-only", subject: ["geometry/area.py"], objects: ["build_site.py"] }], { why: "it runs build_site.py and check_links.py" }),
  ]);
  assert.equal(g.accepted.length, 1);
  assert.deepEqual(g.accepted[0].input.scope.files, ["geometry/area.py", "geometry/bounds.py"]);
  assert.match(g.accepted[0].input.note, /narrowed to geometry\/area\.py and geometry\/bounds\.py: geometry\/download\.py:6 \(requests\.get\) breaks it/);
  assert.equal(g.refused.length, 2);
  assert.match(g.refused[0].reason, /^the code contradicts it: nothing in geometry\/area\.py reaches requests/);
  assert.match(g.refused[1].reason, /^its own reason names check_links\.py, which the claim leaves out; the code could not decide it/);
});

test("an 'only' sentence with no claim and no check is labelled as decided by nothing", () => {
  const g = gate([rule("Only the enrich step writes codes.", null)]);
  assert.equal(g.accepted.length, 1);
  assert.match(g.accepted[0].input.note, /it states what the code does, and nothing checked it against the code/);
  const words = readableRule({ text: g.accepted[0].input.text, note: g.accepted[0].input.note, source: "agent" });
  assert.match(words.check, /^Not checked automatically: it says what the code does/);
});

test("a stored claim is decided again by `check`: pass while the code agrees, violated with the extra", () => {
  const { env, stack } = built.py;
  const stated = (id, check) => ({ id, kind: "invariant", source: "human", text: "t", scope: { all: true }, createdAt: "", checks: [check] });
  const report = checkStatedRules({ envelope: env, root: DEMOS.py.root, stack, constraints: [
    stated("c1", { rule: "claim", predicate: "runs-only", subject: ["ops/nightly.py"], objects: DEMOS.py.run }),
    stated("c2", { rule: "claim", predicate: "writes-only", subject: [DEMOS.py.writer], objects: ["codes"] }),
    stated("c3", { rule: "claim", predicate: "never-calls", subject: ["geometry/"], objects: ["network"] }),
  ] });
  const by = Object.fromEntries(report.results.map((r) => [r.id, r]));
  assert.equal(by.c1.verdict, "pass");
  assert.equal(by.c1.described, "ops/nightly.py runs only ops/build_index.py, ops/build_site.py and ops/check_links.py");
  assert.equal(by.c2.verdict, "violated");
  assert.deepEqual(by.c2.offenders, ["origins", "updated_at"]);
  assert.equal(by.c3.verdict, "violated");
  assert.deepEqual(by.c3.offenders, ["geometry/download.py:6 requests.get"]);
});
