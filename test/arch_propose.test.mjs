// M-ARCH.4 (PLAN-M-ARCH.md) — the stated and proposed strata.
//
// The deployment facts are read line by line and cite their line; a model's
// proposal is grounded against exactly what it was shown (a citation it was
// not shown is dropped, an item left with none is INFERRED, a wrap naming a
// node that does not exist is refused — a model may not add nodes); only a
// human's ratify makes a proposal stated. Nothing here spawns a model: the
// reply comes from the same stub the e2e uses.
//
//   npm run test:arch-propose
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { readInfraManifests } from "../src/server/infra_manifests.ts";
import { buildProposePrompt, docExcerpts, parseProposal } from "../src/server/arch_propose.ts";
import { applyArchStore, emptyStore, loadArchStore, saveArchStore, ratifyProposal, rejectProposal } from "../src/server/arch_store.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NEXT = join(ROOT, "test/fixtures/webstack/next_demo");
const STUB = join(ROOT, "test/fixtures/arch/fake_claude_arch.mjs");
let derived, facts, docs, prompt, reply, parsed;

before(() => {
  const env = buildPolyglotEnvelope(NEXT).envelope;
  derived = archModelForEnvelope(env, buildStackIndex(env, NEXT), buildCrossingIndex(env), NEXT, undefined, { applyStore: false });
  facts = readInfraManifests(NEXT).facts;
  docs = docExcerpts(NEXT, derived);
  prompt = buildProposePrompt(derived, facts, docs);
  reply = JSON.parse(execFileSync("node", [STUB, prompt], { encoding: "utf-8" })).result;
  parsed = parseProposal(reply, derived, facts, docs, { model: "stub", now: () => new Date("2026-09-23T00:00:00Z") });
});

const fact = (file, kind, name) => facts.find((f) => f.file === file && f.kind === kind && f.name === name);

test("deployment facts are read line by line, each citing its line", () => {
  assert.deepEqual(fact("docker-compose.yml", "service", "web"), { file: "docker-compose.yml", line: 2, kind: "service", name: "web" });
  assert.equal(fact("docker-compose.yml", "port", "web").detail, "3000:3000");
  assert.equal(fact("docker-compose.yml", "network", "db").line, 13);
  assert.equal(fact("docker-compose.yml", "depends_on", "web").detail, "db");
  assert.equal(fact("docker-compose.yml", "image", "db").detail, "postgres:16");
  assert.equal(fact("Dockerfile", "base-image", "Dockerfile").detail, "node:22-alpine");
  assert.equal(fact("Dockerfile", "expose", "Dockerfile").detail, "3000");
  // .env.example: address-like values kept; a secret-shaped key is not a location and is never read.
  assert.equal(fact(".env.example", "env", "DATABASE_URL").detail, "postgres://localhost:5432/orders");
  assert.equal(fact(".env.example", "env", "VOLT_RELAY_URL").line, 3);
  assert.equal(facts.find((f) => f.name === "OPENAI_API_KEY"), undefined);
});

