// FIELD REVIEW, the follow-up (2026-10-12): what still ignored the agreed plan
// or said less than the project had declared. Pinned, one behaviour each:
//   - a derived box the agreed plan divides gives each process its own box;
//     only the entry points a process LISTS move (its `at` locates, never
//     moves); one the code spread over several boxes is drawn as one; a box
//     the plan does not divide keeps its id; a proposed process moves nothing;
//   - drift counts a new entry point, and a plan box in no group is substantial;
//   - a derived state machine with the declared one's transitions is drawn once;
//   - with groups settled, a pending groups proposal no longer stops the brief,
//     and a full draft keeps the pending groups;
//   - a ratified spec's operations, where the code calls them, are [use] facts;
//   - a TS field or parameter property with a `new K()` default is typed K;
//   - a wall of write grants is said on the cards.
//
//   npm run test:plan-boxes
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArchModel } from "../src/server/arch_model.ts";
import { planOwnerOf } from "../src/server/arch_plan_split.ts";
import { archBaseline, archDrift } from "../src/server/arch_drift.ts";
import { loadTopology } from "../src/server/topology_store.ts";
import { groupsStep } from "../src/server/brief_groups_first.ts";
import { proposeBrief } from "../src/server/brief_store.ts";
import { buildBriefFacts } from "../src/server/brief_facts.ts";
import { resourcesModel } from "../src/webview/system/arch_topology.ts";
import { GRANT_EDGE_CAP } from "../src/shared/topology_groups.ts";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const tmp = mkdtempSync(join(tmpdir(), "vg-plan-boxes-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const ep = (file, extra = {}) => ({ id: `${file}:main`, file, kind: "cli", framework: "shell", label: file, irNodeId: "module/main.fn", ...extra });
const ENTRIES = [ep("bin/provision.sh"), ep("bin/probe-a.sh"), ep("bin/probe-b.sh"), ep("bin/spawn.sh"), ep("bin/revoke.sh"), ep("bin/exchange.sh")];
const FILES = ENTRIES.map((e) => e.file);
const plan = (processes) => ({ version: "1", revision: 3, objective: "x", processes, stack: [], boundaries: [], threads: [], policies: [], questions: [], changelog: [] });
const model = (p) => buildArchModel({
  entryPoints: ENTRIES, threads: [], stack: null, crossings: null, contractFor: () => null, fileOfNode: () => null, languageOf: () => "bash",
  planOwner: planOwnerOf(p, FILES, ENTRIES),
});
const boxes = (m) => Object.fromEntries(m.nodes.filter((n) => n.kind === "cluster").map((n) => [n.id, n.entryPoints.map((e) => e.split("/").pop().replace(/\.sh:main$/, "")).sort()]));

test("the agreed plan divides a shared box; only what it states moves an entry", () => {
  assert.deepEqual(boxes(model(null)), { "cluster:scripts:.": ["exchange", "probe-a", "probe-b", "provision", "revoke", "spawn"] });
  const p = plan([
    { id: "provisioning", kind: "service", label: "provisioning", serves: "x", at: "bin", entryPoints: ["bin/provision.sh"], status: "agreed" },
    { id: "spawner", kind: "service", label: "admin spawner", serves: "x", entryPoints: ["bin/spawn.sh", "bin/revoke.sh"], status: "agreed" },
    { id: "exchange", kind: "service", label: "partner exchange", serves: "x", entryPoints: ["bin/exchange.sh"], status: "proposed" },
  ]);
  const m = model(p);
  assert.deepEqual(boxes(m), {
    "cluster:plan:provisioning": ["provision"],
    "cluster:plan:spawner": ["revoke", "spawn"],
    // a process naming its entry points does not claim its folder's probes; a proposed one moves nothing
    "cluster:scripts:.": ["exchange", "probe-a", "probe-b"],
  });
  assert.equal(m.nodes.find((n) => n.id === "cluster:plan:spawner").label, "admin spawner");
  assert.match(m.nodes.find((n) => n.id === "cluster:plan:spawner").notes[0], /agreed plan names process spawner/);
  // a process placed by `at` alone is located, not anchored: nothing moves
  const located = plan([{ id: "probes", kind: "service", label: "probes", serves: "x", at: "bin/probe-a.sh", status: "agreed" }]);
  assert.deepEqual(Object.keys(boxes(model(located))), ["cluster:scripts:."]);
  // a box the plan does not divide keeps its id
  const whole = plan([{ id: "all", kind: "service", label: "all", serves: "x", entryPoints: FILES, status: "agreed" }]);
  assert.deepEqual(Object.keys(boxes(model(whole))), ["cluster:scripts:."]);
});

test("drift counts new entry points, and a plan box no group holds is substantial", () => {
  const before = model(null);
  const store = { version: "1", groups: [{ id: "g-all", kind: "process", label: "All", wraps: ["cluster:scripts:."] }], names: {}, ratified: { at: "2026-10-01T00:00:00Z", model: "m" } };
  const placed = { ...before, groups: [{ id: "g-all", kind: "process", label: "All", wraps: ["cluster:scripts:."], source: "stated" }], nodes: before.nodes.map((n) => ({ ...n, group: "g-all" })) };
  const s = { ...store, baseline: archBaseline(placed, [], null) };
  // a new entry point landing in an existing box
  const grown = { ...placed, nodes: placed.nodes.map((n) => ({ ...n, entryPoints: [...n.entryPoints, "bin/new.sh:main"] })) };
  const d1 = archDrift(grown, s, [], null);
  assert.equal(d1.level, "minor");
  assert.deepEqual(d1.entriesAdded, ["bin/new.sh:main"]);
  // a box the agreed plan made, in no group
  const split = model(plan([{ id: "spawner", kind: "service", label: "spawner", serves: "x", entryPoints: ["bin/spawn.sh"], status: "agreed" }]));
  const withGroups = { ...split, groups: placed.groups, nodes: split.nodes.map((n) => (n.id === "cluster:scripts:." ? { ...n, group: "g-all" } : n)) };
  const d2 = archDrift(withGroups, s, [], null);
  assert.equal(d2.level, "substantial");
  assert.ok(d2.reasons.some((r) => /box the agreed plan names, in no group: cluster:plan:spawner/.test(r)), d2.reasons.join("\n"));
});

test("a derived state machine with the declared one's transitions is drawn once", () => {
  const root = mkdtempSync(join(tmp, "t-"));
  mkdirSync(join(root, ".vibegraph/topology"), { recursive: true });
  writeFileSync(join(root, "in.json"), "{}");
  writeFileSync(join(root, ".vibegraph/topology/sources.json"), JSON.stringify({ version: "1", sources: [{ id: "gen", generator: "true", inputs: ["in.json"] }] }));
  const declared = { version: "1", stateMachines: [{ id: "phase", evaluatedBy: "decideOnEvidence", transitions: [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "B", to: "D" }] }] };
  writeFileSync(join(root, ".vibegraph/topology/gen.json"), JSON.stringify({ generatedAt: "2026-10-12T00:00:00Z", inputsHash: "x", topology: declared }));
  const derived = { version: "1", stateMachines: [
    { id: "TRANSITIONS", evaluatedBy: "studioModel", transitions: [{ from: "A", to: "B" }, { from: "B", to: "C" }] },
    { id: "OTHER", transitions: [{ from: "X", to: "Y" }] },
  ] };
  const t = loadTopology(root, derived).topology;
  assert.deepEqual(t.stateMachines.map((m) => m.id), ["phase", "OTHER"], "the mirror folds in; an unrelated machine stays");
  assert.deepEqual(t.stateMachines[0].alsoDerived, { id: "TRANSITIONS", evaluatedBy: "studioModel" });
  assert.equal(t.stateMachines[0].evaluatedBy, "decideOnEvidence", "the declaration says who applies it");
});

test("with groups settled, a pending groups proposal no longer stops the brief, and a full draft keeps it", () => {
  const root = mkdtempSync(join(tmp, "b-"));
  mkdirSync(join(root, ".vibegraph"), { recursive: true });
  writeFileSync(join(root, ".vibegraph/architecture.json"), JSON.stringify({ version: "1", groups: [{ id: "g-a", kind: "process", label: "A", wraps: ["cluster:x"] }], names: {}, ratified: { at: "2026-10-01T00:00:00Z", model: "m" } }));
  const pendingGroups = [{ op: "add", id: "g-new", label: "New", kind: "process", members: ["cluster:x"], cites: ["cluster:x"] }];
  const rec = { version: "1", proposed: { model: "m", at: "2026-10-12T00:00:00Z", spec: { function: [], method: [], feature: [] }, groups: pendingGroups, names: {}, scopes: [], primaryPath: null, omitted: [], refused: [], hashes: {} } };
  const g = groupsStep(root, rec, { nodes: [], edges: [], groups: [] });
  assert.equal(g.step, "brief");
  assert.equal(g.skipGroups, true);
  assert.match(g.note, /still wait for a person/);
  const draft = { ...rec.proposed, groups: [], spec: { function: [{ text: "x", words: ["decides"], cites: [], boxes: [] }], method: [], feature: [] } };
  const next = proposeBrief(rec, draft);
  assert.deepEqual(next.proposed.groups.map((x) => x.id), ["g-new"], "the pending groups wait beside the new draft");
  assert.equal(next.proposed.spec.function.length, 1);
  // with nothing settled it still waits
  rmSync(join(root, ".vibegraph/architecture.json"));
  assert.equal(groupsStep(root, rec, { nodes: [], edges: [], groups: [] }).step, "wait");
});

test("where the code calls a ratified spec's operations is a [use] fact", () => {
  const spec = { tool: "signing", status: "ratified", definition: "Signs and verifies.", identity: { packages: ["@acme/ssi"], calls: ["ResolveDID"] },
    operations: [{ name: "ResolveDID", does: "read", on: "a DID document" }], states: [], permissions: [], rules: [], unknowns: [] };
  const files = { "src/verify.ts": { nodes: [{ type: "call", funcName: "ssi.ResolveDID", line: 41 }] }, "test/verify.test.ts": { nodes: [{ type: "call", funcName: "ssi.ResolveDID", line: 3 }] } };
  const f = buildBriefFacts({ version: "1", nodes: [], edges: [], groups: [], unplaced: [], notes: [] }, {
    root: tmp, readLines: () => Array.from({ length: 60 }, (_, i) => `line ${i + 1}`), specs: [spec], source: { files, threads: [] },
  });
  assert.match(f.text, /src\/verify\.ts:41[^\n]*\[use\]: calls signing ResolveDID \(read a DID document\)/);
  assert.doesNotMatch(f.text, /test\/verify\.test\.ts:3[^\n]*\[use\]/, "a test's call is not running evidence");
  assert.equal(f.roles.get("src/verify.ts:41"), "use");
});

test("a TypeScript field or parameter property with a `new K()` default is typed K", () => {
  const file = join(tmp, "exchange.ts");
  writeFileSync(file, [
    "class Codec { encode(x: string) { return x; } }",
    "class Store { get() { return 1; } }",
    "export class Exchange {",
    "  private cache = new Store();",
    "  constructor(private readonly codec = new Codec(), private name = \"x\") {}",
    "  send() { this.cache.get(); return this.codec.encode(this.name); }",
    "}",
  ].join("\n"));
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/frontends/jsts/parse_jsts.mjs"), file], { encoding: "utf8" });
  const ir = JSON.parse(r.stdout);
  const cls = ir.nodes.find((n) => n.type === "class_def" && n.name === "Exchange");
  assert.deepEqual(cls.fieldTypes, { cache: "Store", codec: "Codec" });
});

test("above the cap, write grants are said on the principals' cards; a selected card keeps its own", () => {
  const zones = Array.from({ length: 30 }, (_, i) => ({ id: `z${String(i).padStart(2, "0")}`, store: "s" }));
  const grants = ["alpha", "beta"].flatMap((who) => zones.map((z) => ({ who, zone: z.id, access: "write" })));
  const t = { version: "1", stores: [{ id: "s" }], zones, principals: [{ id: "alpha" }, { id: "beta" }], grants };
  assert.ok(grants.length > GRANT_EDGE_CAP);
  const m = resourcesModel({ topology: t, status: [], conflicts: [] });
  const writes = (x) => x.edges.filter((e) => e.topoAccess === "write");
  assert.equal(writes(m).length, 0);
  assert.match(m.nodes.find((n) => n.id === "topo:pr:alpha").notes[0], /may write 30 zones/);
  assert.ok(m.notes.some((n) => /said on the principals' cards/.test(n)));
  const focused = resourcesModel({ topology: t, status: [], conflicts: [] }, [], null, { focus: "topo:pr:alpha" });
  assert.ok(writes(focused).length > 0 && writes(focused).every((e) => e.from === "topo:pr:alpha"));
});
