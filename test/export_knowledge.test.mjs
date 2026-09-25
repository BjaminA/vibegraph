// scripts/export_knowledge.mjs — everything VibeGraph derives from a
// codebase, on disk for a reader with no VibeGraph (h2h3 arm D). Pins:
// one IR file per source file; one contract per thread carrying the three
// worker blocks; every stated constraint rendered with its provenance; the
// plan dependencies-first with a closing bar per packet and no MCP tool
// names in the prose; the refusal to empty a directory it did not write;
// and the empty-constraints path on a fixture that states none. M-CRYSTAL.2
// added: the raw forms only with `withIr`; skills copied through the
// injection gate with the stamp the server writes, withheld and named
// otherwise; observations verbatim; a task naming no code says so.
//
//   npm run test:export-knowledge
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportKnowledge } from "../scripts/export_knowledge.mjs";
import { setThreadSkillAutoReaffirm, writeThreadSkill } from "../src/server/thread_skill_store.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TASK = "Persist `region` in `telemetry/storage.py` (`insert_readings`) and show it in `gateway/server.ts` (`getFleet`).";
const out = mkdtempSync(join(tmpdir(), "vg-knowledge-"));
const r = exportKnowledge({ root: "examples/fleet-telemetry", out, task: TASK, commit: "test", withIr: true });
const read = (f) => readFileSync(join(out, f), "utf-8");
const envelope = JSON.parse(read("envelope.json"));
const plan = JSON.parse(read("plan.json"));

test("one IR file per source file, and the README lists every file written", () => {
  const irFiles = r.written.filter((f) => f.startsWith("ir/"));
  assert.equal(irFiles.length, r.files);
  assert.ok(irFiles.includes("ir/telemetry/storage.py.ir.json"));
  const ir = JSON.parse(read("ir/telemetry/storage.py.ir.json"));
  assert.ok(Array.isArray(ir.nodes) && Array.isArray(ir.edges), "the IR shape rides through");
  const readme = read("README.md");
  for (const f of r.written) assert.ok(readme.includes(`\`${f}\``), `README names ${f}`);
  assert.ok(!("files" in envelope), "the envelope file carries no IR (it lives under ir/)");
});

test("one contract per thread, each carrying the three blocks a worker prompt carries", () => {
  const threadFiles = r.written.filter((f) => f.startsWith("threads/") && f !== "threads/INDEX.md");
  assert.equal(threadFiles.length, r.threads);
  assert.equal(r.threads, envelope.threads.filter((t) => t.entryPointId).length);
  for (const f of threadFiles) {
    const text = read(f);
    assert.ok(text.includes("## Thread contract (IR fact"), `${f}: contract block`);
    assert.ok(text.includes("## Stack for this thread"), `${f}: stack block`);
    assert.ok(text.includes("## Constraints for this thread"), `${f}: constraints block`);
  }
  const ingest = read("threads/telemetry_app.py_ingest_route.md");
  assert.ok(ingest.includes("Leaves the project through"), "the boundary section is present");
  assert.ok(ingest.includes("human-stated"), "a routed constraint carries its provenance");
  assert.ok(read("threads/INDEX.md").includes("`telemetry/app.py:ingest_route`"));
});

test("every stated constraint is rendered with provenance; the system spec names the funnels", () => {
  const c = read("constraints.md");
  assert.equal((c.match(/human-stated/g) ?? []).length, r.constraints);
  assert.equal(r.constraints, 6);
  assert.ok(c.includes("ops runbook §7"), "the note rides along");
  const spec = read("system_spec.md");
  assert.ok(spec.includes("telemetry.storage (project funnel wrapping sqlite3"));
  assert.ok(spec.includes("[c1 · proxy · human-stated]"));
});

