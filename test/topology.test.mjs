// The DECLARED TOPOLOGY (2026-10-02, topology brief Modules 1, 2, 4, 5, 6).
// Fixture test/fixtures/topology/topo_demo: a project on a shared store whose
// zones, principals, grants, transition table and verdict tree are DATA
// (catalogue/*.mjs) and whose zone names are COMPUTED (zoneFor), with its own
// generator (tools/topology.mjs), a stand-in read-only live inventory
// (tools/live.mjs) and a run log (tools/run.jsonl). Pinned: registration runs
// the generator and validates its output; staleness follows the inputs'
// content; export regenerates a stale source and writes topology.md; the
// queries answer who-writes / can-write / touches (reading the IR, not the
// thread's labels); a decision node's evidence chain reaches the zone's
// writers; live drift is named; a trace event against the grants is flagged.
//
//   npm run test:topology
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { loadTopology, sourceStatus, loadSources, validateTopology, validateSource } from "../src/server/topology_store.ts";
import { whoMay, mayAccess, threadsTouching, threadsOfFunction, zoneOfFamily } from "../src/shared/topology_query.ts";
import { decisionChain, formatChain, diffTopology, parseTrace, replayTrace } from "../src/shared/topology_analysis.ts";
import { resourcesModel, decisionsModel, traceIds, zoneId, prId, dnId, famId, TOPO } from "../src/webview/system/arch_topology.ts";
import { topologyState } from "../src/server/topology_server.ts";
import { runHook } from "../scripts/cli/hooks.mjs";

