// FIELD REVIEW of the Decisions and Resources lenses (2026-10-12, a report on
// a shared-store project: a phantom reader named after a list, the tree drawn
// twice, gate cards showing only their question, flat zone and grant lists,
// feeds that vanished without a word, a brief that never said what is decided).
// Pinned here, one behaviour each:
//   - a list built from other lists is expanded; an unresolved reference is
//     never a name (a guard function reference still is);
//   - a project's declared grants replace the derived ones; a derived tree
//     with the declared tree's gates is drawn once;
//   - a feed may cite a whole file; every feed's fate is said;
//   - zones group by family pattern, then prefix; the access grid reads grants;
//   - gate cards carry who decides, on what, what follows, where recorded; the
//     tree is laid out from its root;
//   - the brief facts count what is decided and name where it is applied.
//
//   npm run test:topology-review
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listResolver } from "../src/server/data_arch.ts";
import { asNames } from "../src/server/decision_tables.ts";
import { loadTopology, validateTopology } from "../src/server/topology_store.ts";
import { feedFates } from "../src/server/topology_feeds.ts";
import { zoneGroupsOf, accessGrid } from "../src/shared/topology_groups.ts";
import { decisionsModel, decisionPositions, dnId } from "../src/webview/system/arch_topology.ts";
import { buildBriefFacts } from "../src/server/brief_facts.ts";

