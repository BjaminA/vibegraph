// Quality layer, Run 3: the DERIVED artefacts. Every config the schemas
// describe is produced by a script from the fleet example (or a fixture
// skill file), validated against its schema, and checked for the facts
// it must carry. Nothing here is hand-written config: the fixture skill
// file is the one hand-written input, and it is a test vector.
//
// Run: npm run test:quality-derived

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deriveAll, qualityAjv } from "../scripts/quality_derive.mjs";
import { deriveSkillManifest } from "../src/server/quality/skill_manifest.ts";
import { computeAcceptance } from "../src/server/quality/acceptance.ts";
import { evaluatePredicate } from "../src/server/quality/predicate.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = "https://vibegraph.dev/schemas/quality/";
const ajv = qualityAjv();
const valid = (schema, inst) => {
  const v = ajv.getSchema(BASE + schema);
  const ok = v(inst);
  assert.ok(ok, `${schema}: ${ajv.errorsText(v.errors, { separator: "\n  " })}`);
};

const fleet = deriveAll({ root: "examples/fleet-telemetry", skillsDir: "test/fixtures/quality/skills", commit: "test" });

test("stack profile: derived from the fleet example, validates, and names what it read", () => {
  valid("stack_profile.json", fleet.profile);
  const p = fleet.profile;
  assert.equal(p.provenance.kind, "derived");
  assert.deepEqual(p.facts.languages.value, ["bash", "cpp", "jsts", "python"]);
  assert.ok(p.facts.entryKinds.value.includes("route") && p.facts.entryKinds.value.includes("cli"));
  assert.ok(p.facts.funnels.value.includes("telemetry.http_client") && p.facts.funnels.value.includes("telemetry.storage"), JSON.stringify(p.facts.funnels));
  assert.ok(p.facts.rolesCalled.value.includes("db") && p.facts.rolesCalled.value.includes("http-client"));
  const ids = p.regimes.map((r) => r.id);
  for (const r of ["http-service", "cli-tool", "test-suite", "polyglot"]) assert.ok(ids.includes(r), `regime ${r} in ${ids}`);
  assert.ok(!ids.includes("unknown"));
  for (const r of p.regimes) assert.ok(r.derivedFrom.length >= 1);
  assert.ok(p.unknowns.some((u) => u.fact === "hotPaths"));
  const ingest = p.threads["telemetry/app.py:ingest_route"];
  assert.ok(ingest, "per-thread profile for the ingest route");
  assert.ok(ingest.regimes.some((r) => r.id === "http-service"));
  assert.deepEqual(ingest.facts.entryKinds.value, ["route"]);
  const bash = p.threads["ops/backup.sh:main"];
  assert.ok(bash.regimes.some((r) => r.id === "ops-script") || bash.regimes.some((r) => r.id === "cli-tool"), JSON.stringify(bash.regimes));
  for (const [name, f] of Object.entries(p.facts)) assert.ok(f.supportingNodes.length >= 1 && f.readFrom, `${name} carries its evidence`);
});

test("quality model: derived from the profile and the stated constraints, advisory everywhere, calibration Unknown", async () => {
  valid("quality_model.json", fleet.model);
  const m = fleet.model;
  const byId = Object.fromEntries(m.dimensions.map((d) => [d.id, d]));
  assert.ok(byId["boundary-integrity"], "boundary-integrity present");
  const g = byId["boundary-integrity"].checks.find((c) => c.check.rule === "guards");
  assert.deepEqual(g.check, { rule: "guards", target: "notify", guard: "should_notify" }, "guards derived from c3's calls-through");
  assert.ok(g.forcedBy.includes("c3") && g.forcedBy.includes("AR-6"));
  assert.ok(byId["failure-visibility"] && byId["resolvability"]);
  // h2h3 dry-run iteration: the shipped fleet's c5 (perf-lever) carries no
  // not-in-loop clause, so repetition-cost derives NOTHING; the role-level
  // form fired on pristine code and is no longer derived.
  assert.equal(byId["repetition-cost"], undefined, "no stated not-in-loop clause, no derived repetition-cost binding");
  assert.ok(fleet.notes.some((n) => /repetition-cost: no stated perf-lever carries a not-in-loop clause/.test(n)), fleet.notes.join("\n"));
  assert.equal(byId["change-coupling"], undefined, "no co-changes clause is stated, so the dimension is not invented");
  assert.ok(fleet.notes.some((n) => /change-coupling: no derivable check/.test(n)), fleet.notes.join("\n"));
  // With c5 stated WITH a named clause (as h2h3's copy states it), the
  // dimension derives exactly that clause, forced by c5.
  const { deriveQualityModel } = await import("../src/server/quality/model.ts");
  const withClause = deriveQualityModel(fleet.profile, [
    ...fleet.constraints,
    { id: "c9", kind: "perf-lever", check: { rule: "not-in-loop", target: "execute", except: ["insert_readings"] } },
  ], { commit: "test" });
  const rc = withClause.model.dimensions.find((d) => d.id === "repetition-cost");
  assert.ok(rc, "a stated not-in-loop clause derives the dimension");
  assert.deepEqual(rc.checks.map((c) => c.check), [{ rule: "not-in-loop", target: "execute", except: ["insert_readings"] }]);
  assert.ok(rc.checks[0].forcedBy.includes("c9"));
  valid("quality_model.json", withClause.model);
  // Every dimension was ADVISORY with calibration Unknown until 2026-09-21,
  // because no verb had a standing: RUN3 §11 recorded "derived bindings
  // never gate" for exactly that reason. Four verbs now carry ratified
  // records, Ben ruled the decision amended (PLAN-HISTORY), and a
  // dimension whose every binding is calibrated is gate-blocking with the
  // record beside it — the schema's if/then refuses it otherwise. The
  // threshold stays Unknown: no number before calibration, still.
  for (const d of m.dimensions) {
    const allCalibrated = d.checks.every((c) => "commit" in c.calibration);
    assert.equal(d.mode, allCalibrated ? "gate-blocking" : "advisory", `${d.id}`);
    assert.equal("commit" in d.calibration, allCalibrated, `${d.id} calibration matches its mode`);
    if (!allCalibrated) assert.equal(d.calibration.unknown, true);
    assert.equal(d.threshold.unknown, true);
    assert.notEqual(JSON.stringify(d.applies_when), JSON.stringify({ always: true }));
  }
  // What makes the gate safe is NOT in the model: it is the baseline the
  // objective gate captures, so a derived gate rejects only an offender
  // the packet introduced (src/server/quality/derived_gate.ts).
  assert.ok(m.dimensions.some((d) => d.mode === "gate-blocking"), "at least one dimension gates now");
});

