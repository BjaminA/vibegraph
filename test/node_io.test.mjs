// IN → PROCESS → OUT (2026-10-06): what reaches a box, what it does, who takes
// what it produces — zero tokens, from the facts on the map. Fixture
// test/fixtures/system/views_demo (an admin script appoints the approver, the
// decider reads it and writes the order status, the gateway reads that).
// Pinned: rows follow the DATA, not the arrow; keys come from the call the
// code spells; a store names who takes the data next; process words come
// only from the vocabulary and only with evidence; a store card speaks for
// its zones; a project may add words, never redefine one; architecture.md
// says the same thing.
//
//   npm run test:node-io
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { loadPlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { loadTopology } from "../src/server/topology_store.ts";
import { enrichReal } from "../src/webview/system/arch_real.ts";
import { nodeIO, edgeOps, mergeVocabulary, CORE_VOCABULARY } from "../src/shared/node_io.ts";
import { loadVocabulary } from "../src/server/operation_vocab.ts";

const ROOT = "test/fixtures/system/views_demo";
let real;
before(() => {
  const env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  const stack = buildStackIndex(env, ROOT);
  const derived = archModelForEnvelope(env, stack, buildCrossingIndex(env), ROOT, undefined, { applyStore: false });
  const plan = loadPlan(ROOT);
  real = enrichReal(derived, { plan, rec: reconcilePlan(plan, env, stack, ROOT), topology: loadTopology(ROOT).topology, threads: env.threads });
});
const id = (label) => real.nodes.find((n) => n.label === label).id;

test("rows follow the data: a read comes IN, a write goes OUT, with the keys the call spells and who takes it next", () => {
  const io = nodeIO(real, id("order decider"));
  const approver = io.in.find((r) => r.label === "the appointed approver");
  assert.equal(approver.op, "read");
  // the box holding the appointer also holds the topology generator: it keeps
  // its own name (2026-10-07, arch_real.ts — a plan name only on a box it IS)
  assert.deepEqual(approver.path.map((p) => `${p.label} ${p.ops}`), ["Scripts write"], "who put it there");
  const status = io.out.find((r) => r.label === "order status");
  assert.equal(status.op, "write");
  assert.deepEqual(status.keys, ["phase"]);
  assert.equal(status.keysFrom, "code");
  assert.deepEqual(status.path.map((p) => `${p.label} ${p.ops}`), ["partner gateway read"], "who takes it next");
  assert.ok(io.out.some((r) => r.label === "release" && r.op === "enforces"));
  // the zone's own view of the same edges
  const z = nodeIO(real, id("order status"));
  assert.deepEqual(z.in.map((r) => r.label), ["order decider"]);
  assert.deepEqual(z.out.map((r) => r.label), ["partner gateway"]);
});

test("process words come from the vocabulary, each with its evidence", () => {
  const words = (label) => nodeIO(real, id(label)).process.map((p) => p.word);
  assert.deepEqual(words("order decider"), ["call", "read", "write", "decide"]);
  assert.deepEqual(words("partner gateway"), ["serve", "call", "read", "write"]);
  assert.deepEqual(words("order status"), ["store"]);
  assert.deepEqual(words("fetch"), ["call"], "an HTTP client calls, by its own role");
  const serve = nodeIO(real, id("partner gateway")).process.find((p) => p.word === "serve");
  assert.match(serve.evidence[0], /\.listen\(\) in gateway\/src\/server\.ts/);
  for (const n of real.nodes) for (const p of nodeIO(real, n.id).process) {
    assert.ok(CORE_VOCABULARY.words.some((w) => w.id === p.word), p.word);
    assert.ok(p.evidence.length, `${n.label} ${p.word} has evidence`);
  }
});

test("a bare call is a request; a method on a receiver says its verb; a store card speaks for its zones", () => {
  const e = (text) => ({ id: "e", from: "a", to: "b", kind: "uses", protocol: "gRPC", protocolBasis: "", count: 1, threads: [], confidence: "called", refs: [], source: "derived", payloads: [{ side: "caller", source: "derived", text }] });
  assert.deepEqual(edgeOps(e("fetch(url, { method: \"PUT\" })")), ["call"]);
  assert.deepEqual(edgeOps(e("ydoc.getMap(MAP)")), ["read"]);
  assert.deepEqual(edgeOps(e("client.saveOrder({ id })")), ["write"]);
  assert.deepEqual(edgeOps(e("client.saveAccess({ who })")), ["grant"], "a write on an access noun is a grant (sdk_verbs)");
  assert.deepEqual(edgeOps(e("new Y.Doc({ guid: DOC })")), ["call"]);
  const store = nodeIO(real, "store:ledger");
  const into = store.in.map((r) => `${r.label} → ${r.via}`).sort();
  assert.ok(into.includes("order decider → order status · write"), into.join(" | "));
  assert.ok(store.out.some((r) => r.label === "partner gateway" && r.op === "read"));
  assert.deepEqual(store.process.map((p) => p.word), ["store"]);
});

test("a project adds words, never redefines one; the export says the same thing", () => {
  const { vocab, errors } = mergeVocabulary({ words: [
    { id: "ledger-io", label: "talks to the ledger", definition: "reads or writes the order ledger over HTTP", evidence: { uses: ["fetch"] } },
    { id: "read", label: "reads", definition: "x", evidence: { facts: ["zone:read"] } },
    { id: "Bad Id", label: "x", definition: "x", evidence: { facts: ["serves"] } },
    { id: "empty", label: "x", definition: "x", evidence: {} },
  ] });
  assert.equal(errors.length, 3, errors.join("\n"));
  assert.match(errors.join("\n"), /"read": already a word/);
  const p = nodeIO(real, id("order decider"), vocab).process.find((x) => x.word === "ledger-io");
  assert.ok(p?.project);
  assert.deepEqual(p.evidence, ["calls fetch (fetch)"]);
  // .vibegraph/operations.json → architecture.md
  const tmp = mkdtempSync(join(tmpdir(), "vg-io-"));
  try {
    cpSync(ROOT, join(tmp, "p"), { recursive: true });
    writeFileSync(join(tmp, "p", ".vibegraph", "operations.json"), JSON.stringify({ words: [{ id: "ledger-io", label: "talks to the ledger", definition: "d", evidence: { uses: ["fetch"] } }] }));
    assert.equal(loadVocabulary(join(tmp, "p")).errors.length, 0);
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", "export", join(tmp, "p")], { encoding: "utf-8" });
    assert.equal(r.status, 0, r.stderr);
    const md = readFileSync(join(tmp, "p", ".vibegraph", "knowledge", "architecture.md"), "utf-8");
    assert.match(md, /## What each box does \(in → process → out\)/);
    assert.match(md, /talks to the ledger/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("edge chips: the operation first, then the keys, in the room the router reserved; what does not fit is +N", async () => {
  const { chipsFor } = await import("../src/webview/system/edgeChips.ts");
  const e = { id: "e", from: "a", to: "b", kind: "uses", protocol: "gRPC", protocolBasis: "", count: 1, threads: [], confidence: "called", refs: [], source: "derived",
    payloads: [{ side: "caller", source: "derived", text: "client.saveOrder({ id, total, lines, region })", keys: ["id", "total", "lines", "region"] }] };
  const m = { nodes: [], edges: [e], groups: [] };
  assert.deepEqual(chipsFor(e, m, "gRPC", 400).map((c) => c.text), ["write", "id", "total", "lines", "region", "gRPC"]);
  const narrow = chipsFor(e, m, "gRPC", 110).map((c) => c.text);
  assert.equal(narrow[0], "write");
  assert.match(narrow.at(-1), /^\+\d+$/);
  // a payload-summary label is not repeated as a chip; a plain call with no keys keeps its text label
  assert.ok(!chipsFor(e, m, "{ id, total } +2", 400).some((c) => c.kind === "proto"));
  assert.equal(chipsFor({ ...e, payloads: [{ side: "caller", source: "derived", text: "fetch(url)" }] }, m, "HTTP", 400), null);
});
