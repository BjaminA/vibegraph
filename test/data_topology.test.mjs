// Name patterns, resources and zones, data-coupled flows, library vs
// deployable (2026-10-02, modules 2, 5, 6 and 8 of the data-platform brief),
// on two codebases unlike the one that motivated them: a TS billing service on
// a broker, a Python object-store pipeline.
//
//   node --experimental-strip-types --no-warnings --test test/data_topology.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { deriveDataArchitecture } from "../src/server/data_arch.ts";
import { validateTopology } from "../src/server/topology_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { emptyPlan } from "../src/server/plan_store.ts";

const ROOT = join(import.meta.dirname, "..");
function load(dir) {
  const root = join(ROOT, "test/fixtures/declared", dir);
  const env = buildPolyglotEnvelope(root).envelope;
  const stack = buildStackIndex(env, root);
  return { root, env, stack, da: deriveDataArchitecture(env.files, stack, env.threads) };
}
const ts = load("broker_ts");
const py = load("store_py");

test("module 2: builders are reduced to patterns, holes named by parameter; a computed name is said with where it is computed", () => {
  const p = Object.fromEntries(ts.da.namePatterns.map((x) => [x.fn, x.pattern]));
  assert.equal(p.topicFor, "{env}.{family}.{tenantId}");
  assert.equal(p.auditTopic, "{env}.audit", "a function declaration as well as an arrow");
  assert.equal(p.groupFor, "grp-{team}", "a transformed parameter is still its hole");
  assert.equal(p.shardTopic, undefined, "a loop and a join: not a pattern");
  const fns = py.da.namePatterns.map((x) => `${x.fn} ${x.pattern}`);
  assert.ok(fns.includes("raw_key {team}/raw/{dataset}") && fns.includes("curated_key {team}/curated/{dataset}"), "f-string and + concatenation");
  const send = ts.da.sdkCalls.find((c) => c.file === "src/kafka_ports.ts" && c.line === 10);
  assert.equal(send.name, "{env}.invoices.{tenantId}", "the literal argument fills its hole");
  const dated = py.da.sdkCalls.find((c) => c.file === "ingest.py" && c.line === 12);
  assert.match(dated.computedAt, /^datasets\.py:\d+$/);
});

test("module 5: a catalogue's rows are families, a naming record names their zones, writers and readers are grants", () => {
  const t = py.da.topology;
  assert.deepEqual(t.zones.map((z) => z.id), ["raw_{team}", "curated", "reference"], "zones named by the naming record, a hole kept");
  assert.equal(t.stores[0].id, "boto3");
  assert.deepEqual(t.grants.filter((g) => g.zone === "raw_{team}" && g.access === "write").map((g) => g.who), ["role:ingest"]);
  assert.deepEqual(t.grants.filter((g) => g.zone === "raw_{team}" && g.access === "read").map((g) => g.who), ["role:analytics", "role:audit"]);
  assert.equal(validateTopology(t), null);
  const z = ts.da.topology.zones.map((x) => x.id);
  assert.deepEqual(z, ["{env}.invoices.{tenantId}", "{env}.payments.{tenantId}", "{env}.audit"], "with no naming record a family's pattern is its zone");
  assert.equal(ts.da.topology.stores[0].kind, "queue");
});

test("module 6: a family written in one process and watched or read in another is a hop — through a port, through a call into a funnel", () => {
  const hops = (da) => da.flows.map((h) => `${h.family}: ${h.from.file}(${h.from.entries}) -> ${h.to.op} ${h.to.file}(${h.to.entries})`);
  assert.deepEqual(hops(ts.da).sort(), [
    "{env}.invoices.{tenantId}: src/billing.ts(bin/billing.ts) -> watch bin/ledger.ts(bin/ledger.ts)",
    "{env}.invoices.{tenantId}: src/kafka_ports.ts(bin/billing.ts) -> watch bin/ledger.ts(bin/ledger.ts)",
  ], "the pure logic's port call and its adapter's send; audit has no reader, so no hop");
  assert.match(ts.da.flows[0].note, /order is not proven/);
  assert.deepEqual(hops(py.da).sort(), [
    "curated: analytics.py(analytics.py) -> read reporting.py(reporting.py)",
    "curated: backfill.py(backfill.py) -> read reporting.py(reporting.py)",
    "raw_{team}: backfill.py(backfill.py) -> read analytics.py(analytics.py)",
    "raw_{team}: ingest.py(ingest.py) -> read analytics.py(analytics.py)",
  ], "reporting reads `curated` because a zone's literal name is passed to a function that lists it");
  const tail = py.da.operations.find((o) => o.file === "reporting.py");
  assert.deepEqual([tail.op, tail.family, tail.via[0].split(" ")[0]], ["read", "curated", "tail"]);
  assert.ok(!py.da.operations.some((o) => o.file === "storage.py"), "a funnel fed two names serves every family: not an operation on one");
  assert.ok(!ts.da.operations.some((o) => o.entries.some((e) => e.startsWith("test/"))), "a test is not a process");
});

