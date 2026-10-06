// STORE PATHS BUILT AT RUN TIME (2026-10-06, direction review M6). On the
// reviewed project three processes' data operations were invisible: a
// gateway read every entity part through `entityPath(id, part)` inside
// `for (const [key, part] of PARTS)`, from a private method; its request
// writes ran in an object implementing a port, assigned after a typed
// declaration; and a viewer watched a list the deployment hands it at run
// time. Fixture test/fixtures/system/paths_demo. Pinned: a hole filled by a
// loop over a literal table is each of its values; `this.#m()` links (a
// private method cannot be overridden); a plain function around a parameter
// (`/labels/${docIdFor(p)}`) is still that parameter's hole; `x = { … }`
// after `let x: Port` implements the port; and what no rule reaches the
// project may STATE in .vibegraph/operations.json — a helper's family, or the
// operation at a line — labelled stated, never derived, an unknown family
// reported and not drawn.
//
//   npm run test:store-paths
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { deriveDataArchitecture } from "../src/server/data_arch.ts";
import { registeredAccess, parseRegisteredAccess } from "../src/server/registered_access.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";

const ROOT = "test/fixtures/system/paths_demo";
let env, stack, da, bare;
before(() => {
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  stack = buildStackIndex(env, ROOT);
  da = deriveDataArchitecture(env.files, stack, env.threads, registeredAccess(ROOT));
  bare = deriveDataArchitecture(env.files, stack, env.threads);
});
const opsOf = (arch, entry) => [...new Set(arch.operations.filter((o) => o.entries.includes(entry)).map((o) => `${o.op} ${o.family}`))].sort();

test("a loop over a literal table names each part; a private method and a wrapped hole are followed", () => {
  const reads = da.operations.filter((o) => o.file === "src/reader.ts" && o.op === "read");
  assert.deepEqual([...new Set(reads.map((o) => o.family))].sort(), ["core", "label", "notes", "tags"]);
  assert.ok(reads.every((o) => o.entries.includes("bin/api.ts")), "reached through this.#parts from the API");
  const linked = env.files["src/reader.ts"].edges.some((e) => e.type === "reference" && e.target === "module/Reader.class/parts.fn");
  assert.ok(linked, "this.#parts() links to the class's own private method");
  assert.deepEqual(env.files["src/paths.ts"].nodes.find((n) => n.name === "labelPath").returnsPattern.pattern, "/labels/{doc}");
});

test("an object assigned after a typed declaration implements the port", () => {
  const j = da.injections.find((x) => x.iface === "Ops" && x.property === "save");
  assert.ok(j.implementations.some((i) => i.file === "bin/api.ts" && !i.test));
  assert.ok(opsOf(da, "bin/api.ts").includes("write notes"), "the API's port save writes notes");
});

test("what no rule reaches is STATED in operations.json, labelled, never derived", () => {
  assert.deepEqual(opsOf(da, "bin/tagger.ts"), ["write tags"]);
  assert.deepEqual(opsOf(da, "bin/watcher.ts"), ["watch notes", "watch status"]);
  assert.ok(da.operations.filter((o) => o.file.startsWith("bin/tagger") || o.file.startsWith("bin/watcher")).every((o) => o.stated), "each carries its reason");
  assert.deepEqual(opsOf(bare, "bin/tagger.ts"), [], "without the registration nothing is guessed");
  assert.deepEqual(opsOf(bare, "bin/watcher.ts"), []);
  assert.ok(da.computed.some((c) => c.includes("nonesuch") && c.includes("not drawn")));
});

test("a malformed registration is refused with its reason", () => {
  const r = parseRegisteredAccess({ paths: { "not a name": "x", ok: ["tags"] }, access: [{ at: "../x.ts:3", op: "watch", families: ["a"], why: "w" }, { at: "a.ts:1", op: "delete", families: ["a"], why: "w" }] });
  assert.deepEqual(Object.keys(r.paths), ["ok"]);
  assert.equal(r.access.length, 0);
  assert.equal(r.refused.length, 3);
});

test("the map's zone edges say a stated operation is stated", () => {
  const model = archModelForEnvelope(env, stack, buildCrossingIndex(env), ROOT, undefined, { applyStore: false });
  const refs = model.edges.filter((e) => e.to?.startsWith("zone:")).flatMap((e) => e.evidence ?? e.refs ?? []).map((r) => r.text ?? "");
  assert.ok(refs.some((t) => /watch status .*STATED in \.vibegraph\/operations\.json/.test(t)), refs.join("\n"));
  assert.ok(refs.some((t) => /^read core/.test(t) && !t.includes("STATED")));
});
