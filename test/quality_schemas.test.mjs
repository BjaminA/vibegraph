// Quality layer, Run 2 (reviews/quality-layer/RUN2.md): the schema layer,
// pinned three ways.
//
//   1. Every schema under schemas/quality/ compiles under Ajv 2020 STRICT.
//   2. Every vector in test/fixtures/quality/vectors.json validates or fails
//      exactly as labelled, and each failure carries the discipline it pins
//      (a pass must carry notFollowed; no `always`; gate-blocking needs a
//      calibration; a model's judgement never enters a gate; ...).
//   3. The registry INTERFACE refuses the wrong shapes at the type level
//      (tsc over test/fixtures/quality/registry_negatives.ts, every
//      @ts-expect-error must fire) and at runtime (isCheckResult, run(),
//      double registration).
//
// Plus one census the brief's no-numbers rule makes necessary: the only
// numeric keywords any quality schema may use are `minItems: 1` and
// `minLength: 1` (the structural form of "non-empty"). A `maximum`, a
// `maxItems`, a `minItems: 3` anywhere is a threshold someone typed in, and
// this test fails on it.
//
// Run: npm run test:quality-schemas

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { CheckRegistry, isCheckResult } from "../src/server/quality/check_registry.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA_DIR = join(ROOT, "schemas", "quality");
const BASE = "https://vibegraph.dev/schemas/quality/";

const SCHEMA_FILES = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".json")).sort();
const schemas = Object.fromEntries(SCHEMA_FILES.map((f) => [f, JSON.parse(readFileSync(join(SCHEMA_DIR, f), "utf-8"))]));

function makeAjv() {
  // strict: unknown keywords, untyped keywords and ambiguous unions are
  // ERRORS. strictRequired is the one strict flag relaxed: `anyOf` over
  // `required` is the standard way to say "at least one of these", and
  // check_grammar.json uses it for callers-only and not-in-loop.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  for (const s of Object.values(schemas)) ajv.addSchema(s);
  return ajv;
}

test("the eight quality schemas exist and compile under strict Ajv 2020", () => {
  // generic_skill.json joined 2026-09-22 (M-SKILLS.1): the manifest of a
  // generic skill, the prose half of a quality dimension.
  assert.deepEqual(SCHEMA_FILES, [
    "acceptance.json", "check_grammar.json", "evidence.json", "flow_spec.json",
    "generic_skill.json", "quality_model.json", "skill_manifest.json", "stack_profile.json",
  ]);
  const ajv = makeAjv();
  for (const f of SCHEMA_FILES) {
    assert.equal(schemas[f].$id, BASE + f, `${f}: $id must be ${BASE}${f} so relative $refs resolve`);
    const validate = ajv.getSchema(BASE + f);
    assert.ok(validate, `${f} compiled`);
  }
});

const vectors = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "quality", "vectors.json"), "utf-8"));

for (const [ref, { valid, invalid }] of Object.entries(vectors)) {
  if (ref === "_") continue;
  test(`vectors: ${ref}`, () => {
    const ajv = makeAjv();
    const validate = ajv.getSchema(BASE + ref);
    assert.ok(validate, `${ref} resolves`);
    for (const [i, inst] of valid.entries()) {
      const ok = validate(inst);
      assert.ok(ok, `valid[${i}] of ${ref} must validate: ${ajv.errorsText(validate.errors, { separator: "\n  " })}`);
    }
    for (const { why, instance } of invalid) {
      const ok = validate(instance);
      assert.equal(ok, false, `invalid vector must FAIL (${ref}): ${why}`);
    }
  });
}

test("no numeric threshold hides in any quality schema: only minItems 1 and minLength 1 are allowed", () => {
  const NUMERIC = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    "minItems", "maxItems", "minLength", "maxLength", "minProperties", "maxProperties", "minContains", "maxContains"]);
  const found = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (NUMERIC.has(k) && typeof v === "number") found.push({ path: `${path}.${k}`, value: v, keyword: k });
      // `properties` keys are field names, not keywords: descend without checking them.
      walk(v, `${path}.${k}`);
    }
  };
  for (const [f, s] of Object.entries(schemas)) walk(s, f);
  const offenders = found.filter((x) => !((x.keyword === "minItems" || x.keyword === "minLength") && x.value === 1));
  assert.deepEqual(offenders, [], `numeric thresholds in schemas: ${JSON.stringify(offenders)}`);
  assert.ok(found.length > 0, "the census saw the non-empty markers it expects");
});

