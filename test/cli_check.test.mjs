// M-CRYSTAL.3 — `check`, the verifier. Pins, on examples/fleet-telemetry:
// the committed tree violates nothing; a copy with the h2h3 Cc bypass (a
// new function in alerts.py that calls notify without should_notify) is
// VIOLATED by both the grammar's calls-through and the Run 1 guards verb,
// naming the offending node, exit 1; a constraint whose target does not
// exist is UNVERIFIABLE with its reason and exit 2, never a pass; and the
// report says all of it in words.
//
//   npm run test:cli-check
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatCheckReport, runConstraintChecks } from "../scripts/cli/check.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FLEET = join(ROOT, "examples", "fleet-telemetry");
const tmp = mkdtempSync(join(tmpdir(), "vgk-check-"));

function copyFleet(name) {
  const dir = join(tmp, name);
  cpSync(FLEET, dir, { recursive: true });
  rmSync(join(dir, ".vibegraph", "knowledge"), { recursive: true, force: true });
  return dir;
}
function patchConstraints(dir, fn) {
  const p = join(dir, ".vibegraph", "constraints.json");
  const d = JSON.parse(readFileSync(p, "utf-8"));
  fn(d);
  writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
}

const clean = runConstraintChecks({ root: FLEET, commit: "test" });

test("the committed example violates nothing, and every verdict carries a reason", () => {
  assert.equal(clean.constraints, 6);
  assert.deepEqual(clean.results.map((r) => `${r.id}:${r.rule}`), ["c1:import-only", "c3:callers-only", "c3:calls-through"]);
  assert.equal(clean.summary.violated, 0);
  for (const r of clean.results) {
    assert.ok(["pass", "unverifiable"].includes(r.verdict), `${r.id} ${r.rule}: ${r.verdict}`);
    assert.ok(r.reason.length > 0);
    assert.deepEqual(r.offenders, []);
  }
  assert.deepEqual(clean.unchecked, ["c2", "c4", "c5", "c6"], "prose-only constraints are listed, not silently skipped");
  const report = formatCheckReport(clean);
  assert.ok(report.includes("[c1] import-only —"));
  assert.ok(report.includes("4 constraints have no checkable half"));
  assert.ok(report.includes(`→ exit ${clean.exitCode}`));
});

test("the Cc bypass is VIOLATED by calls-through and by guards, naming the node; exit 1", () => {
  const dir = copyFleet("bypass");
  appendFileSync(join(dir, "telemetry", "alerts.py"), [
    "", "",
    "def check_region(reading: dict) -> None:",
    '    """Page when a device reports a new region."""',
    '    notify({"device_id": reading["device_id"], "message": "region changed"})',
    "",
  ].join("\n"));
  patchConstraints(dir, (d) => {
    d.constraints.find((c) => c.id === "c3").checks.push({ rule: "guards", target: "notify", guard: "should_notify" });
  });
  const r = runConstraintChecks({ root: dir, commit: "test" });
  assert.equal(r.exitCode, 1);
  const through = r.results.find((x) => x.rule === "calls-through");
  assert.equal(through.verdict, "violated");
  assert.ok(through.offenders.some((o) => o.includes("check_region")), `offender names the node: ${through.offenders.join(", ")}`);
  const guards = r.results.find((x) => x.rule === "guards");
  assert.equal(guards.verdict, "violated", guards.reason);
  assert.ok(guards.offenders.some((o) => o.includes("check_region")), `guards names the node: ${guards.offenders.join(", ")}`);
  assert.ok(guards.threads.length > 1, "a Run 1 verb ran per routed thread and the verdicts were joined");
  const report = formatCheckReport(r);
  assert.ok(report.includes("→ VIOLATED"));
  assert.ok(report.includes("offender: telemetry/alerts.py:"));
  assert.match(report, /\d+ checked: 2 violated, \d+ unverifiable, \d+ pass → exit 1/);

  // The CLI's exit code is the verdict, so a hook can act on it.
  const cli = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts", "cli", "main.mjs"), "check", dir],
    { encoding: "utf-8", env: { ...process.env, VIBEGRAPH_PYDEPS: join(ROOT, ".pydeps") } });
  assert.equal(cli.status, 1, cli.stderr);
  assert.ok(cli.stdout.includes("[c3] guards —"));
});

test("a target the IR does not know is UNVERIFIABLE with its reason and exit 2 — never a pass", () => {
  const dir = copyFleet("unknown");
  patchConstraints(dir, (d) => {
    d.constraints.push({
      id: "c9", kind: "invariant", source: "human", createdAt: "2026-09-22T00:00:00.000Z",
      text: "Only alerts.py may call page_everyone.",
      scope: { files: ["telemetry/"] },
      check: { rule: "callers-only", target: "page_everyone", files: ["telemetry/alerts.py"] },
    });
  });
  const r = runConstraintChecks({ root: dir, commit: "test" });
  const c9 = r.results.find((x) => x.id === "c9");
  assert.equal(c9.verdict, "unverifiable");
  assert.match(c9.reason, /page_everyone/);
  assert.equal(r.summary.violated, 0);
  assert.equal(r.exitCode, 2);
  const report = formatCheckReport(r);
  assert.ok(report.includes("[c9] callers-only —") && report.includes("→ UNVERIFIABLE"));
  assert.ok(report.includes("unverifiable is NOT a pass"));
});

test("--uncommitted makes the working tree the delta, so co-changes is verifiable from a hook after an edit", () => {
  const dir = copyFleet("wt");
  patchConstraints(dir, (d) => {
    d.constraints.find((c) => c.id === "c6").check = { rule: "co-changes", when: "telemetry/storage.py", require: "telemetry/migrations.py" };
  });
  const git = (...a) => { const r = spawnSync("git", a, { cwd: dir, encoding: "utf-8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base");
  appendFileSync(join(dir, "telemetry", "storage.py"), "\n# a schema change without its migration\n");

  const without = runConstraintChecks({ root: dir, commit: "test" });
  assert.equal(without.results.find((x) => x.rule === "co-changes").verdict, "unverifiable", "no delta, no verdict");
  const withTree = runConstraintChecks({ root: dir, commit: "test", uncommitted: true });
  const c6 = withTree.results.find((x) => x.rule === "co-changes");
  assert.equal(c6.verdict, "violated", c6.reason);
  assert.match(c6.reason, /migrations\.py/);
  assert.match(withTree.deltaNote, /working tree's 1 uncommitted change/);
  assert.equal(withTree.exitCode, 1);
  assert.ok(formatCheckReport(withTree).includes("delta: the working tree's 1 uncommitted change"));
});

test("a project with no stated constraints says so and exits 0", () => {
  const r = runConstraintChecks({ root: join(ROOT, "test", "fixtures", "polyglot", "shop_demo"), commit: "test" });
  assert.equal(r.constraints, 0);
  assert.equal(r.exitCode, 0);
  assert.ok(formatCheckReport(r).includes("nothing to check"));
});

after(() => rmSync(tmp, { recursive: true, force: true }));