test("skill manifest: two parseable rules, one omitted with its reason, the c3 rule bound to c3's first check", () => {
  assert.equal(fleet.skills.length, 1);
  const { file, manifest } = fleet.skills[0];
  assert.equal(file, "telemetry_alerts.py_evaluate.md");
  valid("skill_manifest.json", manifest);
  assert.equal(manifest.entryPointId, "telemetry/alerts.py:evaluate");
  assert.equal(manifest.status, "ratified");
  assert.equal(manifest.rules.length, 2, JSON.stringify(manifest.rules));
  const [r1, r2] = manifest.rules;
  assert.equal(r1.source, "constraint");
  assert.deepEqual(r1.boundTo, { constraintId: "c3", rule: "callers-only" });
  assert.match(r1.why, /forty times in a minute/);
  assert.deepEqual(r1.nodes, ["telemetry/alerts.py:module/evaluate.fn/notify.call", "telemetry/alerts.py:module/should_notify.fn"]);
  assert.equal(r2.source, "worker-draft");
  assert.equal(r2.boundTo, undefined);
  assert.deepEqual(r2.nodes, ["telemetry/alerts.py:module/notify.fn/_events_append.call"]);
  assert.equal(manifest.omitted.length, 1);
  assert.match(manifest.omitted[0].reason, /no why stated/);
  assert.equal(manifest.stamp.rulesHash.unknown, true);
  assert.equal(manifest.stamp.snapshotPresent, false);
  assert.ok(manifest.staling.every((s) => s.action === "stale"));
});

test("skill manifest: a file that is not a skill yields no manifest and says why", () => {
  const r = deriveSkillManifest("# just markdown\n", [], { commit: "test" });
  assert.equal(r.manifest, null);
  assert.match(r.notes[0], /no frontmatter/);
});

