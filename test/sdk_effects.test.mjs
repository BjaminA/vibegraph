// SDK effect attribution (2026-10-02, module 3): a method call on an object
// that comes from a tool is that tool's call, and its verb says what it does —
// through typed parameters, factories, calls on other such objects, and calls
// nested in arguments. A receiver that cannot be tied is said, not guessed.
//
//   node --experimental-strip-types --no-warnings --test test/sdk_effects.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { scanSdkCalls } from "../src/server/sdk_effects.ts";
import { effectOf } from "../src/shared/sdk_verbs.ts";

const ROOT = join(import.meta.dirname, "..");
function scan(dir) {
  const root = join(ROOT, dir);
  const env = buildPolyglotEnvelope(root).envelope;
  return scanSdkCalls(env.files, buildStackIndex(env, root));
}
const at = (s, file, callee) => s.calls.filter((c) => c.file === file && c.callee === callee);

test("the verb taxonomy: reads, writes, admin, watches, and the noun or payload that makes a grant", () => {
  assert.equal(effectOf("SaveResource"), "write");
  assert.equal(effectOf("GetAccess"), "read");
  assert.equal(effectOf("WatchDocumentPath"), "watch");
  assert.equal(effectOf("put_object"), "write");
  assert.equal(effectOf("SaveAccess"), "grant");
  assert.equal(effectOf("put_bucket_policy"), "grant");
  assert.equal(effectOf("createAcls"), "grant");
  assert.equal(effectOf("createTopics"), "admin");
  assert.equal(effectOf("update", ["principal", "role", "resource"]), "grant", "grant-shaped keys");
  assert.equal(effectOf("CanAccessResource"), "read", "a read on an access noun is still a read");
  assert.equal(effectOf("run"), "call");
});

test("TS on a broker: a typed parameter, a factory call on it, module-level clients — each call with its tool and effect", () => {
  const s = scan("test/fixtures/declared/broker_ts");
  const send = at(s, "src/kafka_ports.ts", "producer.send");
  assert.equal(send.length, 2);
  assert.equal(send[0].tool, "kafkajs");
  assert.equal(send[0].effect, "write");
  assert.match(send[0].how, /producer = kafka\.producer/);
  assert.deepEqual(send[0].keys, ["topic", "messages"], "payload keys, never values");
  assert.equal(at(s, "bin/ledger.ts", "consumer.subscribe")[0].effect, "watch");
  assert.equal(at(s, "bin/provision.ts", "admin.createAcls")[0].effect, "grant");
  assert.equal(at(s, "bin/provision.ts", "admin.createTopics")[0].effect, "admin");
  assert.ok(!s.calls.some((c) => c.callee === "Kafka"), "a constructor makes the object; it is not a call on it");
});

test("Python on an object store: a client from a factory, its reads, writes and grant", () => {
  const s = scan("test/fixtures/declared/store_py");
  assert.equal(at(s, "ingest.py", "s3.put_object").length, 2);
  assert.equal(at(s, "ingest.py", "s3.put_object")[0].tool, "boto3");
  assert.equal(at(s, "analytics.py", "s3.get_object")[0].effect, "read");
  assert.equal(at(s, "policy.py", "s3.put_bucket_policy")[0].effect, "grant");
  assert.ok(at(s, "ingest.py", "s3.put_object")[0].keys.includes("Key"));
});

test("a receiver nothing ties to a tool is not attributed — and is listed when it looks like an effect", () => {
  const s = scan("test/fixtures/declared/broker_ts");
  // billing.ts calls ports.publishInvoice: an interface, not a tool (module 4's business)
  assert.ok(!s.calls.some((c) => c.file === "src/billing.ts"));
  assert.ok(!s.untied.some((u) => u.startsWith("src/billing.ts")), "billing.ts imports no I/O tool");
});
