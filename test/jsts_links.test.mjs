// TypeScript links a real project needs (2026-09-30, reported from a real
// plan check: "the Guarded-write thread's steps aren't found … barrel files"
// and "it can't follow calls on class instances"). Two gaps, one fixture:
//   - RE-EXPORTS: `import { x } from "./lib"` where lib/index.ts only passes x
//     through (`export { x } from "./x"`, `export * from "./util"`) — followed
//     to where x is written; a renamed re-export too; two `export *` offering
//     one name is left unlinked (JS makes it undefined); a cycle ends;
//   - CLASS INSTANCES: `const w = new C(); w.m()` → C.m, and a parameter typed
//     `w: C` → C.m unless some class extends C; a name assigned twice, and
//     `this.m()`, stay unlinked — the file does not say which one runs.
//
//   npm run test:jsts-links
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { buildStackIndex } from "../src/server/stack.ts";

const ROOT = "test/fixtures/jsts/barrel_demo";
let env, refs;
before(() => {
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  refs = new Map(env.files["app.ts"].edges.filter((e) => e.type === "reference").map((e) => [e.source.split("/").pop(), `${e.targetFile}#${e.target}`]));
});

test("re-exports: through a barrel, a renamed re-export, and a cycle that ends", () => {
  assert.equal(refs.get("writer_write.call"), "lib/writer.ts#module/GuardedWriter.class/write.fn", "the class imported through lib/index.ts");
  assert.equal(refs.get("assist.call"), "lib/util.ts#module/helper.fn", "export { helper as assist } from …");
  const barrel = env.files["lib/index.ts"].nodes.filter((n) => n.type === "import_from");
  assert.ok(barrel.every((n) => n.reexport === true));
  assert.deepEqual(barrel.map((n) => n.names), [["GuardedWriter"], ["*"], ["helper as assist"], ["*"]]);
});

test("two `export *` offering the same name link to neither", () => {
  assert.equal(refs.has("clash.call"), false);
});

test("class instances: a `new` binding and a typed parameter link; a subclassed type, a reassigned name do not", () => {
  assert.equal(refs.get("l_run.call"), "app.ts#module/Local.class/run.fn");
  assert.equal(refs.get("typed_write.call"), "lib/writer.ts#module/GuardedWriter.class/write.fn", "typed as a class nothing extends");
  assert.equal(refs.has("base_m.call"), false, "Base has a subclass: which m runs is decided at run time");
  assert.equal(refs.has("either_run.call"), false, "assigned twice: the file does not say which instance");
});

test("fields that hold instances: this.<field>.<method>() follows a declared type or a single `new`, and refuses when the class does not say", () => {
  const svc = new Map(env.files["service.ts"].edges.filter((e) => e.type === "reference").map((e) => [e.source.split("/").slice(-2).join("/"), `${e.targetFile}#${e.target}`]));
  assert.equal(svc.get("save.fn/this_writer_write.call"), "lib/writer.ts#module/GuardedWriter.class/write.fn", "declared `writer: GuardedWriter`");
  assert.equal(svc.get("save.fn/this_backup_write.call"), "lib/writer.ts#module/GuardedWriter.class/write.fn", "a constructor parameter property");
  assert.equal(svc.get("save.fn/this_local_run.call"), "app.ts#module/Local.class/run.fn", "untyped, set once: `this.local = new Local()`");
  assert.equal(svc.has("save.fn/this_base_m.call"), false, "Base has a subclass: which m runs is decided at run time");
  assert.equal(svc.has("go.fn/this_local_run.call"), false, "assigned in two places: the class does not say which instance");
  const cls = env.files["service.ts"].nodes.find((n) => n.id === "module/Service.class");
  assert.deepEqual(cls.fieldTypes, { writer: "GuardedWriter", base: "Base", backup: "GuardedWriter" });
});

test("plan check matches a step written `Class.method` against the step's own id (the label is only `method`)", () => {
  let plan = applyPlanOps(null, [{ op: "set-objective", text: "Guarded writes reach storage" }], "human").plan;
  plan = applyPlanOps(plan, [{ op: "add", section: "threads", item: { id: "app.test.ts:module", entry: "test", serves: "guarded writes", primary: ["GuardedWriter.write", "Local.run", "helper", "Nope.run"] } }], "human").plan;
  const rec = reconcilePlan(plan, env, buildStackIndex(env, ROOT), ROOT);
  const f = rec.findings.find((x) => x.section === "threads");
  assert.equal(f.verdict, "drifted");
  assert.match(f.detail, /not found on its thread: Nope\.run$/, "only the method no class here defines is missing");
});

test("the thread walks through them: the steps a plan names are found", () => {
  const t = env.threads.find((x) => x.entryPointId === "app.test.ts:module");
  const steps = t.nodes.filter((n) => n.kind === "step").map((n) => n.label);
  for (const s of ["main", "write", "run", "helper"]) assert.ok(steps.includes(s), `${s} is a step: ${steps.join(", ")}`);
});
