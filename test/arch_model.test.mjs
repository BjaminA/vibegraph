// M-ARCH.1 (PLAN-M-ARCH.md) — the derived architecture model.
//
// Pinned on three fixtures that carry every shape the first lenses need:
// next_demo (a Next app running backend scripts through a platform, an MCP
// server and client, a private SDK with a stated role), fleet-telemetry (an
// Express gateway calling a Flask service — the case one "HTTP API" cluster
// got wrong on the first probe) and the polyglot shop.
//
//   npm run test:arch-model
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope, manifestDirsFor } from "../src/server/arch_envelope.ts";
import { familyOf, packageRootOf } from "../src/server/arch_model.ts";
import { commandProtocol, toolProtocol, NON_CARRIERS } from "../src/shared/arch_protocol.ts";
import { attributeBoundary } from "../src/shared/stack_attribution.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const build = (rel) => {
  const root = join(ROOT, rel);
  const env = buildPolyglotEnvelope(root).envelope;
  return archModelForEnvelope(env, buildStackIndex(env, root), buildCrossingIndex(env), root);
};
let next, fleet, shop;
before(() => {
  next = build("test/fixtures/webstack/next_demo");
  fleet = build("examples/fleet-telemetry");
  shop = build("test/fixtures/polyglot/shop_demo");
});
const node = (m, id) => m.nodes.find((n) => n.id === id);
const edgesFrom = (m, from, to) => m.edges.filter((e) => e.from === from && (!to || e.to === to));

test("every model validates against the schema", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas/arch_model.schema.json"), "utf-8"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  for (const [name, m] of [["next", next], ["fleet", fleet], ["shop", shop]]) {
    assert.ok(validate(m), `${name}: ${JSON.stringify(validate.errors?.slice(0, 3))}`);
  }
});

test("a cluster is a framework's family under a package root — never a directory guess, never a graph community", () => {
  assert.deepEqual(next.nodes.filter((n) => n.kind === "cluster").map((n) => n.id).sort(),
    ["cluster:mcp:.", "cluster:scripts:.", "cluster:web:."]);
  const web = node(next, "cluster:web:.");
  assert.equal(web.label, "Next.js app");
  assert.equal(web.category, "frontend");
  assert.ok(web.entryPoints.includes("app/dashboard/page.tsx:DashboardPage"));
  // The extensionless `bin/orders-cli` is a SCRIPT by its IR language, not a "CLI" by default.
  assert.ok(node(next, "cluster:scripts:.").entryPoints.includes("bin/orders-cli:module"));
  // Two processes in one repo are two clusters: the framework is part of a service's family.
  const fl = fleet.nodes.filter((n) => n.kind === "cluster").map((n) => n.id).sort();
  assert.ok(fl.includes("cluster:api-express:.") && fl.includes("cluster:api-flask:."), fl.join(", "));
  assert.equal(node(fleet, "cluster:api-express:.").internalHops, undefined, "the gateway's calls to Flask are NOT internal");
  // Tests are not architecture; they are counted, not drawn.
  assert.equal(fleet.unplaced.tests, 5);
  assert.match(fleet.notes.join(" "), /5 test entry point/);
  // A language-named CLI when no framework names it.
  assert.equal(familyOf({ id: "a:main", kind: "cli", file: "tool/main.cpp", framework: null }, "cpp").label, "CLI (cpp)");
  // The package root is the nearest manifest directory.
  assert.equal(packageRootOf("web-app/app/page.tsx", ["", "web-app", "ops-scripts"]), "web-app");
  assert.equal(packageRootOf("scripts/x.sh", ["", "web-app"]), "");
  assert.deepEqual(manifestDirsFor(join(ROOT, "test/fixtures/webstack/next_demo"), ["app/page.tsx", "lib/db.ts"]), [""]);
});