const FIX = "test/fixtures/topology/topo_demo";
let tmp, root;
const cli = (args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", "topology", ...args, "--root", root], { encoding: "utf-8" });
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-topo-"));
  root = join(tmp, "topo");
  cpSync(FIX, root, { recursive: true });
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test("module 1: the committed fixture's topology is fresh, valid, and cites its declarations", () => {
  const m = loadTopology(FIX);
  assert.deepEqual(m.status.map((s) => s.state), ["fresh"]);
  assert.equal(validateTopology(m.topology), null);
  assert.deepEqual(m.topology.zones.map((z) => [z.id, z.cite]), [["requests", "catalogue/zones.mjs:5"], ["verdicts", "catalogue/zones.mjs:6"], ["evidence", "catalogue/zones.mjs:7"]]);
  assert.equal(m.topology.grants.find((g) => g.who === "role:decider").cite, "catalogue/principals.mjs:11");
});

test("module 1: add runs and validates the generator; an input change makes it stale; run makes it fresh; export regenerates", () => {
  const r = cli(["add", "second", "--generator", "node tools/topology.mjs", "--inputs", "catalogue/"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /generated — 3 zone\(s\), 3 principal\(s\), 6 grant\(s\), 2 decision structure\(s\)/);
  assert.equal(cli(["check"]).status, 0);
  appendFileSync(join(root, "catalogue/zones.mjs"), "\n// a comment changes the inputs\n");
  const st = sourceStatus(root, loadSources(root).find((s) => s.id === "second"));
  assert.equal(st.state, "stale");
  assert.equal(cli(["check"]).status, 1, "check exits 1 on a stale source");
  const orient = runHook("session-start", { session_id: "s", source: "startup" }, { absRoot: root, pipeline: {} })?.json?.hookSpecificOutput?.additionalContext ?? "";
  assert.match(orient, /Declared topology not fresh: .*second \(stale; re-run: vibegraph-knowledge topology run second\)/, "the session-start hook flags it");
  // export regenerates what is stale, then writes topology.md
  const e = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", "export", root], { encoding: "utf-8" });
  assert.equal(e.status, 0, e.stderr);
  assert.equal(cli(["check"]).status, 0, "fresh again after export");
  const md = readFileSync(join(root, ".vibegraph/knowledge/topology.md"), "utf-8");
  assert.match(md, /^# Declared topology/);
  assert.match(md, /zone \*\*verdicts\*\* _\(catalogue\/zones\.mjs:6\)_ — holds verdict; write: svc-decider/);
  assert.match(readFileSync(join(root, ".vibegraph/knowledge/README.md"), "utf-8"), /\*\*Declared topology:\*\* `topology\.md`/);
  // a generator whose output is not a topology is refused, and nothing is stored
  const bad = cli(["add", "broken", "--generator", "node -e \"console.log(JSON.stringify({version:'1',zones:[{id:'z'}]}))\"", "--inputs", "catalogue/"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /NOT generated: the generator's output is not a valid topology: zones\[0\] needs id, store/);
  assert.ok(!existsSync(join(root, ".vibegraph/topology/broken.json")));
  assert.match(validateSource({ id: "live", generator: "x", inputs: ["a"] }), /not `sources` or `live`/);
});

test("module 2: who may write a zone, what a principal may write, which threads touch a family", () => {
  const t = loadTopology(FIX).topology;
  assert.deepEqual(whoMay(t, "verdicts", "write").map((w) => [w.principal, w.via]), [["svc-decider", "role:decider"]]);
  assert.deepEqual(mayAccess(t, "svc-decider", "write").map((z) => z.zone), ["verdicts"]);
  assert.equal(zoneOfFamily(t, "reading-pressure"), "evidence", "a family pattern finds its zone");
  const env = buildPolyglotEnvelope(FIX, { skipSystem: true }).envelope;
  const touch = threadsTouching(t, "inspection", env.threads, env.files).filter((h) => !h.entryPointId.startsWith("tools/"));
  assert.deepEqual(touch, [{ entryPointId: "src/decider.ts:module", at: "src/decider.ts:7 hasRecentInspection" }], "read from the IR of the functions the thread walks");
  assert.deepEqual(threadsOfFunction("zoneFor", env.threads).sort(), ["src/decider.ts:module", "src/intake.ts:module"]);
  // The CLI says the same.
  assert.match(spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", "topology", "who-writes", "verdicts", "--root", FIX], { encoding: "utf-8" }).stdout, /svc-decider \(via role:decider\) — catalogue\/principals\.mjs:11/);
});

test("module 2 view: stores are boxes of zones, principals have read/write edges, each zone names its router's threads", () => {
  const m = loadTopology(FIX);
  const env = buildPolyglotEnvelope(FIX, { skipSystem: true }).envelope;
  const v = resourcesModel(m, env.threads);
  assert.deepEqual(v.groups.find((g) => g.id === `${TOPO}store:docs`).wraps, [zoneId("requests"), zoneId("verdicts"), zoneId("evidence")]);
  const w = v.edges.find((e) => e.from === prId("svc-decider") && e.to === zoneId("verdicts"));
  assert.equal(w.protocol, "write");
  assert.match(w.protocolBasis, /role:decider write verdicts \(svc-decider holds role:decider\) — catalogue\/principals\.mjs:11/);
  assert.ok(v.edges.some((e) => e.from === famId("reading") && e.to === zoneId("evidence")));
  assert.match(v.nodes.find((n) => n.id === zoneId("requests")).notes.join(" "), /routed by zoneFor — on src\/intake\.ts:module, src\/decider\.ts:module|routed by zoneFor — on src\/decider\.ts:module, src\/intake\.ts:module/);
});

test("module 4: a decision node → the evidence it reads → its zone → who may write it", () => {
  const t = loadTopology(FIX).topology;
  const c = decisionChain(t, "verdict", "readings-ok");
  assert.deepEqual(c.path, ["has-inspection:yes"]);
  assert.deepEqual(c.evidence, [{ family: "reading-*", zone: "evidence", writers: ["inspector"], readers: ["svc-decider"] }]);
  assert.match(formatChain(c), /reads reading-\* → zone evidence → writable by inspector/);
  const v = decisionsModel(loadTopology(FIX));
  assert.ok(v.edges.some((e) => e.from === dnId("verdict", "has-inspection") && e.to === dnId("verdict", "readings-ok") && e.protocol === "yes"));
  assert.ok(v.edges.some((e) => e.from === dnId("verdict", "readings-ok") && e.to === famId("reading") && e.protocol === "reads"));
  assert.ok(v.nodes.some((n) => n.id === zoneId("evidence") && /writers inspector/.test(n.sublabel)), "the zone, with who may write it");
  assert.ok(v.edges.some((e) => e.from === `${TOPO}sm:request:under-review` && e.to === `${TOPO}sm:request:approved` && e.protocol === "role:decider"));
  assert.equal(decisionChain(t, "verdict", "nope"), null);
});

test("module 5: the live inventory's drift — an undeclared zone, a missing grant, an extra grant — drawn on the map", () => {
  const s = topologyState(FIX);
  assert.deepEqual(s.live.drift, { undeclaredStores: [], undeclaredZones: ["scratch"], missingZones: [], missingGrants: ["svc-intake read verdicts"], extraGrants: ["svc-intake write verdicts"] });
  const v = resourcesModel(s.model, [], s.live.drift);
  assert.match(v.nodes.find((n) => n.id === zoneId("scratch")).sublabel, /ON THE PLATFORM, NOT DECLARED/);
  assert.ok(v.edges.some((e) => e.from === prId("svc-intake") && e.to === zoneId("verdicts") && /on the platform, NOT declared/.test(e.protocol)));
  assert.ok(v.edges.some((e) => e.from === prId("svc-intake") && e.to === zoneId("verdicts") && /declared, NOT on the platform/.test(e.protocol)));
  assert.deepEqual(diffTopology(s.model.topology, s.model.topology).extraGrants, [], "no drift against itself");
});

test("module 6: a trace replayed against the declaration — the one write with no grant is flagged; steps light their nodes", () => {
  const t = loadTopology(FIX).topology;
  const { events, errors } = parseTrace(readFileSync(join(FIX, "tools/run.jsonl"), "utf-8"));
  assert.deepEqual(errors, []);
  const steps = replayTrace(t, events);
  assert.deepEqual(steps.filter((x) => x.flags.length).map((x) => [x.i, x.flags]), [[7, ["svc-intake has no declared write grant on verdicts"]]]);
  assert.deepEqual([...traceIds(t, steps[4])].sort(), [dnId("verdict", "has-inspection"), prId("svc-decider")].sort());
  const bad = replayTrace(t, [{ actor: "svc-intake", action: "transition", decision: "request:submitted>under-review" }, { actor: "x", action: "decide", decision: "verdict:nowhere" }]);
  assert.match(bad[0].flags[0], /svc-intake is not among those who may make submitted → under-review/);
  assert.match(bad[1].flags[0], /decision node verdict:nowhere is not declared/);
  assert.deepEqual(parseTrace("{bad\n").errors.length, 1);
  assert.equal(topologyState(FIX).traces[0].name, "run");
});
