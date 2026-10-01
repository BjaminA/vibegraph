// Layering rules that are checked (2026-10-01, Module 6 of the plan-
// architecture brief). Fixture test/fixtures/plan/store_demo: the planned
// module `decisions` (pure logic) may import nothing — its rule p1 is
// `{rule: "layer", files: ["decisions"], mayImport: []}`, module ids as
// shorthand. Pinned: the layer verb reads the project import graph (workspace
// packages by name included); a pure-logic module importing the transport is
// VIOLATED with file:line; a layer with no parsed file is unverifiable, one
// importing nothing passes; promotion expands module ids to folders, since
// constraints.json knows no plan; and `plan layers` offers today's graph as
// each module's starting rule.
//
//   npm run test:plan-layers
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { promotePolicy } from "../src/server/plan_promote.ts";
import { loadConstraints } from "../src/server/constraint_store.ts";
import { checkConstraint, isConstraintCheck, describeCheck } from "../src/server/constraint_grammar.ts";
import { proposeLayers } from "../src/server/plan_layers.ts";
import { importGraph, workspacePackages } from "../src/server/import_graph.ts";
import { runConstraintChecks } from "../scripts/cli/check.mjs";

const ROOT = "test/fixtures/plan/store_demo";
let tmp, bad;
const BAD_IMPORT = 'import { writeDoc } from "@acme/store-client";\n';
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-layers-"));
  bad = join(tmp, "store_demo");
  cpSync(ROOT, bad, { recursive: true });
  const f = join(bad, "packages/decisions/src/index.ts");
  writeFileSync(f, BAD_IMPORT + readFileSync(f, "utf-8"));
});
after(() => rmSync(tmp, { recursive: true, force: true }));
const find = (rec, section, id) => rec.findings.find((x) => x.section === section && x.id === id);
const analyse = (root) => {
  const env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  return { env, stack: buildStackIndex(env, root) };
};

test("the pure-logic layer imports nothing: p1 passes", () => {
  const { env, stack } = analyse(ROOT);
  const f = find(reconcilePlan(loadPlan(ROOT), env, stack, ROOT), "policies", "p1");
  assert.equal(f.verdict, "pass", f.detail);
  assert.match(f.detail, /packages\/decisions\/ may import only itself/);
});

test("ACCEPTANCE: an import from the pure-logic module into the transport is reported with file:line", () => {
  const { env, stack } = analyse(bad);
  const f = find(reconcilePlan(loadPlan(bad), env, stack, bad), "policies", "p1");
  assert.equal(f.verdict, "violated");
  assert.match(f.detail, /packages\/decisions\/src\/index\.ts:1 imports @acme\/store-client \(packages\/store-client\/src\/index\.ts\)/);
});

test("the verb: scopes, the standard library, and unverifiable is never a pass", () => {
  const edges = [
    { from: "lib/a.ts", to: "lib/b.ts", spec: "./b", line: 1 },
    { from: "lib/a.ts", to: null, pkg: "zod", spec: "zod", line: 2 },
    { from: "lib/a.ts", to: null, pkg: "@acme/util", spec: "@acme/util/x", line: 3 },
    { from: "lib/a.ts", to: null, pkg: "node:fs", spec: "node:fs", line: 4 },
  ];
  const facts = { importEdges: edges, parsedFiles: ["lib/a.ts", "lib/b.ts", "empty/c.ts"] };
  const ok = { rule: "layer", files: ["lib/"], mayImport: ["zod", "@acme/*"] };
  assert.ok(isConstraintCheck(ok));
  assert.equal(checkConstraint(facts, ok).verdict, "pass");
  const noStd = checkConstraint(facts, { ...ok, allowStdlib: false });
  assert.deepEqual(noStd.offenders, ["lib/a.ts:4 imports node:fs"]);
  assert.equal(checkConstraint(facts, { rule: "layer", files: ["empty/"], mayImport: [] }).verdict, "pass", "a layer importing nothing passes");
  assert.equal(checkConstraint(facts, { rule: "layer", files: ["nowhere/"], mayImport: [] }).verdict, "unverifiable");
  assert.equal(checkConstraint({}, ok).verdict, "unverifiable", "no import graph: never a pass");
  assert.ok(!isConstraintCheck({ rule: "layer", files: [], mayImport: [] }), "a layer needs files");
  assert.match(describeCheck(ok), /lib\/ may import only zod, @acme\/\* \(and the standard library\)/);
});

test("promotion expands module ids to folders; `check` then reports the violation", () => {
  const r = promotePolicy(bad, loadPlan(bad), "p1");
  assert.equal(r.error, undefined, r.error);
  const c = loadConstraints(bad).find((x) => x.id === r.plan.policies[0].constraintId);
  assert.deepEqual(c.check, { rule: "layer", files: ["packages/decisions/"], mayImport: [] });
  const res = runConstraintChecks({ root: bad, pipeline: {} });
  const row = res.results.find((x) => x.id === c.id);
  assert.equal(row.verdict, "violated");
  assert.equal(res.exitCode, 1);
});

test("`plan layers` offers today's import graph as each module's starting rule", () => {
  const { env } = analyse(ROOT);
  const p = proposeLayers(loadPlan(ROOT), importGraph(env.files, workspacePackages(ROOT)));
  assert.match(p.lines.join("\n"), /decisions: already has a layer rule — skipped/);
  assert.match(p.lines.join("\n"), /store-client: may import @acme\/store-sdk, yjs/);
  assert.equal(p.ops.length, 1);
  assert.deepEqual(p.ops[0].item.check, { rule: "layer", files: ["store-client"], mayImport: ["@acme/store-sdk", "yjs"] });
  assert.equal(p.ops[0].item.status, "proposed");
});