test("hops between clusters carry the protocol their kind and carrier say", () => {
  const cmd = edgesFrom(next, "cluster:web:.", "cluster:scripts:.");
  assert.equal(cmd.length, 1);
  assert.equal(cmd[0].kind, "command");
  assert.equal(cmd[0].protocol, "Volt · WebSocket · command", "the page's thread calls the Volt web client in the file that names the script");
  assert.match(cmd[0].protocolBasis, /calls @tdxvolt\/volt-client-web/);
  assert.equal(cmd[0].confidence, "path");
  assert.ok(cmd[0].refs.some((r) => r.file === "lib/volt.ts"));
  const mcp = edgesFrom(next, "cluster:web:.", "cluster:mcp:.");
  assert.deepEqual(mcp.map((e) => [e.kind, e.protocol, e.details]), [["tool", "MCP", ["list_orders"]]]);
  const http = edgesFrom(fleet, "cluster:api-express:.", "cluster:api-flask:.");
  assert.deepEqual(http.map((e) => [e.kind, e.protocol, e.count, e.confidence, e.details]), [["http", "HTTP", 5, "path", ["GET", "POST"]]]);
  // Hops inside one cluster are counted on it, not drawn.
  assert.ok(node(next, "cluster:scripts:.").internalHops.command >= 3);
  // A hop naming nothing parsed is counted.
  assert.ok(next.unplaced.unmatchedHops >= 1);
});

test("a cluster's calls into a boundary tool are one edge per protocol, with funnels and call sites", () => {
  const pg = edgesFrom(next, "cluster:web:.", "tool:pg");
  assert.deepEqual(pg.map((e) => [e.kind, e.protocol, e.via]), [["uses", "SQL", ["lib.db"]]]);
  assert.ok(pg[0].refs.every((r) => r.file && r.nodeId), "every ref is a file and an IR node id — an edit address");
  const volt = node(next, "tool:@tdxvolt/volt-client-web");
  assert.equal(volt.category, "platform");
  assert.match(volt.sublabel, /platform SDK.*v0\.20\.28/);
  assert.deepEqual(volt.wrappedBy, ["lib.volt"]);
  const ledger = node(next, "tool:@acme/ledger-client");
  assert.equal(ledger.roleStatedBy, "c1", "a stated role is carried, so the view can say who stated it");
  assert.equal(edgesFrom(next, "cluster:web:.", "tool:openai")[0].protocol, "HTTPS · model API");
  assert.equal(edgesFrom(next, "cluster:web:.", "tool:@modelcontextprotocol/sdk")[0].protocol, "MCP");
  // An unclassified tool a thread CALLS is drawn as unknown, never hidden.
  const clsx = edgesFrom(next, "cluster:web:.", "tool:clsx")[0];
  assert.equal(clsx.protocol, "unknown");
  assert.match(clsx.protocolBasis, /classify it, or state its role/);
  // Shell tools are boundaries too, with their own wire.
  assert.equal(edgesFrom(fleet, "cluster:scripts:.", "tool:ssh")[0].protocol, "SSH");
  assert.equal(edgesFrom(fleet, "cluster:scripts:.", "tool:psql")[0].protocol, "SQL");
  // A tool present in a cluster's files and called by none of its threads is listed, not drawn.
  assert.ok(fleet.unplaced.toolsPresentNotCalled.includes("requests"));
  assert.ok(!fleet.nodes.some((n) => n.id === "tool:requests"));
});

test("the protocol table: a role's wire, a member's documented transport, and unknown with its reason", () => {
  assert.equal(toolProtocol("@tdxvolt/volt-client-grpc", "platform").protocol, "Volt · gRPC");
  assert.equal(toolProtocol("psycopg2", "db").protocol, "SQL");
  assert.equal(toolProtocol("mongoose", "db").protocol, "MongoDB wire");
  assert.equal(toolProtocol("ioredis", "cache").protocol, "RESP");
  assert.equal(toolProtocol("kafkajs", "queue").protocol, "Kafka");
  assert.equal(toolProtocol("mystery", "db").protocol, "db");
  assert.equal(commandProtocol(null, "bash").protocol, "exec");
  assert.equal(commandProtocol(null, "jsts").protocol, "command");
  assert.match(commandProtocol({ tool: "@tdxvolt/volt-client-web", role: "platform", how: "present" }, "jsts").basis, /presence claim/);
});

