#!/usr/bin/env node
// Quality layer, Run 3: CALIBRATION. A check earns its place only by
// discriminating across known-good and known-bad code drawn from this
// repository's own defect history. This script runs each verb over its
// sample set and writes one CANDIDATE record per verb:
//
//   reviews/quality-layer/calibration/<verb>.candidate.json
//
// A candidate is not a CalibrationRecord (schemas/quality/quality_model.json)
// because the record's false-positive review must be by a HUMAN, and no
// script can be one. The candidate carries everything else: the sample
// set with each unit's source and label, the raw verdict per unit, the
// fire rates, the commit, and the list of fires on known-good or
// presumed-good code that a human must review. `--ratify <verb>` validates
// a human-edited record against the schema.
//
// Two degenerate outcomes are named without a threshold, because they
// need none: a check that fired on NO known-bad unit is SILENT; a check
// that fired on EVERY known-good unit FIRES EVERYWHERE. Both are noise
// (brief, Run 3). Anything in between is a human's call.
//
//   node --experimental-strip-types --no-warnings scripts/quality_calibrate.mjs [--out <dir>] [--ratify <verb>]

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildQualityFacts } from "../src/server/quality/facts.ts";
import { newRegistry } from "../src/server/quality/verbs/index.ts";
import { loadEnvelope, gitDelta } from "./quality_check.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT = resolve(ROOT, flag("--out") ?? "reviews/quality-layer/calibration");
const COMMIT = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf-8" }).trim();
const registry = newRegistry();

const projects = new Map();
function project(root, envelopePath) {
  const key = `${root}|${envelopePath ?? ""}`;
  if (!projects.has(key)) {
    const { absRoot, envelope } = loadEnvelope(root, envelopePath);
    projects.set(key, { absRoot, envelope, stack: buildStackIndex(envelope, absRoot) });
  }
  return projects.get(key);
}
function run(root, check, extra = {}, envelopePath) {
  const { absRoot, envelope, stack } = project(root, envelopePath);
  return registry.run(buildQualityFacts({ envelope, root: absRoot, commit: COMMIT, stack, ...extra }), check);
}