test("the plan is dependencies-first with a closing bar per packet, names the unmatched token, and speaks no MCP tool names", () => {
  assert.ok(plan.packets.length >= 2);
  const orderOf = new Map(plan.packets.map((p) => [p.entryPointId, p.order]));
  for (const p of plan.packets) {
    assert.equal(p.id, `p${p.order}`);
    assert.ok(typeof p.acceptance.closingBar === "string" && p.acceptance.closingBar.startsWith("edits inside "), `${p.id}: closing bar`);
    for (const d of p.boundaries.dependsOn) {
      if (orderOf.has(d)) assert.ok(orderOf.get(d) < p.order, `${p.id} depends on ${d}, which must come first`);
    }
  }
  assert.ok(plan.unmatchedTokens.some((t) => t.includes("region")), "`region` exists nowhere yet, so no thread owns it");
  const md = read("plan.md");
  assert.ok(md.includes("matched NO thread"));
  assert.ok(md.includes("## p1 ·"));
  assert.ok(!md.includes("vibegraph_"), "the plain reader has none of the MCP tools");
  assert.ok(!md.includes("``"), "matched tokens are rendered with single backticks");
});

test("refuses to empty a directory it did not write", () => {
  const foreign = mkdtempSync(join(tmpdir(), "vg-foreign-"));
  writeFileSync(join(foreign, "notes.txt"), "mine");
  assert.throws(() => exportKnowledge({ root: "examples/fleet-telemetry", out: foreign, commit: "test" }), /refusing to overwrite/);
  assert.ok(existsSync(join(foreign, "notes.txt")));
  rmSync(foreign, { recursive: true, force: true });
  // Its own output it may replace.
  const again = exportKnowledge({ root: "examples/fleet-telemetry", out, commit: "test" });
  assert.equal(again.packets, null, "no task, no plan");
  assert.ok(!existsSync(join(out, "plan.md")));
  assert.ok(read("README.md").includes("no task was given"));
});

test("by default the raw forms are not written, and the README says how to get them", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-prose-"));
  const r2 = exportKnowledge({ root: "examples/fleet-telemetry", out: dir, commit: "test" });
  assert.equal(r2.withIr, false);
  for (const f of r2.written) {
    assert.ok(!/^(ir\/|quality\/|envelope\.json|stack\.json|crossings\.json)/.test(f), `not written by default: ${f}`);
  }
  assert.ok(r2.written.includes("constraints.md") && r2.written.includes("system_spec.md") && r2.written.includes("threads/INDEX.md"));
  assert.equal(r2.written.filter((f) => f.startsWith("threads/")).length, r.threads + 1);
  const readme = readFileSync(join(dir, "README.md"), "utf-8");
  assert.ok(readme.includes("`--with-ir` adds them"));
  assert.ok(!readme.includes("`ir/<file>.ir.json`"), "the index does not point at files that are not there");
  rmSync(dir, { recursive: true, force: true });
});