test(".env itself is never read, only its committed example", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-infra-"));
  try {
    writeFileSync(join(tmp, ".env"), "DATABASE_URL=postgres://prod-secret-host:5432/db\n");
    writeFileSync(join(tmp, ".env.example"), "DATABASE_URL=postgres://localhost:5432/db\n");
    const r = readInfraManifests(tmp);
    assert.deepEqual(r.files, [".env.example"]);
    assert.ok(!JSON.stringify(r.facts).includes("prod-secret-host"));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("the prompt shows nodes, edges, facts and doc lines — and asks for no positions, protocols or payloads", () => {
  for (const n of derived.nodes) assert.ok(prompt.includes(`- ${n.id}:`), n.id);
  assert.ok(prompt.includes("- docker-compose.yml:2: service web"));
  assert.ok(prompt.includes("may not describe protocols or payloads"));
  assert.ok(!/\b(x|y|position)"\s*:/.test(prompt.split("Reply with JSON only:")[1]), "the reply shape has no position field");
});

test("grounding: shown citations kept, invented ones dropped, uncited items INFERRED, invented nodes refused", () => {
  const p = parsed.proposal;
  assert.ok(p, parsed.error);
  const g = Object.fromEntries(p.groups.map((x) => [x.id, x]));
  assert.deepEqual(g["g-public"].evidence, ["docker-compose.yml:2", "docker-compose.yml:7"]);
  assert.deepEqual(g["g-private"].evidence, ["docker-compose.yml:13"], "the k8s line it was never shown is dropped");
  assert.deepEqual(g["g-volt"].evidence, [], "a circular citation is dropped; no evidence left = INFERRED, kept and ghosted");
  assert.equal(g["g-invented"], undefined, "a group wrapping only a node that does not exist is refused");
  const reasons = p.refused.map((r) => `${r.item}: ${r.reason}`).join("\n");
  assert.match(reasons, /group g-invented: wraps id\(s\) the model was not shown — a model may not add nodes: cluster:ghost:\./);
  assert.match(reasons, /group g-private: citation\(s\) not among what was shown, dropped: k8s\/db\.yaml:9/);
  assert.match(reasons, /name cluster:nowhere:\.: names a node the model was not shown/);
  assert.match(reasons, /group g-volt: circular citation\(s\) — the thing described is not evidence about itself, dropped: cluster:scripts:\./);
  assert.equal(p.names["cluster:scripts:."].label, "Volt host scripts");
  assert.deepEqual(p.primaryPath.entryPoints, ["app/dashboard/page.tsx:DashboardPage"]);
  assert.equal(p.model, "stub");
});

test("a reply with no JSON is an error, never an empty proposal; an unknown kind is refused", () => {
  assert.equal(parseProposal("I think it runs on a server.", derived, facts, docs, { model: "x" }).proposal, null);
  const r = parseProposal(JSON.stringify({ groups: [{ id: "g1", kind: "planet", label: "Earth", wraps: ["cluster:web:."] }] }), derived, facts, docs, { model: "x" });
  assert.equal(r.proposal.groups.length, 0);
  assert.match(r.proposal.refused[0].reason, /kind "planet"/);
});

test("the applied model keeps every element's source, and still validates", () => {
  const store = { ...emptyStore(), proposal: parsed.proposal };
  const m = applyArchStore(derived, store);
  assert.ok(m.groups.every((x) => x.source === "proposed"));
  assert.deepEqual(m.groups.map((x) => x.id).sort(), ["g-private", "g-public", "g-volt"]);
  const scripts = m.nodes.find((n) => n.id === "cluster:scripts:.");
  assert.equal(scripts.label, "Volt host scripts");
  assert.equal(scripts.labelSource, "proposed");
  assert.equal(scripts.derivedLabel, derived.nodes.find((n) => n.id === "cluster:scripts:.").label);
  assert.equal(m.primaryPath.source, "proposed");
  assert.equal(m.proposal.model, "stub");
  // The model never adds a node or an edge.
  assert.equal(m.nodes.length, derived.nodes.length);
  assert.equal(m.edges.length, derived.edges.length);
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas/arch_model.schema.json"), "utf-8"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.ok(validate(m), JSON.stringify(validate.errors?.slice(0, 3)));
});

test("ratify makes the proposal stated (evidence kept as a note); reject drops it; a stale wrap is dropped", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-arch-store-"));
  try {
    saveArchStore(tmp, { ...emptyStore(), proposal: parsed.proposal });
    const loaded = loadArchStore(tmp);
    assert.equal(loaded.proposal.groups.length, 3, "a saved proposal round-trips");
    const ratified = ratifyProposal(loaded);
    assert.equal(ratified.proposal, undefined);
    assert.equal(ratified.names["cluster:scripts:."], "Volt host scripts");
    assert.deepEqual(ratified.primaryPath, ["app/dashboard/page.tsx:DashboardPage"]);
    assert.match(ratified.groups.find((g) => g.id === "g-volt").note, /INFERRED — no evidence cited/);
    assert.match(ratified.groups.find((g) => g.id === "g-public").note, /evidence: docker-compose\.yml:2/);
    const m = applyArchStore(derived, ratified);
    assert.ok(m.groups.every((g) => g.source === "stated"));
    assert.equal(m.nodes.find((n) => n.id === "cluster:scripts:.").labelSource, "stated");
    assert.equal(m.proposal, undefined);
    assert.equal(rejectProposal(loaded).proposal, undefined);
    assert.equal(applyArchStore(derived, rejectProposal(loaded)).groups.length, 0);
    // A stated group whose members left the code is dropped, not drawn empty.
    const stale = { ...emptyStore(), groups: [{ id: "g-old", kind: "host", label: "old box", wraps: ["cluster:gone:."] }] };
    assert.equal(applyArchStore(derived, stale).groups.length, 0);
    // A mangled file loads as empty, never half-loaded.
    writeFileSync(join(tmp, ".vibegraph", "architecture.json"), "{ not json");
    assert.deepEqual(loadArchStore(tmp), emptyStore());
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("the envelope path applies the stated file when one exists", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-arch-env-"));
  try {
    cpSync(NEXT, tmp, { recursive: true });
    saveArchStore(tmp, { ...emptyStore(), names: { "cluster:web:.": "Operator console" } });
    const env = buildPolyglotEnvelope(tmp).envelope;
    const m = archModelForEnvelope(env, buildStackIndex(env, tmp), buildCrossingIndex(env), tmp);
    const web = m.nodes.find((n) => n.id === "cluster:web:.");
    assert.equal(web.label, "Operator console");
    assert.equal(web.labelSource, "stated");
    assert.equal(web.derivedLabel, "Next.js app");
    assert.ok(existsSync(join(tmp, ".vibegraph", "architecture.json")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("a proposed label is bounded at a word, with an ellipsis, never cut mid-word", async () => {
  const { boundLabel, LABEL_MAX } = await import("../src/server/arch_propose.ts");
  assert.equal(boundLabel("  pm2 app host  "), "pm2 app host");
  const long = "Offline scraping / ingest tooling (ingest, classification, discovery and the nightly a public registry pull)";
  const b = boundLabel(long);
  assert.ok(b.length <= LABEL_MAX, b);
  assert.ok(b.endsWith("…"), b);
  assert.ok(long.startsWith(b.slice(0, -1)), "a prefix of the words, not a rewrite");
  assert.equal(long.charAt(b.length - 1), " ", `cut at a word boundary: ${b}`);
});

test("a statement about a box the code no longer yields is SAID in the notes, not dropped in silence", () => {
  const derived = { version: "1", nodes: [{ id: "cluster:a:.", kind: "cluster", label: "A", sublabel: "", category: "backend", source: "derived", threads: [], refs: [] }], edges: [], groups: [], unplaced: { tests: 0, unmatchedHops: 0, toolsPresentNotCalled: [], unattributedBoundaries: 0 }, notes: [] };
  const m = applyArchStore(derived, { ...emptyStore(),
    groups: [
      { id: "g1", kind: "host", label: "partly gone", wraps: ["cluster:a:.", "tool:gone"] },
      { id: "g2", kind: "zone", label: "all gone", wraps: ["tool:x", "tool:y"] },
    ],
    names: { "tool:vanished": "Vanished DB" },
  });
  assert.deepEqual(m.groups.map((g) => g.id), ["g1"]);
  assert.ok(m.notes.some((n) => n.includes('"partly gone"') && n.includes("tool:gone") && n.includes("drawn without it")));
  assert.ok(m.notes.some((n) => n.includes('"all gone"') && n.includes("is not drawn")));
  assert.ok(m.notes.some((n) => n.includes('"Vanished DB"') && n.includes("tool:vanished")));
});