/** The IR schema's NodeType enum at a commit, or null when it cannot be read. */
function nodeTypeEnumAt(rev) {
  let text;
  try { text = execFileSync("git", ["show", `${rev}:schemas/ir.schema.json`], { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
  const m = /"NodeType"\s*:\s*\{[\s\S]*?"enum"\s*:\s*\[([\s\S]*?)\]/.exec(text);
  if (!m) return null;
  return new Set([...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
}

// ── sample sets ───────────────────────────────────────────────────────

function calibrateGuards() {
  const check = { rule: "guards", target: "notify", guard: "should_notify" };
  const CALIB = "test/fixtures/quality/calib";
  const demo = run(CALIB, check, { scopeFiles: ["guards_demo.py"] });
  const unv = run(CALIB, check, { scopeFiles: ["guards_unv.py"] });
  const fleet = run("examples/fleet-telemetry", check);
  const fired = (r, fn) => r.verdict === "violated" && r.offenders.some((o) => o.includes(`/${fn}.fn/`));
  const constructed = "CONSTRUCTED (test/fixtures/quality/calib/guards_demo.py): the h2h2 blind tree was never committed";
  const samples = [
    ...["good_if_arm", "good_negated_return", "good_bound_then_if", "good_negated_else"].map((fn) => ({ id: `guards_demo.py:${fn}`, label: "known-good", source: constructed, verdict: demo.verdict, fired: fired(demo, fn) })),
    ...["bad_after", "bad_else_arm", "bad_negated_then", "bad_return_between", "bad_no_guard"].map((fn) => ({ id: `guards_demo.py:${fn}`, label: "known-bad", source: constructed, verdict: demo.verdict, fired: fired(demo, fn) })),
    { id: "telemetry/alerts.py:evaluate", label: "known-good", source: "REAL: examples/fleet-telemetry, the c3 compliant path the h2h2 orchestrated run kept", verdict: fleet.verdict, fired: fleet.verdict === "violated" },
    { id: "guards_unv.py:unv_dynamic_target", label: "expected-unverifiable", source: constructed, verdict: unv.verdict, fired: false, detail: `${unv.cause}: ${unv.at.join(", ")}` },
  ];
  return { verb: "guards", unit: "function that calls the target", checks: [check], samples, raw: { demo, unv, fleet } };
}

function calibrateNotInLoop() {
  const COMP = "test/fixtures/comprehension/comp_demo";
  const COMP_ENV = join(COMP, "comp_demo.project.json");
  const role = { rule: "not-in-loop", role: "http-client" };
  const { envelope } = project(COMP, COMP_ENV);
  const samples = [];
  const raw = {};
  for (const t of envelope.threads) {
    const ep = t.entryPointId;
    const fn = ep.split(":")[1];
    if (fn === "main") continue; // calls every other function; an aggregate, not a unit
    const r = run(COMP, role, { entryPointId: ep }, COMP_ENV);
    raw[ep] = r;
    const label = fn === "page_once" ? "known-good" : "known-bad";
    samples.push({ id: ep, label, source: `CONSTRUCTED for the defect class (M-COMP, 2026-09-11): the N+1 written eight ways; ${fn === "page_once" ? "the one-call control" : "a per-item HTTP call"}`, verdict: r.verdict, fired: r.verdict === "violated" });
  }
  const byName = { rule: "not-in-loop", target: "execute", except: ["insert_readings"] };
  for (const ep of ["telemetry/backfill.py:backfill_from_file", "telemetry/ingest.py:ingest_batch"]) {
    const r = run("examples/fleet-telemetry", byName, { entryPointId: ep });
    raw[ep] = r;
    samples.push({ id: `${ep} [target execute]`, label: "known-good", source: "REAL: examples/fleet-telemetry, c5's batched insert path (one executemany per batch)", verdict: r.verdict, fired: r.verdict === "violated" });
  }
  const byRole = run("examples/fleet-telemetry", { rule: "not-in-loop", role: "db" }, { entryPointId: "telemetry/ingest.py:ingest_batch" });
  raw["telemetry/ingest.py:ingest_batch [role db]"] = byRole;
  samples.push({ id: "telemetry/ingest.py:ingest_batch [role db]", label: "expected-unverifiable", source: "REAL: a role-only check on a loop over dicts; `raw.get` could be anything", verdict: byRole.verdict, fired: false, detail: `${byRole.cause}: ${byRole.at.join(", ")}` });
  return { verb: "not-in-loop", unit: "thread", checks: [role, byName], samples, raw };
}

function calibrateHandlesFailure() {
  const check = { rule: "handles-failure", scope: "files" };
  const samples = [];
  const raw = {};
  const pools = [
    { root: "test/fixtures/threads/run_demo", label: (id) => id.includes("swallowed") ? "known-bad" : "presumed-good", source: "FIXTURE: run_demo (`swallowed` was written as the defect)" },
    { root: "scripts", label: () => "presumed-good", source: "REAL: this repository's own scripts (any fire is a human's call: a tracer's __call__ swallows on purpose)" },
    { root: "test/fixtures/scale/src", label: () => "presumed-good", source: "REAL LIBRARY CODE: the vendored Django admin (test/fixtures/scale/SOURCE.md), production-quality by assumption" },
  ];
  for (const pool of pools) {
    const { envelope } = project(pool.root);
    const files = Object.keys(envelope.files);
    const r = run(pool.root, check, { scopeFiles: files });
    raw[pool.root] = r;
    const fired = new Set(r.verdict === "violated" ? r.offenders : []);
    for (const [file, ir] of Object.entries(envelope.files)) {
      for (const n of ir.nodes ?? []) {
        if (n.type !== "except_handler") continue;
        const id = `${pool.root}/${file}:${n.id}`;
        samples.push({ id, label: pool.label(id), source: pool.source, verdict: fired.has(`${file}:${n.id}`) ? "violated" : "not-an-offender", fired: fired.has(`${file}:${n.id}`), exceptType: n.exceptType ?? null });
      }
    }
  }
  return { verb: "handles-failure", unit: "except arm (files scope)", checks: [check], samples, raw };
}

function calibrateAnnotated() {
  const { envelope } = project("examples/fleet-telemetry");
  const samples = [];
  const raw = {};
  for (const t of envelope.threads) {
    const ep = t.entryPointId;
    if (!t.seed.file.endsWith(".py")) continue;
    const entry = run("examples/fleet-telemetry", { rule: "annotated", at: "entry-point" }, { entryPointId: ep });
    const recv = run("examples/fleet-telemetry", { rule: "annotated", at: "dynamic-receivers" }, { entryPointId: ep });
    raw[ep] = { entry, recv };
    // Known-bad: an untyped parameter that RECEIVES a dynamic call (the
    // annotation would resolve a boundary, §5.5). Known-good: typed entry
    // point. Neutral: untyped but no dynamic receiver on the thread.
    // `fired` is the DERIVED binding's mode (dynamic-receivers): the
    // entry-point mode fired on the two neutral units, where the
    // annotation would resolve nothing, and was dropped from the model
    // (RUN3.md section 10). Both verdicts are kept in the sample.
    const label = recv.verdict === "violated" ? "known-bad" : entry.verdict === "pass" ? "known-good" : "neutral";
    samples.push({ id: ep, label, source: "REAL: examples/fleet-telemetry (18 of 80 Python functions carry paramTypes)", verdict: recv.verdict, fired: recv.verdict === "violated", detail: `entry-point: ${entry.verdict}` });
  }
  return { verb: "annotated", unit: "Python entry point", checks: [{ rule: "annotated", at: "dynamic-receivers" }], samples, raw };
}

function calibrateCoChanges() {
  const check = { rule: "co-changes", when: "schemas/ir.schema.json", require: "src/shared/protocol.ts" };
  const revs = execFileSync("git", ["log", "--format=%h", "--", "schemas/ir.schema.json"], { cwd: ROOT, encoding: "utf-8" }).trim().split("\n").filter(Boolean);
  const samples = [];
  const raw = {};
  for (const rev of revs) {
    const delta = gitDelta(rev);
    const r = run("test/fixtures/quality/calib", check, { runDelta: delta });
    raw[rev] = r;
    const before = nodeTypeEnumAt(`${rev}^`), after = nodeTypeEnumAt(rev);
    const grew = before && after ? [...after].filter((x) => !before.has(x)) : null;
    const touchedProtocol = delta.entries.some((e) => e.file === "src/shared/protocol.ts");
    const subject = execFileSync("git", ["log", "-1", "--format=%s", rev], { cwd: ROOT, encoding: "utf-8" }).trim();
    // Known-bad: the NodeType enum grew and protocol.ts did not move (the
    // drift M-LANG1 later fixed). Known-good: enum grew AND protocol moved.
    // Neutral: the enum did not grow; the file-level trigger still fires,
    // which is the measurement that says the trigger wants a NODE (G2).
    const label = grew === null ? "neutral" : grew.length ? (touchedProtocol ? "known-good" : "known-bad") : "neutral";
    samples.push({ id: rev, label, source: `REAL: git history, "${subject}"`, verdict: r.verdict, fired: r.verdict === "violated", detail: `enum grew: ${grew === null ? "unreadable" : grew.join(",") || "no"}; protocol.ts touched: ${touchedProtocol}` });
  }
  return { verb: "co-changes", unit: "commit touching schemas/ir.schema.json", checks: [check], samples, raw };
}

// ── the candidate record ─────────────────────────────────────────────

function summarise(c) {
  const rate = (label) => { const s = c.samples.filter((x) => x.label === label); return { fired: s.filter((x) => x.fired).length, of: s.length }; };
  const fireRate = { onKnownGood: rate("known-good"), onKnownBad: rate("known-bad"), onPresumedGood: rate("presumed-good"), onNeutral: rate("neutral") };
  const expectedUnv = c.samples.filter((x) => x.label === "expected-unverifiable");
  const degenerate = fireRate.onKnownBad.of && fireRate.onKnownBad.fired === 0 ? "SILENT: fired on no known-bad unit"
    : fireRate.onKnownGood.of && fireRate.onKnownGood.fired === fireRate.onKnownGood.of ? "FIRES EVERYWHERE: fired on every known-good unit"
    : null;
  return {
    verb: c.verb, unit: c.unit, checks: c.checks, commit: COMMIT, at: new Date().toISOString(),
    fireRate,
    degenerate,
    expectedUnverifiable: expectedUnv.map((x) => ({ id: x.id, verdict: x.verdict, detail: x.detail ?? null, asExpected: x.verdict === "unverifiable" })),
    falsePositiveReview: {
      reviewedBy: "pending-human",
      candidates: c.samples.filter((x) => x.fired && (x.label === "known-good" || x.label === "presumed-good" || x.label === "neutral")).map((x) => ({ id: x.id, label: x.label, source: x.source })),
      falsePositives: [],
    },
    samples: c.samples,
    rawVerdicts: c.raw,
  };
}

async function recordValidator() {
  const Ajv2020 = (await import("ajv/dist/2020.js")).default;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  (await import("ajv-formats")).default(ajv);
  for (const f of ["evidence", "check_grammar", "stack_profile", "quality_model"]) ajv.addSchema(JSON.parse(readFileSync(join(ROOT, "schemas", "quality", `${f}.json`), "utf-8")));
  const v = ajv.getSchema("https://vibegraph.dev/schemas/quality/quality_model.json#/$defs/CalibrationRecord");
  return (rec) => (v(rec) ? null : ajv.errorsText(v.errors, { separator: "\n  " }));
}

/** A sample unit's id as a NodeRef the record's sampleSet can carry. */
function unitRef(verb, id) {
  if (verb === "co-changes") return "schemas/ir.schema.json:module";
  if (verb === "not-in-loop" || verb === "annotated") {
    const [file, fn] = id.replace(/ \[.*$/, "").split(":");
    return `${file}:module/${fn}.fn`;
  }
  if (verb === "guards") { const [file, fn] = id.split(":"); return `${file}:module/${fn}.fn`; }
  return id; // handles-failure: already file:node (root-prefixed path is still a path)
}

/** `--record <verb> --review <verb>.review.json`: a review, applied. The
 *  review file is `{ reviewedBy: "human" | "model", model?, delegatedBy?,
 *  notes: [{ id, verdict, why }] }` with one note per fire candidate:
 *  every fire on known-good, presumed-good or neutral code is judged
 *  false-positive (the verb is wrong here), finding (the label was wrong;
 *  the code has the defect) or intended (the author meant the shape; it
 *  wants a stated allowance). A candidate with no note, or a note for a
 *  non-candidate, is refused. The record validates or is not written. */
async function record(verb, reviewPath) {
  const c = JSON.parse(readFileSync(join(OUT, `${verb}.candidate.json`), "utf-8"));
  const review = JSON.parse(readFileSync(resolve(ROOT, reviewPath), "utf-8"));
  const candidates = c.falsePositiveReview.candidates.map((x) => x.id);
  const noted = new Set((review.notes ?? []).map((n) => n.id));
  const missing = candidates.filter((id) => !noted.has(id));
  const extra = [...noted].filter((id) => !candidates.includes(id));
  if (missing.length) { console.error(`${verb}: ${missing.length} fire(s) have no judgement: ${missing.join(", ")}`); process.exit(2); }
  if (extra.length) { console.error(`${verb}: not fire candidates: ${extra.join(", ")}`); process.exit(2); }
  const byVerdict = (v) => (review.notes ?? []).filter((n) => n.verdict === v).map((n) => unitRef(verb, n.id));
  const good = c.samples.filter((s) => s.label === "known-good" || s.label === "presumed-good" || s.label === "neutral");
  const bad = c.samples.filter((s) => s.label === "known-bad");
  const rec = {
    commit: c.commit, at: new Date().toISOString(),
    sampleSet: { knownGood: [...new Set(good.map((s) => unitRef(verb, s.id)))], knownBad: [...new Set(bad.map((s) => unitRef(verb, s.id)))] },
    fireRate: { onKnownGood: { fired: good.filter((s) => s.fired).length, of: good.length }, onKnownBad: { fired: bad.filter((s) => s.fired).length, of: bad.length } },
    falsePositiveReview: {
      reviewedBy: review.reviewedBy,
      ...(review.model ? { model: review.model } : {}),
      ...(review.delegatedBy ? { delegatedBy: review.delegatedBy } : {}),
      notes: review.notes ?? [],
      falsePositives: [...new Set(byVerdict("false-positive"))],
      intended: [...new Set(byVerdict("intended"))],
    },
    samplesFrom: `reviews/quality-layer/calibration/${verb}.candidate.json`,
  };
  const err = (await recordValidator())(rec);
  if (err) { console.error(`${verb}: the record does not validate:\n  ${err}`); process.exit(1); }
  writeFileSync(join(OUT, `${verb}.record.json`), JSON.stringify(rec, null, 2) + "\n");
  const count = (v) => (review.notes ?? []).filter((n) => n.verdict === v).length;
  console.log(`${verb}: record written (${review.reviewedBy}${review.model ? " " + review.model : ""}); ${count("false-positive")} false positive(s), ${count("finding")} finding(s), ${count("intended")} intended`);
}

/** The demotion and retirement path, number-free (RUN3.md 5):
 *    RETIRE            silent on every known-bad unit
 *    DEMOTE            any confirmed false positive (a false violation rejects
 *                      correct work) until the verb is narrowed and re-run
 *    STALE             the verb's source changed after the record's commit
 *    MAY-GATE          fires on every known-bad, no confirmed false positive,
 *                      at least one good unit sampled, record not stale
 *    CANDIDATE         no human review yet: advisory only
 *  A verb with no candidate at all does not exist for gating purposes. */
function status() {
  const verbs = ["guards", "not-in-loop", "handles-failure", "annotated", "co-changes"];
  const file = (v) => join(ROOT, "src", "server", "quality", "verbs", `${v.replace(/-/g, "_")}.ts`);
  const rows = [];
  for (const v of verbs) {
    let rec = null, cand = null;
    try { rec = JSON.parse(readFileSync(join(OUT, `${v}.record.json`), "utf-8")); } catch { /* no record */ }
    try { cand = JSON.parse(readFileSync(join(OUT, `${v}.candidate.json`), "utf-8")); } catch { /* no candidate */ }
    if (!cand && !rec) { rows.push({ verb: v, standing: "NONE", why: "no candidate: never calibrated" }); continue; }
    if (!rec) { rows.push({ verb: v, standing: "CANDIDATE", why: `${cand.falsePositiveReview.candidates.length} fire(s) on good/presumed-good code await a review` }); continue; }
    const lastChange = execFileSync("git", ["log", "-1", "--format=%h", "--", file(v)], { cwd: ROOT, encoding: "utf-8" }).trim();
    let stale = false;
    try { execFileSync("git", ["merge-base", "--is-ancestor", lastChange, rec.commit], { cwd: ROOT, stdio: "ignore" }); } catch { stale = lastChange !== rec.commit; }
    const fr = rec.fireRate;
    const rv = rec.falsePositiveReview;
    // Counted from the judgements, not the NodeRef lists: several units can
    // share one ref (every co-changes commit maps to the schema file).
    const byVerdict = (x) => (rv.notes ?? []).filter((n) => n.verdict === x).length;
    const fps = rv.notes ? byVerdict("false-positive") : rv.falsePositives.length;
    const intended = rv.notes ? byVerdict("intended") : (rv.intended ?? []).length;
    const findings = byVerdict("finding");
    const who = rv.reviewedBy === "model" ? `model-reviewed (${rv.model}, delegated by ${rv.delegatedBy?.id})` : "human-reviewed";
    const standing = fr.onKnownBad.of && fr.onKnownBad.fired === 0 ? ["RETIRE", "silent on every known-bad unit"]
      : fps ? ["DEMOTE", `${fps} confirmed false positive(s): a false violation rejects correct work`]
      : stale ? ["STALE", `verb source changed at ${lastChange}, after the record's ${rec.commit}`]
      : fr.onKnownBad.fired === fr.onKnownBad.of && fr.onKnownGood.of ? ["MAY-GATE", `fires on every known-bad (${fr.onKnownBad.fired}/${fr.onKnownBad.of}), no false positive, ${findings} finding(s) and ${intended} intended fire(s) on presumed-good code, ${fr.onKnownGood.of} good unit(s) sampled`]
      : ["ADVISORY", `misses ${fr.onKnownBad.of - fr.onKnownBad.fired} known-bad unit(s)`];
    rows.push({ verb: v, standing: standing[0], why: `${standing[1]}; ${who}` });
  }
  console.log("| verb | standing | why |");
  console.log("|---|---|---|");
  for (const r of rows) console.log(`| ${r.verb} | ${r.standing} | ${r.why} |`);
  if (args.includes("--write")) {
    // The server reads THIS file to decide which Run 1 verbs may reject
    // (src/server/quality/standings.ts): generated here, never probed live.
    const p = join(ROOT, "src", "server", "quality", "standings.json");
    // The RECORD rides too, for the verbs that may gate. A quality-model
    // dimension may only be `gate-blocking` with a CalibrationRecord beside
    // it (quality_model.json's if/then — the Run 2 shape rule that kept a
    // Run 2 instance advisory), and the deriver runs inside the server,
    // which must not read reviews/ at derive time. Same M-TABLES discipline
    // as the standings themselves: generated here, committed, imported,
    // never probed live.
    const records = {};
    for (const r of rows) {
      if (r.standing !== "MAY-GATE") continue;
      try { records[r.verb] = JSON.parse(readFileSync(join(OUT, `${r.verb}.record.json`), "utf-8")); } catch { /* no record: it cannot be MAY-GATE anyway */ }
    }
    writeFileSync(p, JSON.stringify({
      generatedAt: new Date().toISOString(),
      commit: COMMIT,
      verbs: Object.fromEntries(rows.map((r) => [r.verb, r.standing])),
      records,
    }, null, 2) + "\n");
    console.log(`\nwritten ${p} (${Object.keys(records).length} calibration record(s) carried)`);
  }
}

if (flag("--ratify")) {
  const verb = flag("--ratify");
  const err = (await recordValidator())(JSON.parse(readFileSync(join(OUT, `${verb}.record.json`), "utf-8")));
  console.log(err ? `${verb}: NOT a CalibrationRecord:\n  ${err}` : `${verb}: a valid CalibrationRecord`);
  process.exit(err ? 1 : 0);
} else if (flag("--record")) {
  if (!flag("--review")) { console.error("usage: --record <verb> --review <path to <verb>.review.json>"); process.exit(2); }
  await record(flag("--record"), flag("--review"));
} else if (args.includes("--status")) {
  status();
} else {
  mkdirSync(OUT, { recursive: true });
  const all = [calibrateGuards(), calibrateNotInLoop(), calibrateHandlesFailure(), calibrateAnnotated(), calibrateCoChanges()].map(summarise);
  for (const c of all) writeFileSync(join(OUT, `${c.verb}.candidate.json`), JSON.stringify(c, null, 2) + "\n");
  const fmt = (r) => (r.of ? `${r.fired}/${r.of}` : "-");
  console.log("| verb | unit | known-bad fired | known-good fired | presumed-good fired | neutral fired | degenerate | FP candidates |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const c of all) {
    console.log(`| ${c.verb} | ${c.unit} | ${fmt(c.fireRate.onKnownBad)} | ${fmt(c.fireRate.onKnownGood)} | ${fmt(c.fireRate.onPresumedGood)} | ${fmt(c.fireRate.onNeutral)} | ${c.degenerate ?? "no"} | ${c.falsePositiveReview.candidates.length} |`);
  }
  console.log(`\nwritten to ${OUT} at ${COMMIT}`);
}