test("skills travel through the injection gate with the stamp the server writes; withheld ones are named with the reason; observations travel verbatim", () => {
  const copy = mkdtempSync(join(tmpdir(), "vg-fleet-"));
  cpSync(join(ROOT, "examples", "fleet-telemetry"), copy, { recursive: true });
  rmSync(join(copy, ".vibegraph", "knowledge"), { recursive: true, force: true });
  rmSync(join(copy, ".vibegraph", "thread-skills"), { recursive: true, force: true });
  const first = exportKnowledge({ root: copy, out: join(copy, "k1"), commit: "test" });
  assert.equal(first.skills.copied + first.skills.withheld, 0, "the example ships no skills (they are gitignored)");

  const fresh = "telemetry/alerts.py:evaluate";      // rules route here: composite stamp
  const stale = "telemetry/export.py:export_csv";
  const draft = "telemetry/storage.py:insert_readings";
  assert.ok(first.stamps[fresh].includes("|"), "a thread with routed rules stamps the composite");
  const at = "2026-09-22T10:00:00.000Z";
  writeThreadSkill(copy, fresh, "## Rules and why\n- Page only through notify, after should_notify: a flapping sensor once paged the on-call forty times.", first.stamps[fresh], at, "ratified");
  writeThreadSkill(copy, stale, "old guidance", "sha256:0000", at, "ratified");
  writeThreadSkill(copy, draft, "unreviewed guidance", first.stamps[draft], at, "draft");
  const obs = JSON.stringify({ version: 1, note: "test overlay", sites: {} }, null, 2) + "\n";
  writeFileSync(join(copy, ".vibegraph", "observations.json"), obs);

  const second = exportKnowledge({ root: copy, out: join(copy, "k2"), commit: "test" });
  assert.equal(second.skills.copied, 1);
  assert.equal(second.skills.withheld, 2);
  const skillFile = join(copy, "k2", "skills", "telemetry_alerts.py_evaluate.md");
  assert.ok(existsSync(skillFile));
  const skill = readFileSync(skillFile, "utf-8");
  assert.ok(skill.includes("ratified by a human") && skill.includes("· fresh"), "provenance and freshness in the header");
  assert.ok(skill.includes("a flapping sensor once paged the on-call forty times"), "the body travels");
  assert.ok(!skill.includes("auto-re-affirmed"), "a fresh skill carries no caveat");
  const readme = readFileSync(join(copy, "k2", "README.md"), "utf-8");
  assert.ok(readme.includes("`skills/<entry point>.md`") && readme.includes("1 copied"));
  assert.ok(readme.includes("`telemetry/export.py:export_csv` withheld: stale"), "the stale skill is named with its reason");
  assert.ok(readme.includes("`telemetry/storage.py:insert_readings` withheld: a draft"), "the draft is named with its reason");
  const index = readFileSync(join(copy, "k2", "threads", "INDEX.md"), "utf-8");
  assert.ok(index.includes("| skills/telemetry_alerts.py_evaluate.md |"));
  assert.ok(index.includes("withheld: stale"));
  assert.equal(readFileSync(join(copy, "k2", "observations.json"), "utf-8"), obs, "the overlay is copied byte for byte");
  assert.ok(readme.includes("`observations.json`** (OBSERVED)"));

  // The human opts the stale skill into auto-reaffirm: it travels WITH the caveat, never silently.
  setThreadSkillAutoReaffirm(copy, stale, true);
  const third = exportKnowledge({ root: copy, out: join(copy, "k3"), commit: "test" });
  assert.equal(third.skills.copied, 2);
  assert.equal(third.skills.withheld, 1);
  const kept = readFileSync(join(copy, "k3", "skills", "telemetry_export.py_export_csv.md"), "utf-8");
  assert.ok(kept.includes("STALE") && kept.includes("auto-re-affirmed"), "a stale skill kept by opt-in says so twice: header and caveat");
  rmSync(copy, { recursive: true, force: true });
});

test("a task that names no code yields an empty plan that says so, not a vacuous 'every token matched'", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-nocode-"));
  const r3 = exportKnowledge({ root: "test/fixtures/polyglot/shop_demo", out: dir, task: "page operators when a region goes silent", commit: "test" });
  assert.equal(r3.taskNamesNoCode, true);
  assert.equal(r3.packets, 0);
  const md = readFileSync(join(dir, "plan.md"), "utf-8");
  assert.ok(md.includes("**The task names no code**"));
  assert.ok(!md.includes("Every code-shaped token in the task matched a thread"));
  assert.ok(md.includes("threads/INDEX.md"), "it points at the other way in");
  assert.ok(!md.includes("vibegraph_"), "the refusal names no MCP tool the plain reader lacks");
  rmSync(dir, { recursive: true, force: true });
});

test("a project stating no constraints says so, on every surface", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-none-"));
  const r2 = exportKnowledge({ root: "test/fixtures/polyglot/shop_demo", out: dir, commit: "test" });
  assert.equal(r2.constraints, 0);
  assert.ok(readFileSync(join(dir, "constraints.md"), "utf-8").includes("No stated constraints"));
  const threadFiles = readdirSync(join(dir, "threads")).filter((f) => f !== "INDEX.md");
  assert.ok(threadFiles.length > 0);
  for (const f of threadFiles) assert.ok(readFileSync(join(dir, "threads", f), "utf-8").includes("None of the stated constraints route to this thread"), f);
  assert.ok(readFileSync(join(dir, "README.md"), "utf-8").includes("0 stated constraints"));
  rmSync(dir, { recursive: true, force: true });
});

after(() => rmSync(out, { recursive: true, force: true }));
