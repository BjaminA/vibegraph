// Literal tables (2026-10-02, module 1 of the data-platform brief): a
// module-level constant that holds DATA keeps its rows on its assignment node,
// in TypeScript and Python alike. Fixtures from two codebases unlike the one
// that motivated it: a TS billing service on a broker, a Python object-store
// pipeline.
//
//   node --test test/literal_tables.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TS = join(ROOT, "test/fixtures/declared/broker_ts");
const PY = join(ROOT, "test/fixtures/declared/store_py");

function parse(file) {
  const py = file.endsWith(".py");
  const r = py
    ? spawnSync("python3", [join(ROOT, "scripts/parse_cst.py"), file], { encoding: "utf8", env: { ...process.env, PYTHONPATH: join(ROOT, ".pydeps") } })
    : spawnSync(process.execPath, [join(ROOT, "scripts/frontends/jsts/parse_jsts.mjs"), file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const tableOf = (ir, name) => ir.nodes.find((n) => n.type === "assignment" && n.name === name)?.table;

test("TS: an array of object literals is a rows table — literals verbatim, identifiers as references", () => {
  const ir = parse(join(TS, "src/topics.ts"));
  const t = tableOf(ir, "TOPICS");
  assert.equal(t.shape, "rows");
  assert.equal(t.exported, true);
  assert.equal(t.rows.length, 3);
  assert.deepEqual(t.rows[0].fields, { topic: "{env}.invoices.{tenantId}", producers: ["billing"], consumers: ["ledger", "mailer"], schema: "invoice" }, "`as const` is looked through");
  assert.equal(t.rows[0].line, 5);
  const routes = tableOf(parse(join(TS, "src/routes.ts")), "ROUTES");
  assert.deepEqual(routes.rows[0].fields.handler, { ref: "createInvoice" });
});

test("TS: a record of objects keeps its keys; a record of functions is a record of references", () => {
  const ir = parse(join(TS, "src/invoice_rules.ts"));
  const tree = tableOf(ir, "APPROVAL_TREE");
  assert.equal(tree.shape, "record");
  assert.deepEqual(tree.rows.map((r) => r.key), ["start", "amount", "review"]);
  assert.equal(tree.rows[1].fields.no, "review");
  assert.deepEqual(tree.rows[1].fields.reads, ["Invoice.total", "Tenant.limit"]);
  assert.deepEqual(tableOf(ir, "APPROVAL_CHECKS").rows.map((r) => r.value), [{ ref: "checkStanding" }, { ref: "checkAmount" }, { ref: "checkReview" }]);
  assert.deepEqual(tableOf(ir, "INVOICE_TRANSITIONS").rows[0].fields.requires, [{ ref: "hasLines" }]);
  const flags = tableOf(parse(join(TS, "src/topics.ts")), "FLAGS");
  assert.deepEqual(flags.rows.map((r) => [r.key, r.fields.enabled]), [["newPricing", true], ["dunning", false]]);
});

test("Python: a list of dicts, a dict of dicts and a dict of scalars are tables; function references are references", () => {
  const ir = parse(join(PY, "datasets.py"));
  const t = tableOf(ir, "DATASETS");
  assert.equal(t.shape, "rows");
  assert.deepEqual(t.rows[0].fields, { prefix: "{team}/raw/{dataset}", writers: ["ingest"], readers: ["analytics", "audit"] });
  assert.deepEqual(tableOf(ir, "RETENTION").rows.map((r) => [r.key, r.value]), [["raw", 30], ["curated", 365]]);
  const rv = parse(join(PY, "review.py"));
  assert.deepEqual(tableOf(rv, "PUBLISH_TREE").rows.map((r) => [r.key, r.fields.yes, r.fields.no]), [["q1", "q2", "REJECT"], ["q2", "PUBLISH", "HOLD"]]);
  assert.deepEqual(tableOf(rv, "PUBLISH_CHECKS").rows[0].value, { ref: "check_size" });
  assert.equal(tableOf(rv, "JOB_STATES").rows[1].fields.from, "RUNNING");
});

test("not tables: built by a call, a single scalar, a function's local, a lone entry", () => {
  const routes = parse(join(TS, "src/routes.ts"));
  assert.equal(tableOf(routes, "PATHS"), undefined, "ROUTES.map(...) is computed, not declared");
  const py = parse(join(PY, "datasets.py"));
  assert.equal(tableOf(py, "BUCKET"), undefined);
  assert.equal(py.nodes.filter((n) => n.table && n.parentId).length, 0, "only module-level constants");
});