const tmp = mkdtempSync(join(tmpdir(), "vg-topo-review-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const list = (file, name, values) => ({ file, name, line: 1, table: { shape: "list", values } });

test("a list built from other lists is expanded; one unknown part makes the whole list unknown", () => {
  const lists = listResolver([
    list("roles.ts", "BOARDS", ["board-a", "board-b"]),
    list("roles.ts", "ALL", [{ spread: "BOARDS" }, "ops"]),
    list("roles.ts", "BROKEN", [{ spread: "NOWHERE" }, "ops"]),
  ]);
  assert.deepEqual(lists("roles.ts", "ALL"), ["board-a", "board-b", "ops"]);
  assert.equal(lists("roles.ts", "BROKEN"), null, "a partial list is never read as complete");
  // a reference to a list that cannot be resolved is NOT a role called FOLDER
  assert.deepEqual(asNames({ ref: "FOLDER" }, () => null), []);
  assert.deepEqual(asNames([{ ref: "ALL" }, "extra"], (r) => lists("roles.ts", r)), ["board-a", "board-b", "ops", "extra"]);
  // a guard is a function named by its reference
  assert.deepEqual(asNames({ ref: "hasLines" }, (r) => [r]), ["hasLines"]);
});

const declared = {
  version: "1",
  stores: [{ id: "store" }],
  zones: [{ id: "record_A", store: "store" }, { id: "record_B", store: "store" }, { id: "record_C", store: "store" }, { id: "status", store: "store" }],
  families: [{ id: "records", pattern: "record_{Type}" }],
  principals: [{ id: "assessor", roles: ["reviewer"] }, { id: "gateway" }],
  grants: [{ who: "role:reviewer", zone: "record_A", access: "write" }, { who: "gateway", zone: "record_B", access: "read" }, { who: "gateway", zone: "status", access: "write" }],
  decisionTrees: [{ id: "release", root: "q1", nodes: [
    { id: "q1", question: "Is the target confirmed?", kind: "judgement", answeredBy: "assessor", evaluatedBy: "checkTarget", reads: ["zone:record_A"], evidence: ["confidence"], yes: "q2", no: "hold", records: "record_A" },
    { id: "q2", question: "Is the status current?", kind: "check", reads: ["zone:status"], yes: "go", no: "hold" },
    { id: "go", outcome: "release" }, { id: "hold", outcome: "hold" },
  ] }],
  feeds: [{ process: "watcher", watches: "records", cite: "src/watch.ts" }],
};

function rootWith(topology) {
  const root = mkdtempSync(join(tmp, "p-"));
  mkdirSync(join(root, ".vibegraph/topology"), { recursive: true });
  writeFileSync(join(root, "in.json"), "{}");
  writeFileSync(join(root, ".vibegraph/topology/sources.json"), JSON.stringify({ version: "1", sources: [{ id: "gen", generator: "true", inputs: ["in.json"] }] }));
  writeFileSync(join(root, ".vibegraph/topology/gen.json"), JSON.stringify({ generatedAt: "2026-10-12T00:00:00Z", inputsHash: "x", topology }));
  return root;
}

test("declared grants replace the derived ones; the derived twin of a declared tree is drawn once", () => {
  assert.equal(validateTopology(declared), null, "a feed citing a whole file is valid");
  assert.match(validateTopology({ ...declared, zones: [{ id: "z", store: "store", cite: "src/x.ts" }] }) ?? "", /cite must be file:line/, "only a feed may cite a whole file");
  const derived = {
    version: "1",
    grants: [{ who: "FOLDER", zone: "record_A", access: "read" }],
    decisionTrees: [{ id: "RELEASE_TREE", root: "q1", nodes: [{ id: "q1", yes: "q2", no: "hold" }, { id: "q2", yes: "go", no: "hold" }, { id: "go", outcome: "release" }, { id: "hold", outcome: "hold" }] }],
  };
  const m = loadTopology(rootWith(declared), derived);
  assert.deepEqual(m.topology.grants.map((g) => g.who), ["role:reviewer", "gateway", "gateway"], "no phantom reader from the code's reading");
  assert.deepEqual(m.topology.decisionTrees.map((d) => d.id), ["release"]);
  assert.equal(m.topology.decisionTrees[0].alsoDerived, "RELEASE_TREE");
  // with no declared grants, the derived ones are still read
  const bare = loadTopology(rootWith({ version: "1", zones: [{ id: "record_A", store: "s" }], stores: [{ id: "s" }] }), derived);
  assert.deepEqual(bare.topology.grants.map((g) => g.who), ["FOLDER"]);
});

test("every declared feed's fate is said", () => {
  const model = { version: "1", groups: [], unplaced: [], notes: [], nodes: [
    { id: "box:w", kind: "process", label: "watcher", refs: [] },
    { id: "zone:store/record_A", kind: "store", label: "record_A", refs: [], zoneOf: { store: "store", holds: ["records"] } },
  ], edges: [{ id: "e1", from: "box:w", to: "zone:store/record_A", kind: "uses", protocol: "watch", refs: [] }] };
  const f = (o) => ({ index: 0, process: "watcher", boxes: ["box:w"], op: "watch", family: "records", via: [], cite: "src/watch.ts", ...o });
  const [shown, nobox, nozone, stale] = feedFates([f({}), f({ index: 1, boxes: [] }), f({ index: 2, family: "nothing" }), f({ index: 3, stale: "it names gone, which the code no longer defines" })], model);
  assert.match(shown, /already shown by the code \(1 edge\)/);
  assert.match(nobox, /no box on the map for watcher — anchor it/);
  assert.match(nozone, /no zone holds nothing/);
  assert.match(stale, /STALE — it names gone/);
});

test("zones group by family pattern, then by prefix; the grid reads each grant through roles", () => {
  const t = { ...declared, zones: [...declared.zones, { id: "req_x", store: "store" }, { id: "req_y", store: "store" }, { id: "req_z", store: "store" }] };
  assert.deepEqual(zoneGroupsOf(t).map((g) => [g.id, g.zones.length]), [["record_{Type}", 3], ["req_*", 3]]);
  const g = accessGrid(t);
  assert.deepEqual(g.principals, ["assessor", "gateway"], "the role reviewer is expanded to the principal holding it");
  assert.equal(g.cell("assessor", "record_A"), "W");
  assert.equal(g.cell("gateway", "record_B"), "R");
  assert.equal(g.cell("gateway", "record_A"), "");
});

test("a gate card says who decides, on what, what follows and where it is recorded; the tree is laid out from its root", () => {
  const model = decisionsModel({ topology: declared, status: [], conflicts: [] });
  const q1 = model.nodes.find((n) => n.id === dnId("release", "q1"));
  const rows = q1.notes ?? q1.details ?? [];
  const text = JSON.stringify(q1);
  for (const want of ["Is the target confirmed?", "a person's judgement · answered by assessor", "evaluated by checkTarget", "reads zone record_A — written by assessor", "evidence fields: confidence", "yes → q2", "no → hold (→ hold)", "recorded in record_A"]) assert.ok(text.includes(want), `${want} on the gate card (${JSON.stringify(rows)})`);
  assert.ok(model.edges.every((e) => !/shape not spelled/.test(e.payloadSummary ?? "")), "every decision edge says what it is");
  const pack = decisionPositions(model)(model.nodes);
  const pos = (id) => pack.pos.get(id);
  const root = pos(dnId("release", "q1")), next = pos(dnId("release", "q2")), leaf = pos(dnId("release", "go"));
  assert.ok(root.x < next.x && next.x < leaf.x, "depth runs to the right, from the root");
});

test("the brief facts count what is decided and name the function applying it", () => {
  const model = { version: "1", nodes: [], edges: [], groups: [], unplaced: [], notes: [] };
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
  const f = buildBriefFacts(model, {
    root: tmp, readLines: () => lines, topology: declared,
    source: { files: { "src/gate.ts": { nodes: [{ type: "function_def", name: "checkTarget", line: 12 }] } }, threads: [] },
  });
  assert.match(f.text, /topology:dt:release:shape[^\n]*2 gates \(1 a person's judgement, 1 checks on recorded evidence\); outcomes release, hold; answered by assessor/);
  assert.match(f.text, /src\/gate\.ts:12[^\n]*\[enforce\]: function checkTarget — evaluates gate q1 of release/);
});
