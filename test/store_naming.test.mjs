// Which store a derived zone belongs to (2026-10-08). The derived topology
// named its one store after the client package with the most store calls, so
// a zone the plan did not group read "zone of <package>" beside the plan's
// own store — one store drawn as two. On test/fixtures/declared/store_py
// (boto3 writes and reads `raw_{team}` and `curated`):
//
//   1. the declared topology places a family    → that declared zone
//   2. one planned store reached through boto3   → that store, the zone said
//      to be one the plan does not name
//   3. a RATIFIED spec lists boto3 as a package  → the spec's tool (a draft: no)
//   4. nothing names it, or two planned stores do → kept, said "unnamed"
//
//   npm run test:store-naming
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { deriveDataZones } from "../src/server/arch_data_zones.ts";
import { emptyPlan } from "../src/server/plan_store.ts";

const root = join(import.meta.dirname, "..", "test/fixtures/declared/store_py");
const env = buildPolyglotEnvelope(root).envelope;
const stack = buildStackIndex(env, root);
const model = archModelForEnvelope(env, stack, null, root);
const zones = (extra) => deriveDataZones({ files: env.files, threads: env.threads, stack, model, ...extra });
const ids = (r) => r.nodes.map((n) => n.id);
const node = (r, id) => r.nodes.find((n) => n.id === id);
const spec = (status) => ({ tool: "lake-store", status, identity: { packages: ["boto3"], calls: [] } });

test("2: one planned store reached through the client takes the zones the plan did not group, and says they are not the plan's", () => {
  const plan = emptyPlan("Keep the lake");
  plan.stores = [{ id: "lake", label: "the lake", kind: "object-store", reachedThrough: ["boto3"], status: "agreed", zones: [{ id: "raw", holds: ["raw_{team}"] }] }];
  const r = zones({ plan });
  assert.deepEqual(ids(r), ["zone:lake/curated", "zone:lake/raw"], "one store, not lake + boto3");
  const c = node(r, "zone:lake/curated");
  assert.match(c.sublabel, /^zone of the lake · curated/);
  assert.match(c.notes[0], /the plan's store lake is reached through boto3/);
  assert.ok(c.notes.some((n) => /Not one of the plan's zones: the code uses it, the plan's store lake does not name it/.test(n)));
  assert.ok(!node(r, "zone:lake/raw").notes.some((n) => /Not one of the plan's zones/.test(n)), "a planned zone is the plan's");
  assert.ok(r.notes.some((n) => /1 zone\(s\) the code uses that the plan's stores do not name: lake\/curated/.test(n)));
  assert.ok(r.edges.some((e) => e.to === "zone:lake/curated"), "boto3 is still the store's client: the operations are drawn");
});

test("1: a family the declared topology places goes to its declared zone", () => {
  const declared = { stores: [{ id: "warehouse" }], zones: [{ id: "refined", store: "warehouse", holds: ["curated"] }] };
  const r = zones({ declared });
  assert.ok(ids(r).includes("zone:warehouse/refined"), ids(r).join(", "));
  assert.match(node(r, "zone:warehouse/refined").notes[0], /the declared topology places curated in warehouse\/refined/);
  assert.ok(r.edges.some((e) => e.to === "zone:warehouse/refined"));
});

test("3: a ratified software spec whose packages include the client names the store; a draft does not", () => {
  const r = zones({ specs: [spec("ratified")] });
  assert.deepEqual(ids(r), ["zone:lake-store/curated", "zone:lake-store/raw_{team}"]);
  assert.match(node(r, "zone:lake-store/curated").notes[0], /the ratified software spec lake-store lists boto3 as its package/);
  assert.deepEqual(ids(zones({ specs: [spec("draft")] })), ["zone:boto3/curated", "zone:boto3/raw_{team}"]);
});

test("4: nothing names it — kept under the client, said as unnamed with what would name it; two planned stores on one client choose neither", () => {
  const r = zones({});
  assert.deepEqual(ids(r), ["zone:boto3/curated", "zone:boto3/raw_{team}"]);
  assert.match(node(r, "zone:boto3/curated").sublabel, /^zone of the store behind boto3 \(unnamed\)/);
  assert.ok(r.notes.some((n) => /Zones with no named store: nothing names the store reached through boto3: add it to the plan's stores/.test(n)));
  const plan = emptyPlan("Keep two lakes");
  plan.stores = ["east", "west"].map((id) => ({ id, label: id, kind: "object-store", reachedThrough: ["boto3"], status: "agreed" }));
  const amb = zones({ plan, specs: [spec("ratified")] });
  assert.deepEqual(ids(amb), ["zone:boto3/curated", "zone:boto3/raw_{team}"], "ambiguous: not east, not west, and not the spec either");
  assert.ok(amb.notes.some((n) => /the plan reaches east and west through it, so neither is chosen/.test(n)));
});
