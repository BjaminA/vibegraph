// The SYSTEM MAP (2026-09-25): architecture.vibegraph.json (src/server/
// system_map.ts, schemas/system_map.schema.json) and architecture.md
// (src/server/system_map_md.ts) — VibeGraph's own format, every lens of the
// map as data, written for an agent.
//
//   npm run test:system-map
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { applyArchStore, emptyStore } from "../src/server/arch_store.ts";
import { buildSystemMap } from "../src/server/system_map.ts";
import { renderSystemMapMd } from "../src/server/system_map_md.ts";
import { refreshExportedArchitecture } from "../src/server/arch_refresh.ts";
import { buildArchLayout } from "../src/webview/system/archLayout.ts";
import { ARCH_LENSES } from "../src/webview/system/arch_lens.ts";
import { deriveThreadCalls } from "../src/webview/system/threadInteraction.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = (rel, store) => {
  const root = join(ROOT, rel);
  const env = buildPolyglotEnvelope(root).envelope;
  const crossings = buildCrossingIndex(env);
  let model = archModelForEnvelope(env, buildStackIndex(env, root), crossings, root, undefined, { applyStore: false });
  if (store) model = applyArchStore(model, { ...emptyStore(), ...store });
  const map = buildSystemMap(model, {
    title: rel.split("/").pop(), commit: "abc1234", tool: "test",
    entryPoints: env.entryPoints, system: env.system ?? null, threadGraph: deriveThreadCalls(env.threads, env.entryPoints, crossings),
  });
  return { model, map, env };
};

let validate, fleet, shop, next;
before(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas/system_map.schema.json"), "utf-8")));
  fleet = fixture("examples/fleet-telemetry");
  shop = fixture("test/fixtures/polyglot/shop_demo");
  next = fixture("test/fixtures/webstack/next_demo", {
    groups: [
      { id: "g-public", kind: "network", label: "public network", wraps: ["cluster:web:.", "cluster:mcp:."] },
      { id: "g-volt", kind: "host", label: "Volt host", wraps: ["cluster:scripts:."], parent: "g-public" },
    ],
    proposal: { at: "x", model: "stub", groups: [{ id: "g-prop", kind: "trust", label: "proposed zone", wraps: ["tool:pg"], evidence: [] }], names: {}, refused: [] },
  });
});

test("our own format: validates against schemas/system_map.schema.json for every fixture, with every lens", () => {
  for (const { map } of [fleet, shop, next]) {
    assert.ok(validate(map), JSON.stringify(validate.errors?.slice(0, 3)));
    assert.equal(map.format, "vibegraph.system-map");
    assert.deepEqual(Object.keys(map.views).sort(), [...ARCH_LENSES].sort());
    assert.ok(!JSON.stringify(map).toLowerCase().includes("archify"), "nothing in it is Archify's");
  }
});

test("each lens selects exactly what the map draws for it (one definition: arch_lens.ts)", () => {
  for (const { model, map } of [fleet, shop, next]) {
    for (const lens of ARCH_LENSES) {
      const drawn = buildArchLayout(model, lens);
      const drawnNodes = drawn.nodes.filter((n) => n.type !== "archGroup").map((n) => n.id).sort();
      assert.deepEqual([...map.views[lens].nodes].sort(), drawnNodes, `${lens}: nodes`);
      assert.deepEqual([...map.views[lens].edges].sort(), drawn.edges.map((e) => e.id).sort(), `${lens}: edges`);
      // Every id a view names resolves: to the model, or to a record the lens reshaped.
      const known = new Set([...map.nodes.map((n) => n.id), ...map.views[lens].reshaped.nodes.map((n) => n.id)]);
      for (const id of map.views[lens].nodes) assert.ok(known.has(id), `${lens}: ${id} resolves`);
    }
  }
});

test("Bird's-eye: a process on the flow keeps its own box, one Browser per web app, invented boxes carried in full", () => {
  // fleet's processes all live at the project root. The two HTTP APIs hop to
  // each other, so neither folds (they had folded into one box called
  // "Library", and the flow the lens exists to show vanished).
  const fb = fleet.map.views.birdseye;
  assert.ok(fb.nodes.includes("cluster:api-express:.") && fb.nodes.includes("cluster:api-flask:."));
  const hop = fb.edges.map((id) => fleet.map.edges.find((e) => e.id === id) ?? fb.reshaped.edges.find((e) => e.id === id))
    .find((e) => e.from === "cluster:api-express:." && e.to === "cluster:api-flask:.");
  assert.ok(hop, "the express → flask hop is drawn");
  // next_demo: the web app gets ONE Browser, and only the web app does.
  const nb = next.map.views.birdseye;
  const actors = nb.reshaped.nodes.filter((n) => n.kind === "actor");
  assert.deepEqual(actors.map((n) => n.id), ["actor:browser:cluster:web:."], "the Browser actor is a record, in front of the web app only");
  // A one-unit project's Bird's-eye is never empty (it drew nothing before).
  for (const { map } of [fleet, shop, next]) assert.ok(map.views.birdseye.nodes.length > 0, `${map.title}: Bird's-eye draws something`);
  assert.ok(!next.map.views.flows.nodes.some((id) => id.startsWith("tool:")));
  assert.ok(next.map.views.overview.nodes.some((id) => id.startsWith("tools:")) || next.map.views.overview.reshaped.nodes.length === 0);
});