test("module 8: a process is what runs, not a folder — no own code is not built; an entry named like it elsewhere is said; the write matrix sees derived writes", () => {
  const plan = emptyPlan("Bill tenants and keep the ledger");
  plan.processes = [
    { id: "billing", label: "billing service", kind: "backend", serves: "bill tenants", at: "src", runsAs: "billing-svc", status: "agreed" },
    { id: "mailer", label: "mailer", kind: "backend", serves: "bill tenants", at: "mailer/", uses: ["core"], status: "agreed" },
  ];
  plan.modules = [{ id: "core", label: "billing core", kind: "library", at: "src/", status: "agreed" }];
  plan.principals = [{ id: "billing-svc", label: "billing identity", kind: "service", status: "agreed" }];
  plan.stores = [{ id: "topics", label: "tenant topics", kind: "queue", reachedThrough: ["kafkajs"], status: "agreed",
    zones: [{ id: "invoices", holds: ["{env}.invoices.{tenantId}"], writers: ["billing-svc"] }] }];
  const rec = reconcilePlan(plan, ts.env, ts.stack, ts.root);
  const f = (section, id) => rec.findings.find((x) => x.section === section && x.id === id);
  assert.equal(f("processes", "mailer").verdict, "not-built");
  assert.match(f("processes", "mailer").detail, /nothing of its own yet/);
  assert.match(f("processes", "billing").detail, /runs from bin\/billing\.ts \(an entry point named like it, outside its `at`\)/);
  // billing declares no entry point and no planned process owns bin/billing.ts:
  // the write is reached only from an entry in no planned process — said, not passed
  assert.equal(f("stores", "topics/invoices:writers").verdict, "unverifiable");
  assert.match(f("stores", "topics/invoices:writers").detail, /reached only from entry points in no planned process/);
});

test("a write is charged to the processes whose threads reach its FUNCTION, not to whoever owns its file", () => {
  const plan = emptyPlan("Bill tenants and keep the ledger");
  // the adapter file (src/kafka_ports.ts) lies in ledger's folder, but only billing's thread reaches publishInvoice
  plan.processes = [
    { id: "billing", label: "billing", kind: "backend", serves: "bill tenants", at: "bin", entryPoints: ["bin/billing.ts"], runsAs: "billing-svc", status: "agreed" },
    { id: "ledger", label: "ledger", kind: "backend", serves: "keep the ledger", at: "src", entryPoints: ["bin/ledger.ts"], runsAs: "ledger-svc", status: "agreed" },
  ];
  plan.principals = [
    { id: "billing-svc", label: "billing identity", kind: "service", status: "agreed" },
    { id: "ledger-svc", label: "ledger identity", kind: "service", status: "agreed" },
  ];
  plan.stores = [{ id: "topics", label: "tenant topics", kind: "queue", reachedThrough: ["kafkajs"], status: "agreed",
    zones: [{ id: "invoices", holds: ["{env}.invoices.{tenantId}"], writers: ["billing-svc"] }] }];
  const rec = reconcilePlan(plan, ts.env, ts.stack, ts.root);
  const w = rec.findings.find((x) => x.section === "stores" && x.id === "topics/invoices:writers");
  assert.equal(w.verdict, "pass", w.detail);
  assert.match(w.detail, /every write \(\d+\) is by an allowed principal/);
  const cell = rec.writeMatrix.find((c) => c.zone === "topics/invoices" && c.principal === "billing-svc");
  assert.ok(cell.writes.some((x) => x.startsWith("src/kafka_ports.ts:")), "the adapter's write is billing's");
  assert.ok(!rec.writeMatrix.some((c) => c.principal === "ledger-svc" && c.writes.length), "ledger, which owns the file, is charged nothing");
});

test("a planned tool is realised through what its same-named store is reached through (or its spec's packages), not 'drifted'", () => {
  const plan = emptyPlan("Bill tenants and keep the ledger");
  plan.stack = [{ tool: "bus", role: "queue", why: "tenant events", status: "agreed" }];
  plan.stores = [{ id: "bus", label: "event bus", kind: "queue", reachedThrough: ["kafkajs"], status: "agreed" }];
  const f = reconcilePlan(plan, ts.env, ts.stack, ts.root).findings.find((x) => x.section === "stack" && x.id === "bus");
  assert.equal(f.verdict, "realised", f.detail);
  assert.match(f.detail, /reached through kafkajs .*the store bus is reached through it/);
});

test("the system map draws each zone the code writes or reads, with the processes as edges — grouped as a plan groups them", async () => {
  const { archModelForEnvelope } = await import("../src/server/arch_envelope.ts");
  const { deriveDataZones } = await import("../src/server/arch_data_zones.ts");
  const m = archModelForEnvelope(py.env, py.stack, null, py.root);
  const zones = m.nodes.filter((n) => n.id.startsWith("zone:")).map((n) => n.id);
  assert.deepEqual(zones, ["zone:boto3/curated", "zone:boto3/raw_{team}"], "the zones with an operation; reference has none and is not drawn");
  const into = m.edges.filter((e) => e.to === "zone:boto3/raw_{team}").map((e) => e.protocol).sort();
  assert.deepEqual(into, ["read", "write"]);
  const plan = emptyPlan("Keep the lake");
  plan.stores = [{ id: "lake", label: "the lake", kind: "object-store", status: "agreed", zones: [{ id: "team-data", holds: ["raw_{team}", "curated"] }] }];
  const grouped = deriveDataZones({ files: py.env.files, threads: py.env.threads, stack: py.stack, model: m, plan });
  assert.deepEqual(grouped.nodes.map((n) => [n.id, n.label]), [["zone:lake/team-data", "team-data"]], "one box per planned zone");
});