test("the schema for a pass cannot be satisfied with an empty notFollowed, and Unknown always carries a reason", () => {
  const ajv = makeAjv();
  const pass = ajv.getSchema(BASE + "evidence.json#/$defs/Pass");
  const unknown = ajv.getSchema(BASE + "evidence.json#/$defs/Unknown");
  const prov = { kind: "derived", by: "t", commit: "c", at: "2026-09-12T10:00:00.000Z" };
  assert.equal(pass({ verdict: "pass", reason: "r", notFollowed: [], offenders: [], provenance: prov }), false);
  assert.equal(pass({ verdict: "pass", reason: "r", notFollowed: ["x"], offenders: [], provenance: prov }), true);
  assert.equal(unknown({ unknown: true }), false);
  assert.equal(unknown({ unknown: true, reason: "r" }), true);
});

test("type level: every wrong shape in registry_negatives.ts is refused by tsc", () => {
  const tsc = join(ROOT, "node_modules", ".bin", "tsc");
  if (!existsSync(tsc)) { assert.fail("typescript is a devDependency; node_modules/.bin/tsc is missing"); }
  const r = spawnSync(tsc, [
    "--noEmit", "--strict", "--target", "es2021", "--module", "esnext", "--moduleResolution", "bundler",
    "--allowImportingTsExtensions", "--skipLibCheck",
    join(ROOT, "test", "fixtures", "quality", "registry_negatives.ts"),
  ], { encoding: "utf-8" });
  // tsc exits non-zero when an @ts-expect-error line did NOT error (the
  // shape compiled) or when a positive binding failed to compile.
  assert.equal(r.status, 0, `tsc:\n${r.stdout}\n${r.stderr}`);
});

test("runtime: isCheckResult mirrors the schema", () => {
  const prov = { kind: "derived", by: "t", commit: "c", at: "now" };
  assert.equal(isCheckResult(true), false);
  assert.equal(isCheckResult({ verdict: "pass", reason: "r", notFollowed: [], offenders: [], provenance: prov }), false);
  assert.equal(isCheckResult({ verdict: "pass", reason: "r", notFollowed: ["x"], offenders: [], provenance: prov }), true);
  assert.equal(isCheckResult({ verdict: "violated", reason: "r", offenders: [], provenance: prov }), false);
  assert.equal(isCheckResult({ verdict: "violated", reason: "r", offenders: ["notify"], provenance: prov }), false, "an offender is file:node");
  assert.equal(isCheckResult({ verdict: "violated", reason: "r", offenders: ["a.py:module/f.fn/notify.call"], provenance: prov }), true);
  assert.equal(isCheckResult({ verdict: "unverifiable", reason: "r", cause: "dynamic", at: [], offenders: [], provenance: prov }), true);
  assert.equal(isCheckResult({ verdict: "unverifiable", reason: "r", at: [], offenders: [], provenance: prov }), false, "an unverifiable says why");
  const mj = { kind: "model_judgement", model: "m", promptHash: "h", at: "now", entersGate: false };
  assert.equal(isCheckResult({ verdict: "pass", reason: "r", notFollowed: ["x"], offenders: [], provenance: mj }), false, "a model's judgement never enters a gate");
});

test("runtime: the registry refuses double registration, unforced verbs, and non-results", () => {
  const facts = { references: [], importsByFile: {}, definedNames: [], unresolved: [], commit: "c" };
  const reg = new CheckRegistry();
  const good = {
    rule: "x", costClass: "local", forcedBy: ["AS-1"],
    isOperands: (v) => v && v.rule === "x" && typeof v.target === "string",
    preconditions: () => null,
    evaluate: () => ({ verdict: "pass", reason: "r", notFollowed: ["n"], offenders: [], provenance: { kind: "derived", by: "t", commit: "c", at: "now" } }),
    describe: () => "x",
  };
  reg.register(good);
  assert.throws(() => reg.register(good), /already registered/);
  assert.throws(() => reg.register({ ...good, rule: "y", forcedBy: [] }), /no forcing assertion/);

  const r1 = reg.run(facts, { rule: "x", target: "notify" });
  assert.equal(r1.verdict, "pass");
  const r2 = reg.run(facts, { rule: "x" });
  assert.equal(r2.verdict, "unverifiable");
  assert.equal(r2.cause, "precondition");
  assert.match(r2.reason, /refused, not coerced/);
  const r3 = reg.run(facts, { rule: "nope" });
  assert.equal(r3.verdict, "unverifiable");

  reg.register({ ...good, rule: "bool", isOperands: () => true, evaluate: () => true });
  assert.throws(() => reg.run(facts, { rule: "bool" }), /not a CheckResult/);
  reg.register({ ...good, rule: "emptypass", isOperands: () => true, evaluate: () => ({ ...good.evaluate(), notFollowed: [] }) });
  assert.throws(() => reg.run(facts, { rule: "emptypass" }), /not a CheckResult/);
});