test("corrections from the first real codebase: exec carriers, cluster presence, project modules, distinct counts", async () => {
  const { buildArchModel } = await import("../src/server/arch_model.ts");
  // A command hop whose source thread spawns through child_process is `exec`;
  // one whose carrier is only a cluster-level platform import says so.
  assert.equal(commandProtocol({ tool: "child_process", role: "runtime", how: "called" }, "jsts").protocol, "exec");
  const cl = commandProtocol({ tool: "@tdxvolt/volt-client-web", role: "platform", how: "cluster" }, "jsts");
  assert.equal(cl.protocol, "Volt · WebSocket · command");
  assert.equal(cl.presence, true);
  assert.match(cl.basis, /cluster-level presence claim/);
  assert.ok(NON_CARRIERS.has("@tdxvolt/volt-utility"), "identity helpers never carry a command");
  // A synthetic two-cluster project: the web page names a script through a
  // helper that takes the client as a VALUE, and the web cluster imports
  // exactly one platform client elsewhere.
  const files = { "web/app/page.tsx": {}, "web/lib/client.ts": {}, "api/run.sh": {} };
  const m = buildArchModel({
    entryPoints: [
      { id: "web/app/page.tsx:Page", kind: "route", file: "web/app/page.tsx", irNodeId: "module/Page.fn", framework: "next", label: "PAGE /", qualifiedName: "" },
      { id: "api/run.sh:module", kind: "cli", file: "api/run.sh", irNodeId: "module", framework: "shell", label: "run.sh", qualifiedName: "" },
    ],
    threads: [
      { entryPointId: "web/app/page.tsx:Page", filesReached: ["web/app/page.tsx", "web/lib/client.ts"] },
      { entryPointId: "api/run.sh:module", filesReached: ["api/run.sh"] },
    ],
    stack: {
      tools: [{ tool: "@tdxvolt/volt-client-web", role: "platform", origin: "third-party", files: ["web/lib/client.ts"], threads: [], evidence: [] }],
      byFile: { "web/lib/client.ts": ["@tdxvolt/volt-client-web"] }, byThread: {},
    },
    crossings: { all: [], byThread: { "web/app/page.tsx:Page": [
      { kind: "command", entryPointId: "web/app/page.tsx:Page", file: "web/app/page.tsx", nodeId: "module/REL.assign", callee: "REL =", path: "run.sh", method: null, targets: [{ entryPointId: "api/run.sh:module", route: "api/run.sh", method: "command" }], confidence: "path", note: "" },
      { kind: "command", entryPointId: "web/app/page.tsx:Page", file: "web/app/page.tsx", nodeId: "module/X.assign", callee: "X =", path: "gone.sh", method: null, targets: [], confidence: "unmatched", note: "" },
    ] } },
    contractFor: (ep) => ({ externals: [
      { id: "a", kind: "external", label: "vc.CommandStream", effectKind: null, preview: null, irNodeId: "module/Page.fn/vc.call" },
      { id: "b", kind: "external", label: "vc.CommandStream", effectKind: null, preview: null, irNodeId: "module/Page.fn/vc.call" },
    ], stack: [], boundaries: { unattributed: 2 } }),
    fileOfNode: () => "web/app/page.tsx",
    manifestDirs: ["web", "api"],
  });
  const hop = m.edges.find((e) => e.kind === "command");
  assert.equal(hop.from, "cluster:web:web");
  assert.equal(hop.to, "cluster:scripts:api");
  assert.equal(hop.protocol, "Volt · WebSocket · command");
  assert.equal(hop.protocolPresence, true, "a presence claim is marked, so the view draws it weaker");
  assert.equal(m.unplaced.unmatchedHops, 1);
  assert.equal(m.unplaced.unattributedBoundaries, 1, "two threads' view of one call site is ONE site");
});