test("hierarchy: stated groups nest, members sit in the innermost group, provenance on every group", () => {
  const tree = next.map.hierarchy.groups;
  const pub = tree.find((g) => g.id === "g-public");
  assert.ok(pub, "the outer group is a root");
  assert.equal(pub.source, "stated");
  assert.deepEqual(pub.groups.map((g) => g.id), ["g-volt"], "the host nests inside the network");
  assert.ok(pub.groups[0].members.includes("cluster:scripts:."));
  const prop = tree.find((g) => g.id === "g-prop");
  assert.equal(prop.source, "proposed");
  assert.deepEqual(prop.evidence, []);
  assert.ok(next.map.nodes.find((n) => n.id === "cluster:scripts:.").group === "g-volt", "the node carries its group");
});

test("subsystems and the thread graph ride along when the envelope has them", () => {
  assert.ok(fleet.map.subsystems && fleet.map.subsystems.subsystems.length > 0, "the subsystem tier");
  assert.ok(fleet.map.threads.calls.length + fleet.map.threads.hops.length > 0, "which thread drives which");
  assert.equal(fleet.map.entryPoints.length, fleet.env.entryPoints.length);
  assert.ok(fleet.map.entryPoints.filter((e) => e.process).length > 0, "an entry point names the process it runs in");
});

test("architecture.md: the agent's page — every section, every hop, provenance marked, nothing silently dropped", () => {
  const md = renderSystemMapMd(next.map);
  for (const h of ["## Start here", "## Bird's-eye", "## Where things run", "## Processes", "## Boundaries", "## What crosses the edges", "## Deployment and trust boundaries", "## Not on this map"]) {
    assert.ok(md.includes(h), h);
  }
  assert.match(md, /\*\*public network\*\* \(network\) — \*\*stated\*\*/);
  assert.match(md, /\*\*proposed zone\*\* \(trust\) — \*proposed, INFERRED\*/);
  assert.match(md, /a proposal from stub is PENDING/);
  // Every hop is named under its source process, with its protocol.
  for (const e of next.map.edges.filter((x) => x.kind !== "uses")) {
    assert.ok(md.includes(`- → **${next.map.nodes.find((n) => n.id === e.to).label}** ${e.kind} \`${e.protocol}\``), `hop ${e.id}`);
  }
  for (const t of next.map.nodes.filter((n) => n.kind === "tool")) assert.ok(md.includes(t.tool ?? t.id.slice(5)), `tool ${t.id}`);
  const fmd = renderSystemMapMd(fleet.map);
  assert.match(fmd, /## Subsystems/);
  assert.match(fmd, /## Which threads drive which/);
  assert.match(fmd, /No deployment or trust group is stated/, "fleet states none, and the page says so rather than inventing one");
});

test("a decision reaches the exported documents: only files already exported are rewritten; Archify's is named as left behind", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-arch-refresh-"));
  try {
    const knowledge = join(tmp, ".vibegraph", "knowledge");
    mkdirSync(knowledge, { recursive: true });
    writeFileSync(join(knowledge, "architecture.md"), "stale\n");
    writeFileSync(join(knowledge, "architecture.archify.json"), "{}\n");
    const r = refreshExportedArchitecture(tmp, next.model, {
      entryPoints: next.env.entryPoints, system: next.env.system ?? null, threadGraph: null, tool: "test",
    });
    assert.deepEqual(r.written, [join(".vibegraph", "knowledge", "architecture.md")]);
    assert.deepEqual(r.stale, [join(".vibegraph", "knowledge", "architecture.archify.json")]);
    assert.match(readFileSync(join(knowledge, "architecture.md"), "utf-8"), /\*\*public network\*\* \(network\) — \*\*stated\*\*/);
    assert.ok(!existsSync(join(knowledge, "architecture.vibegraph.json")), "nothing is added");
    assert.ok(!existsSync(join(tmp, ".vibegraph", "architecture-map")), "no folder is created");
    // A project with no export gets nothing written.
    const bare = mkdtempSync(join(tmpdir(), "vg-arch-refresh-bare-"));
    assert.deepEqual(refreshExportedArchitecture(bare, next.model, { entryPoints: [], system: null, threadGraph: null, tool: "test" }), { written: [], stale: [] });
    rmSync(bare, { recursive: true, force: true });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("counts read as English: 1 entry point, not 1 entry points", () => {
  const md = renderSystemMapMd(fleet.map);
  assert.doesNotMatch(md, /\b1 (entry points|files|processes|scripts|hops|dispatchers|boundary tools)\b/);
  assert.match(md, /1 entry point · 2 files reached/, "the C++ CLI: one entry point");
});

test("byte-stable: the same model renders the same bytes", () => {
  const again = fixture("examples/fleet-telemetry");
  assert.equal(JSON.stringify(again.map), JSON.stringify(fleet.map));
  assert.equal(renderSystemMapMd(again.map), renderSystemMapMd(fleet.map));
});
