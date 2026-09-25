/**
 * Generic skills (M-SKILLS.1, PLAN-M-SKILLS.md) — the parser, the schema,
 * the selector, and the floor that no skill applies everywhere.
 *
 * Pinned:
 *   * every skills/<name>/SKILL.md parses with zero problems and its
 *     manifest validates against schemas/quality/generic_skill.json under
 *     strict Ajv 2020 with the siblings loaded;
 *   * the committed manifests under reviews/skills/derived/ match what the
 *     parser derives now, modulo provenance (a drift check, the M-TABLES
 *     shape: regeneration must be byte-identical or the test says why);
 *   * applies_when is MEASURED on the fleet-telemetry profile: each skill
 *     fires on at least one thread and on fewer than all of them; three
 *     threads are pinned by name so a predicate that quietly stops
 *     matching a fact's real shape (boolean vs list) is caught;
 *   * selection mirrors applyRoutingBudget: disabled, not-applicable,
 *     over-budget and already-in-session are each NAMED, never silent;
 *   * a rule without its why, without a binding, with an unknown binding,
 *     or a binds line that lies about the rules, is refused.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/generic_skills.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  loadGenericSkills, parseGenericSkill, selectGenericSkills, readSkillsConfig, genericSkillProvenanceLine, GENERIC_SKILL_BODY_CEILING,
  sanitiseSkillsConfig, packetTaskFacts, renderGenericSkillsBlock, auditOf, describeAudit, catalogueOf,
} from "../src/server/generic_skills.ts";
import { manifestOf, measureAppliesWhen } from "../scripts/skills_validate.mjs";
import { SKILL_INJECTION_BUDGET_CHARS } from "../src/server/thread_remit.ts";

const ROOT = process.cwd();
const SKILLS = join(ROOT, "skills");
const SCHEMA_DIR = join(ROOT, "schemas", "quality");
const DERIVED = join(ROOT, "reviews", "skills", "derived");
const BASE = "https://vibegraph.dev/schemas/quality/";
const profile = JSON.parse(readFileSync(join(ROOT, "reviews", "quality-layer", "derived", "fleet-telemetry", "stack_profile.json"), "utf-8"));

function ajv() {
  const a = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(a);
  for (const f of readdirSync(SCHEMA_DIR).filter((x) => x.endsWith(".json"))) a.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, f), "utf-8")));
  return a;
}

const { skills, problems } = loadGenericSkills(SKILLS);
const byName = Object.fromEntries(skills.map((s) => [s.name, s]));
const EXPECTED = ["boundary-integrity", "change-coupling", "failure-visibility", "repetition-cost", "resolvability", "retry-root-cause"];

test("the six generic skills parse with zero problems", () => {
  assert.deepEqual(problems, {}, JSON.stringify(problems, null, 2));
  assert.deepEqual(skills.map((s) => s.name), EXPECTED);
  for (const s of skills) {
    assert.ok(s.rules.length >= 3, `${s.name}: at least three rules`);
    assert.ok(s.rules.every((r) => r.why.length > 20), `${s.name}: every why is a reason, not a word`);
    assert.ok(s.limits.length >= 1 && s.refused.length >= 1);
    assert.ok(s.body.length <= GENERIC_SKILL_BODY_CEILING);
    // D7 — advisory until drilled. The schema requires `drill` when
    // `evidence` is validated; this asserts the harder half the schema
    // cannot: the cited record EXISTS and is about THIS skill. Until
    // M-SKILLS.3 ran, every skill was unvalidated and this read
    // `assert.equal(s.evidence, "unvalidated")`; that was a census of the
    // day, not the contract, and a drill that validates a skill must not
    // be reported as a test failure.
    assert.ok(["unvalidated", "validated"].includes(s.evidence), `${s.name}: ${s.evidence}`);
    if (s.evidence === "validated") {
      assert.ok(s.drill, `${s.name}: validated with no drill cited`);
      const record = join(ROOT, s.drill);
      assert.ok(existsSync(record), `${s.name}: cites ${s.drill}, which does not exist`);
      const text = readFileSync(record, "utf-8");
      assert.ok(text.includes(s.name), `${s.name}: ${s.drill} does not name the skill it validates`);
    }
  }
});

test("every manifest validates against generic_skill.json under strict Ajv", () => {
  const validate = ajv().getSchema(BASE + "generic_skill.json");
  assert.ok(validate, "generic_skill.json compiled");
  for (const s of skills) {
    const ok = validate(manifestOf(s, "test"));
    assert.ok(ok, `${s.name}: ${JSON.stringify(validate.errors)}`);
  }
});

test("the committed derived manifests match what the parser derives now (drift check)", () => {
  const strip = (m) => JSON.stringify({ ...m, provenance: undefined });
  for (const s of skills) {
    const p = join(DERIVED, `${s.name}.manifest.json`);
    assert.ok(existsSync(p), `${p} exists (scripts/skills_validate.mjs --write)`);
    assert.equal(strip(JSON.parse(readFileSync(p, "utf-8"))), strip(manifestOf(s, "test")), `${s.name}: run skills_validate.mjs --write after reviewing the change`);
  }
});

test("applies_when is measured on the fleet profile, pinned per thread against each fact's REAL shape", () => {
  const n = Object.keys(profile.threads).length;
  assert.ok(n >= 30, `fleet profile has ${n} threads`);
  for (const s of skills) assert.ok(measureAppliesWhen(s, profile).length >= 1, `${s.name} fires on no thread`);
  // Booleans stringify ("true"); roles and languages are lists; a thread
  // INHERITS project facts it does not carry (predicate.ts), which is why
  // a project-level fact selects every thread and a thread-level one does
  // not — both pinned here so a predicate written against the wrong shape
  // cannot pass by accident.
  const fires = (name, ep) => measureAppliesWhen(byName[name], profile).includes(ep);
  assert.ok(fires("boundary-integrity", "telemetry/app.py:ingest_route"), "a route calling db + http-client");
  assert.ok(!fires("boundary-integrity", "codec/main.cpp:main"), "a C++ cli calling only the runtime: thread-level rolesCalled wins");
  assert.ok(fires("failure-visibility", "telemetry/ingest.py:ingest_batch"), "python has a log role");
  assert.ok(!fires("failure-visibility", "ops/backup.sh:main"), "bash has no log role: the verb says unverifiable, so the skill stays quiet");
  assert.ok(fires("repetition-cost", "telemetry/ingest.py:ingest_batch"), "calls db");
  assert.ok(!fires("repetition-cost", "codec/main.cpp:main"), "no external: round-trip direction would be noise here");
  assert.ok(fires("resolvability", "telemetry/app.py:ingest_route"), "python with unattributed boundaries on the thread");
  assert.ok(fires("resolvability", "telemetry/ingest.py:ingest_batch"), "python; the thread inherits the project's unattributed count");
  assert.ok(!fires("resolvability", "codec/main.cpp:main"), "no paramTypes outside python");
  assert.ok(fires("change-coupling", "telemetry/ingest.py:ingest_batch"), "calls db");
  assert.ok(fires("change-coupling", "ops/backup.sh:main"), "testsPresent is a PROJECT fact: on a tested project the pair rules reach every thread, which is a regime, not an always");
  assert.equal(measureAppliesWhen(byName["retry-root-cause"], profile).length, n, "the retry skill is measured with the task fact on; it fires on none at rest (next test)");
});

test("the retry skill fires only with the retry task fact, never at rest", () => {
  const s = byName["retry-root-cause"];
  const ep = "telemetry/ingest.py:ingest_batch";
  const at = (task) => selectGenericSkills({ skills: [s], config: { version: "1.0", enabled: [s.name] }, profile, entryPointId: ep, task, budgetChars: 99999, alreadyInjected: new Map() }).routed[0];
  assert.equal(at(undefined).omitted, "not-applicable");
  assert.equal(at({ retry: false }).omitted, "not-applicable");
  assert.equal(at({ retry: true }).skill, s.body);
});

test("selection names every omission: disabled, not-applicable, over-budget, already-in-session", () => {
  const ep = "telemetry/app.py:ingest_route";
  const all = { version: "1.0", enabled: EXPECTED, enabledBy: { "boundary-integrity": { source: "human", id: "ben", at: "2026-09-22T10:00:00Z" } } };
  // Off by default.
  let r = selectGenericSkills({ skills, config: { version: "1.0", enabled: [] }, profile, entryPointId: ep, budgetChars: 99999, alreadyInjected: new Map() });
  assert.ok(r.routed.every((x) => x.omitted === "disabled"), "nothing injects that a human did not enable");
  assert.deepEqual(r.injected, []);
  // Enabled: the applicable ones inject, the rest say why.
  r = selectGenericSkills({ skills, config: all, profile, entryPointId: ep, budgetChars: 99999, alreadyInjected: new Map() });
  const got = Object.fromEntries(r.routed.map((x) => [x.name, x.skill ? "injected" : x.omitted]));
  assert.equal(got["boundary-integrity"], "injected");
  assert.equal(got["retry-root-cause"], "not-applicable");
  assert.equal(r.injected.length, r.routed.filter((x) => x.skill).length);
  // Budget: the thread skill has first claim; what remains is what these get.
  const small = selectGenericSkills({ skills, config: all, profile, entryPointId: ep, budgetChars: byName["boundary-integrity"].body.length, alreadyInjected: new Map() });
  assert.equal(small.routed.find((x) => x.name === "boundary-integrity").skill, byName["boundary-integrity"].body);
  assert.ok(small.routed.some((x) => x.omitted === "over-budget"), "the second applicable skill is named over-budget, not dropped");
  // Dedup: an identical body already sent this session re-routes as a reference.
  const sent = new Map(r.injected);
  const again = selectGenericSkills({ skills, config: all, profile, entryPointId: ep, budgetChars: 99999, alreadyInjected: sent });
  assert.ok(again.routed.filter((x) => x.omitted === "already-in-session").length === r.injected.length);
  // The provenance line says who enabled it and that it is not a gate.
  const line = genericSkillProvenanceLine(r.routed.find((x) => x.name === "boundary-integrity"), all);
  assert.match(line, /enabled by human \(ben\) on 2026-09-22/);
  assert.match(line, /unvalidated — direction, never a gate/);
  assert.match(line, /applies because: regime:http-service/);
});

test("the enable file fails safe toward OFF and says so", () => {
  const { config, problems: p } = readSkillsConfig(join(ROOT, "test", "fixtures", "threads", "flask_demo"));
  assert.deepEqual(config, { version: "1.0", enabled: [] });
  assert.deepEqual(p, []);
});

test("a rule without its why, without a binding, with an unknown binding, or a lying binds line is refused", () => {
  const good = readFileSync(join(SKILLS, "resolvability", "SKILL.md"), "utf-8");
  assert.equal(parseGenericSkill(good).problems.length, 0);
  const mutate = (from, to) => parseGenericSkill(good.replace(from, to)).problems;
  assert.ok(mutate(" — why: ", " — because: ").some((p) => /both the why and the binding are required/.test(p)), "why marker is required");
  assert.ok(mutate(" — bound: check:annotated", "").some((p) => /both the why and the binding are required/.test(p)), "binding is required");
  assert.ok(mutate("check:annotated\n", "check:reachable\n").some((p) => /unknown binding|binds:/.test(p)), "an unknown verb is refused (reachable was declined)");
  assert.ok(mutate('"check:annotated",', '"check:annotated","check:guards",').some((p) => /binds lists check:guards but no rule binds to it/.test(p)), "binds must not list what no rule uses");
  assert.ok(mutate("evidence: unvalidated", "evidence: validated").some((p) => /requires a drill/.test(p)), "validated needs the drill cited");
  assert.ok(mutate('applies_when: {"all":[{"fact":"languages","has":"python"},{"fact":"unattributedBoundaries","has":"true"}]}', "applies_when: {}").some((p) => /no `always`/.test(p)), "an empty predicate is refused");
});

test("the body ceiling is derived from the injection budget, so the two cannot drift", () => {
  assert.equal(GENERIC_SKILL_BODY_CEILING, Math.floor(SKILL_INJECTION_BUDGET_CHARS / 3));
});

// ── M-SKILLS.2 — the boundary, the task facts, the prompt section ─────

test("M-SKILLS.2: the WS boundary keeps only shipped names, dedups, and stamps who/when without overwriting an earlier stamp", () => {
  const known = EXPECTED;
  const t1 = { source: "human", id: "ben", at: "2026-09-22T10:00:00Z" };
  const first = sanitiseSkillsConfig({ enabled: ["boundary-integrity", "boundary-integrity", "not-a-skill", 42, "resolvability"] }, known, t1);
  assert.deepEqual(first.enabled, ["boundary-integrity", "resolvability"], "unknown and non-string entries are dropped, never coerced");
  assert.deepEqual(first.enabledBy, { "boundary-integrity": t1, "resolvability": t1 });
  // A later change keeps the ORIGINAL stamp for a skill that stayed on.
  const t2 = { source: "human", at: "2026-09-23T10:00:00Z" };
  const second = sanitiseSkillsConfig({ enabled: ["resolvability", "change-coupling"] }, known, t2, first);
  assert.deepEqual(second.enabled, ["resolvability", "change-coupling"]);
  assert.deepEqual(second.enabledBy.resolvability, t1, "still enabled: the first stamp survives");
  assert.deepEqual(second.enabledBy["change-coupling"], t2, "newly enabled: the new stamp");
  assert.equal(second.enabledBy["boundary-integrity"], undefined, "disabled: no stamp lingers");
  // Garbage in → OFF, never a throw.
  assert.deepEqual(sanitiseSkillsConfig(null, known, t1), { version: "1.0", enabled: [] });
  assert.deepEqual(sanitiseSkillsConfig({ enabled: "boundary-integrity" }, known, t1), { version: "1.0", enabled: [] });
});

test("M-SKILLS.2: ONE task-facts builder for the gate and the spawn, so retry means the same thing at both", () => {
  // At the objective gate nothing has run: priorAttempts = packet.attempts = 0.
  assert.equal(packetTaskFacts({ priorAttempts: 0, kind: "thread", routedCount: 0 }).retry, false);
  // At spawn the running attempt is already counted: priorAttempts = attempts - 1.
  assert.equal(packetTaskFacts({ priorAttempts: 1 - 1, kind: "thread", routedCount: 0 }).retry, false, "first attempt");
  assert.equal(packetTaskFacts({ priorAttempts: 2 - 1, kind: "thread", routedCount: 0 }).retry, true, "the bounded retry");
  const f = packetTaskFacts({ priorAttempts: 0, kind: "system", effects: { db: 2, http: 0 }, crossesInto: ["gateway/server.ts:getFleet"], routedCount: 3 });
  assert.deepEqual(f, { constraintsRouted: true, effectfulBoundaries: true, systemPacket: true, crossLanguage: true, retry: false });
  assert.equal(packetTaskFacts({ priorAttempts: 0, effects: { db: 0 }, routedCount: 0 }).effectfulBoundaries, false);
});

test("M-SKILLS.2: the prompt section carries injected skills with provenance and NAMES budget/session omissions; disabled and not-applicable stay out of the prompt", () => {
  const cfg = { version: "1.0", enabled: EXPECTED, enabledBy: { "boundary-integrity": { source: "human", id: "ben", at: "2026-09-22T10:00:00Z" } } };
  const ep = "telemetry/app.py:ingest_route";
  const bi = byName["boundary-integrity"];
  // A budget that fits exactly one skill: the first applicable injects, the rest are over-budget.
  const sel = selectGenericSkills({ skills, config: cfg, profile, entryPointId: ep, budgetChars: bi.body.length, alreadyInjected: new Map() });
  const text = renderGenericSkillsBlock(sel.routed, cfg);
  assert.match(text, /^Generic direction \(enabled for this project by a human; ADVISORY — never a gate/);
  assert.ok(text.includes("[generic skill boundary-integrity v1.0; enabled by human (ben) on 2026-09-22; unvalidated — direction, never a gate; applies because: regime:http-service"));
  assert.ok(text.includes(bi.body.trim()), "the whole body rides, verbatim");
  assert.match(text, /\(generic skill [a-z-]+ applies here but was not injected: over this turn's context budget\)/, "an over-budget skill is named, not dropped");
  assert.ok(!text.includes("retry-root-cause"), "a not-applicable skill is not mentioned in the prompt");
  // Off by default: nothing renders, byte-identical prompts.
  const off = selectGenericSkills({ skills, config: { version: "1.0", enabled: [] }, profile, entryPointId: ep, budgetChars: 99999, alreadyInjected: new Map() });
  assert.equal(renderGenericSkillsBlock(off.routed, { version: "1.0", enabled: [] }), "");
  // The audit is where disabled/not-applicable live.
  const audit = auditOf(sel.routed);
  assert.deepEqual(audit.injected, ["boundary-integrity"]);
  assert.equal(audit.omitted["retry-root-cause"], "not-applicable");
  assert.match(describeAudit(audit), /^injected: boundary-integrity; omitted: /);
  // Already-in-session on the next turn.
  const again = selectGenericSkills({ skills, config: cfg, profile, entryPointId: ep, budgetChars: 99999, alreadyInjected: new Map(sel.injected) });
  assert.ok(renderGenericSkillsBlock(again.routed, cfg).includes("(generic skill boundary-integrity is already in this session's context — injected on an earlier turn)"));
});

test("M-SKILLS.2: the catalogue measures breadth on the project it is asked about", () => {
  const cat = catalogueOf(skills, profile);
  assert.equal(cat.length, EXPECTED.length);
  const bi = cat.find((c) => c.name === "boundary-integrity");
  assert.ok(bi.fires > 0 && bi.fires < bi.of, `${bi.fires}/${bi.of}`);
  assert.equal(bi.of, Object.keys(profile.threads).length);
  assert.equal(cat.find((c) => c.name === "retry-root-cause").fires, bi.of, "measured with the retry fact on");
  assert.deepEqual(catalogueOf(skills, null).map((c) => c.of), EXPECTED.map(() => 0), "no profile: breadth unmeasured, never invented");
});