test("an unresolved Python import naming a module file this project parses is project code, not a dependency", () => {
  const env = {
    files: {
      "pipeline/bot/gate.py": { language: "python", modulePath: "pipeline.bot.gate", nodes: [
        { id: "module/layout_scale.import_from", type: "import_from", module: "layout_scale", names: ["classify_unit"], line: 1 },
        { id: "module/json.import", type: "import", names: ["json"], line: 2 },
        { id: "module/requests.import", type: "import", names: ["requests"], line: 3 },
      ], edges: [] },
      "pipeline/layout_scale.py": { language: "python", modulePath: "pipeline.layout_scale", nodes: [], edges: [] },
      "vendorlike/json.py": { language: "python", modulePath: "vendorlike.json", nodes: [], edges: [] },
    },
    threads: [], entryPoints: [],
  };
  const stack = buildStackIndex(env);
  const names = stack.tools.map((t) => t.tool);
  assert.ok(!names.includes("layout_scale"), "the file exists: a resolution gap in the project's own code");
  assert.ok(names.includes("requests"), "a real dependency stays one");
  assert.equal(stack.tools.find((t) => t.tool === "json")?.origin, "stdlib", "a local json.py never hides the standard library");
  // And a call qualified to that module (`layout_scale:classify_unit`) is
  // project code at the BOUNDARY too — the binding is `classify_unit`, the
  // root is the module.
  const a = attributeBoundary({
    language: "python", label: "classify_unit", qualifiedTarget: "layout_scale:classify_unit",
    effectKind: null, file: "pipeline/bot/gate.py", irNodeId: "module/x.call",
    imports: stack.importsByFile["pipeline/bot/gate.py"], stack,
  });
  assert.equal(a.origin, "project");
  assert.equal(a.projectModule, "layout_scale");
});

test("M-ARCH.3 payloads: what the caller sends, what the callee accepts, what a person stated — keys, never values", () => {
  const mcp = edgesFrom(next, "cluster:web:.", "cluster:mcp:.")[0];
  const sends = mcp.payloads.find((p) => p.side === "caller");
  assert.equal(sends.source, "derived");
  assert.match(sends.text, /client\.callTool\(\{ name: "list_orders", arguments: \{ region \} \}\)/);
  assert.deepEqual(sends.keys, ["name", "arguments", "arguments.region"], "one level of nesting, as dotted keys");
  assert.equal(mcp.payloadSummary, "{ name, arguments, arguments.region }");
  const accepts = mcp.payloads.find((p) => p.side === "callee");
  assert.match(accepts.text, /^list_orders\(args\) → /);
  // A module-seeded script's signature is the argv its top level reads.
  const cmd = edgesFrom(next, "cluster:web:.", "cluster:scripts:.")[0];
  assert.equal(cmd.payloads.find((p) => p.side === "callee").text, "argv: REGION ← ${1:-all}");
  assert.match(cmd.payloads.find((p) => p.side === "caller").text, /client\.command\("bash", \["orders\/export_orders\.sh", region\]\)/);
  // A stated payload-schema scoped to a file an edge's call sites live in rides that edge, labelled.
  const stated = cmd.payloads.find((p) => p.side === "stated");
  assert.equal(stated.source, "stated");
  assert.match(stated.note, /c2 · human-stated/);
  // Calls into a tool carry their own call texts; the label prefers the spelled keys.
  const volt = edgesFrom(next, "cluster:web:.", "tool:@tdxvolt/volt-client-web")[0];
  assert.equal(volt.payloadSummary, "{ token, amount }");
  // The label prefers the call that goes THROUGH the tool over a call on its result.
  assert.match(edgesFrom(next, "cluster:scripts:.", "tool:fetch")[0].payloadSummary, /^fetch\(/);
  // Nothing observed without a trace run: no invented "observed" record.
  assert.ok(next.edges.every((e) => (e.payloads ?? []).every((p) => p.source !== "observed")));
  // The builder records keys, never values.
  const ir = JSON.stringify(next.edges.flatMap((e) => e.payloads ?? []).map((p) => p.keys ?? []));
  assert.ok(!ir.includes("gpt-4.1-mini"), "a literal VALUE never becomes a key");
});

test("nothing in the derived model is stated or proposed, and no group is derived", () => {
  for (const m of [next, fleet, shop]) {
    assert.ok(m.nodes.every((n) => n.source === "derived"));
    assert.ok(m.edges.every((e) => e.source === "derived"));
    assert.deepEqual(m.groups, [], "deployment/trust boundaries are not in the code");
  }
});
