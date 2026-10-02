// "The location split" (2026-10-02, a field report's seven modules): where data
// lives is decided at run time — a name built from configuration and a key,
// a zone looked up in a table, writers decided by a function, a client whose
// identity its configuration chooses. Every piece is in the IR; these join
// them. Fixture test/fixtures/declared/zones_ts (an orders/ledger service on
// S3), unlike the codebase that reported it.
//
//   node --experimental-strip-types --no-warnings --test test/location_split.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { deriveDataArchitecture } from "../src/server/data_arch.ts";
import { IdentityIndex } from "../src/server/identities.ts";
import { topologyFor } from "../src/server/topology_model.ts";
import { checkTopology } from "../src/server/topology_checks.ts";
import { whoMay } from "../src/shared/topology_query.ts";
import { covers, unifies, holeValues, applyTransforms, transformsOf } from "../src/shared/name_pattern.ts";
import { familyMatches } from "../src/server/call_args.ts";

const ROOT = join(import.meta.dirname, "..");
const root = join(ROOT, "test/fixtures/declared/zones_ts");
const env = buildPolyglotEnvelope(root).envelope;
const stack = buildStackIndex(env, root);
const da = deriveDataArchitecture(env.files, stack, env.threads);

test("M1: one pattern type — holes and globs unify, holes take values, transforms touch literal runs only", () => {
  assert.ok(covers("record_{Type}", "record_CandidateTarget"));
  assert.ok(covers("request_*", "request_{Role}__{Person}"), "a plan glob covers a derived pattern");
  assert.ok(unifies("/entities/{EntityID}/status", "/entities/{e}/status"), "hole names do not matter");
  assert.ok(!covers("record_{Type}", "status"));
  assert.deepEqual(holeValues("record_{Type}", "record_Approval"), { Type: "Approval" });
  assert.deepEqual(transformsOf('.replace(/_/g, "-").toLowerCase()'), ["underscore-to-dash", "lower"]);
  assert.equal(applyTransforms("{BASE=x}-request_{Role}", ["underscore-to-dash", "lower"]), "{BASE=x}-request-{Role}");
  assert.ok(familyMatches("orders_*", "orders_{id}") && familyMatches("x", "x"), "the plan's family match is the same rule");
});

test("M2: a builder fed from configuration names each zone's resource, typed hole and default", () => {
  const z = Object.fromEntries(da.topology.zones.map((x) => [x.id, x.label]));
  assert.match(z.orders, /^acme-orders \(\{BUCKET_PREFIX\}-orders, named by bucketFor at src\/store\.ts:\d+\)$/);
  assert.match(z.ledger, /^acme-ledger /);
  assert.equal(da.resourceNaming.zoneHole, "zone");
});

test("M3: the writers the code's own function decides — replaced, extended — and a key built at run time said, not read", () => {
  const writers = (zone) => da.topology.grants.filter((g) => g.zone === zone && g.access === "write").map((g) => g.who).sort();
  assert.deepEqual(writers("ledger"), ["role:billing-svc"], "out.ledger = [BILLING] replaces the catalogue's owner-of-entry");
  assert.deepEqual(writers("audit"), ["role:any-service", "role:billing-svc"], "add(\"audit\", [BILLING]) extends");
  assert.deepEqual(writers("orders"), ["role:sales"]);
  assert.ok(da.computed.some((c) => /src\/catalogue\.ts:\d+: `out\[`tenant_\$\{t\}`\]` sets writers under a key built at run time/.test(c)));
});

test("M5: a class with every required member implements the interface without saying so — reported, never walked", () => {
  const put = da.injections.find((j) => j.iface === "Bucket" && j.property === "put");
  assert.deepEqual(put.implementations.map((i) => [i.fn, i.structural]), [["MemoryBucket.put", "MemoryBucket"]]);
  assert.ok(!env.files["src/store.ts"].edges.some((e) => e.viaInjection), "no thread edge from a structural match");
  assert.ok(!da.computed.some((c) => c.startsWith("`Bucket.put`")), "no longer 'nothing implements it'");
});

test("M6: who each entry point signs in as — a documented launch, a default, or one identity per person", () => {
  const ix = new IdentityIndex(env.files, stack, root);
  const billing = ix.entryIdentities("bin/billing.ts");
  assert.deepEqual(billing.identities.map((i) => [i.id, i.env]), [["billing-svc", "CLIENT_CONFIG"]]);
  assert.match(billing.identities[0].cite, /bin\/billing\.ts:3 \(a documented launch line — a comment, not enforced\)/);
  assert.deepEqual(ix.entryIdentities("bin/report.ts").identities.map((i) => i.source), ["app.json (the default of CLIENT_CONFIG)"]);
  assert.match(ix.entryIdentities("bin/batch.ts").many[0], /person\.config \(per item of a loop/);
});

test("M7: one topology model — what the code says is checkable by a rule, with no generator registered", () => {
  const model = topologyFor(root, env, stack);
  assert.equal(model.status.at(-1).source.id, "derived-from-code");
  assert.deepEqual(whoMay(model.topology, "ledger", "write").map((x) => x.principal), ["billing-svc"]);
  assert.equal(checkTopology(model, { rule: "single-writer", zone: "ledger", writer: "billing-svc" }).verdict, "pass");
  assert.equal(checkTopology(model, { rule: "single-writer", zone: "audit", writer: "billing-svc" }).verdict, "violated");
});