test("acceptance: computed up front for the evaluate packet, validates, gates only what may gate", () => {
  const routed = fleet.constraints.filter((c) => c.id === "c1" || c.id === "c3");
  const a = computeAcceptance({
    packetId: "p3", entryPointId: "telemetry/alerts.py:evaluate",
    scope: { files: ["telemetry/alerts.py"], declaredBy: "brief" },
    routedConstraints: routed, profile: fleet.profile, model: fleet.model,
    task: { constraintsRouted: true, effectfulBoundaries: true, systemPacket: false, crossLanguage: false, retry: false },
    commit: "test",
  });
  valid("acceptance.json", a);
  assert.equal(a.invariants.length, 10);
  const gating = a.checks.filter((c) => c.mode === "gate-blocking");
  // The three live grammar verbs always gate. Since 2026-09-21 a DERIVED
  // binding gates too, once its dimension's every check is calibrated —
  // and only on an offender the packet introduced, which the acceptance
  // cannot know and the server's baseline decides
  // (src/server/quality/derived_gate.ts). Stated Run 1 verbs still need
  // `calibrated` passed in, as the next test shows.
  for (const r of ["callers-only", "calls-through", "import-only"]) {
    assert.ok(gating.some((c) => c.check.rule === r), `${r} gates`);
  }
  assert.ok(gating.filter((c) => c.basis.constraintId).every((c) => !!c.basis.constraintId));
  const derived = a.checks.filter((c) => c.basis.dimension);
  const bi = derived.find((c) => c.check.rule === "guards" && c.basis.dimension === "boundary-integrity");
  assert.ok(bi, "boundary-integrity binds guards");
  assert.equal(bi.mode, "gate-blocking", "guards is MAY-GATE, so its dimension gates");
  assert.ok(bi.basis.calibration.commit, "and carries the commit its calibration was earned at");
  // A dimension with an uncalibrated binding stays advisory, and says so.
  for (const c of derived) {
    assert.equal(c.mode, c.basis.calibration.commit ? "gate-blocking" : "advisory", String(c.check.rule));
  }
  assert.ok(a.advisories.some((x) => x.kind === "tests-touched"), "the tests-touched line is always named");
  // There is no `uncalibrated-check` advisory here any more, and its
  // absence is the point: every check this packet carries IS calibrated
  // since 2026-09-21. The advisory still fires for one that is not —
  // co-changes is DEMOTE, so a stated co-changes clause stays advisory
  // and says why.
  assert.ok(!a.advisories.some((x) => x.kind === "uncalibrated-check"), JSON.stringify(a.advisories));
  const demoted = computeAcceptance({
    packetId: "p3b", entryPointId: "telemetry/alerts.py:evaluate",
    scope: { files: ["telemetry/alerts.py"], declaredBy: "brief" },
    routedConstraints: [{ id: "c6", check: { rule: "co-changes", when: "telemetry/storage.py", require: "telemetry/migrations.py" } }],
    commit: "test",
  });
  assert.equal(demoted.checks[0].mode, "advisory");
  assert.ok(demoted.advisories.some((x) => x.kind === "uncalibrated-check" && /co-changes/.test(x.text)), JSON.stringify(demoted.advisories));
  assert.deepEqual(a.evidenceRequired, ["derived", "stated"]);
  assert.match(a.closingBar, /c3/);
  assert.match(a.closingBar, /nothing loosened/);
});

test("acceptance: a calibrated Run 1 verb in a stated constraint gates; a stated exception rides with its provenance", () => {
  const stated = [{ id: "c9", check: { rule: "guards", target: "notify", guard: "should_notify" } }];
  const a = computeAcceptance({
    packetId: "p9", entryPointId: "telemetry/alerts.py:evaluate", scope: { files: ["telemetry/alerts.py"], declaredBy: "thread" },
    routedConstraints: stated, calibrated: new Set(["guards"]),
    exceptions: [{ kind: "entry-point-signature-unchanged", reason: "the brief adds a region parameter", provenance: { kind: "stated", source: "orchestrator", id: "brief:p9", at: "2026-09-12T00:00:00.000Z" } }],
    commit: "test",
  });
  valid("acceptance.json", a);
  assert.equal(a.checks[0].mode, "gate-blocking");
  assert.ok(a.invariants.find((i) => i.kind === "entry-point-signature-unchanged").exception);
  assert.match(a.closingBar, /signature change stated by the brief/);
  const uncal = computeAcceptance({ packetId: "p9", entryPointId: "e", scope: { files: ["a.py"], declaredBy: "thread" }, routedConstraints: stated, commit: "test" });
  assert.equal(uncal.checks[0].mode, "advisory", "an uncalibrated verb never gates, even when a human states it");
});

test("predicate: all/any/not/fact/absent/regime/task, and the thread overrides the project", () => {
  const profile = {
    facts: { languages: { value: ["python", "jsts"], confidence: "exact", supportingNodes: ["a.py:module"], readFrom: "x" }, testsPresent: { value: true, confidence: "exact", supportingNodes: ["a.py:module"], readFrom: "x" } },
    regimes: [{ id: "polyglot", derivedFrom: ["languages"] }],
    threads: { "a.py:f": { facts: { languages: { value: ["python"], confidence: "exact", supportingNodes: ["a.py:module"], readFrom: "x" } }, regimes: [{ id: "cli-tool", derivedFrom: ["entryKinds"] }] } },
  };
  const project = { profile };
  const thread = { profile, entryPointId: "a.py:f", task: { retry: true } };
  assert.equal(evaluatePredicate({ fact: "languages", has: "jsts" }, project), true);
  assert.equal(evaluatePredicate({ fact: "languages", has: "jsts" }, thread), false, "the thread's languages override the project's");
  assert.equal(evaluatePredicate({ regime: "polyglot" }, project), true);
  assert.equal(evaluatePredicate({ regime: "polyglot" }, thread), false);
  assert.equal(evaluatePredicate({ fact: "testsPresent", has: "true" }, thread), true, "a fact the thread lacks falls back to the project");
  assert.equal(evaluatePredicate({ all: [{ fact: "languages", has: "python" }, { not: { fact: "hotPaths", has: "x" } }] }, thread), true);
  assert.equal(evaluatePredicate({ fact: "hotPaths", absent: true }, thread), true);
  assert.equal(evaluatePredicate({ task: "retry", is: true }, thread), true);
  assert.equal(evaluatePredicate({ task: "retry", is: true }, project), false);
  assert.equal(evaluatePredicate({ always: true }, project), false, "no always: an unknown shape is false, never true");
  assert.equal(evaluatePredicate({ all: [] }, project), false, "an empty all names no fact and is false");
});
