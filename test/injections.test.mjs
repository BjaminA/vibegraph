// Injected capabilities (2026-10-02, module 4): a call through a parameter
// typed by an interface reaches the objects that implement it — an object
// literal a factory returns, a typed constant, a class naming it as a base —
// test fakes counted apart, an interface nothing implements said as such. In
// TS the linker adds the edges, so a thread walks into the implementation.
//
//   node --experimental-strip-types --no-warnings --test test/injections.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { injectionsOf } from "../src/server/injections.ts";

const ROOT = join(import.meta.dirname, "..");
const ts = buildPolyglotEnvelope(join(ROOT, "test/fixtures/declared/broker_ts")).envelope;
const py = buildPolyglotEnvelope(join(ROOT, "test/fixtures/declared/store_py")).envelope;
const find = (inj, iface, prop) => inj.injections.find((j) => j.iface === iface && j.property === prop);

test("TS: a port's member reaches the factory's object literal; the test fake is counted, not linked", () => {
  const inj = injectionsOf(ts.files);
  const pub = find(inj, "BillingPorts", "publishInvoice");
  assert.deepEqual(pub.calls.map((c) => `${c.file}:${c.line}`), ["src/billing.ts:7"]);
  const prod = pub.implementations.filter((i) => !i.test);
  assert.deepEqual(prod.map((i) => `${i.file} ${i.fn}`), ["src/kafka_ports.ts kafkaPorts/publishInvoice"]);
  assert.equal(pub.implementations.filter((i) => i.test).length, 1, "the fake in test/");
  assert.ok(find(inj, "BillingPorts", "audit"), "an optional member called as ports.audit?.(…)");
});

test("TS: the linker's edge makes the billing thread walk into the broker adapter and its send", () => {
  const edge = ts.files["src/billing.ts"].edges.find((e) => e.viaInjection === "BillingPorts" && e.targetFile === "src/kafka_ports.ts");
  assert.ok(edge, "a viaInjection reference edge");
  assert.ok(!ts.files["src/billing.ts"].edges.some((e) => e.viaInjection && e.targetFile.startsWith("test/")), "fakes are never linked");
  const thread = ts.threads.find((t) => t.entryPointId.startsWith("bin/billing.ts"));
  assert.ok(thread.nodes.some((n) => n.file === "src/kafka_ports.ts"), "the thread reaches the implementation");
});

test("Python: a Protocol's methods reach the class based on it; a fake in tests/ is counted apart", () => {
  const inj = injectionsOf(py.files);
  const save = find(inj, "CatalogRepo", "save");
  assert.deepEqual(save.implementations.filter((i) => !i.test).map((i) => `${i.file} ${i.fn}`), ["catalog_s3.py S3CatalogRepo.save"]);
  assert.equal(save.implementations.filter((i) => i.test).length, 1);
});

test("an interface nothing implements is said, not linked", () => {
  const t = injectionsOf(ts.files);
  assert.match(t.unresolved.join("\n"), /`PricingPort\.priceFor` is called at src\/billing\.ts:\d+ and nothing in the project implements it/);
  const p = injectionsOf(py.files);
  assert.match(p.unresolved.join("\n"), /`AuditSink\.record` is called at catalog\.py:\d+ and nothing in the project implements it/);
});
