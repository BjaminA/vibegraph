// Hardware, the standard library and unclassified tools (2026-10-12, from a
// RevPi / EtherCAT project whose map read "unclassified" for every hardware
// library, and a box named "node" that was the standard library's URL helper).
//
//   - role `device` (hardware I/O) with table entries; paho / mqtt are queues,
//     yaml a utility, sudo a process; the map draws device boxes with the wire
//     (serial, EtherCAT, …) and a category of their own
//   - the run floor's known-pure list: table or person roles that stay
//     in-process only — never a model's classification
//   - a call's file is the step it hangs off, not the first file holding its
//     node id (`node:url`'s fileURLToPath had become a tool named "node")
//   - Classify on the map: estimate first, then answers stored agent-stated
//
//   npm run test:device-role
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTool, pythonToolName, ROLE_LABEL } from "../src/shared/stack_taxonomy.ts";
import { toolProtocol, ROLE_CATEGORY, ARCH_CATEGORY_LABEL, BOUNDARY_ROLES } from "../src/shared/arch_protocol.ts";
import { floorPureLibraries } from "../src/server/floor_libraries.ts";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { threadContexts } from "../scripts/thread_context.mjs";
import { classifyEstimate, classifyRun } from "../src/server/classify_server.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test("hardware libraries are `device`; MQTT a queue, yaml a utility, sudo a process", () => {
  for (const t of ["serial", "pysoem", "pyvisa", "revpimodio2", "RPi.GPIO", "pymodbus"]) assert.equal(classifyTool("python", pythonToolName(t)).role, "device", t);
  assert.equal(classifyTool("python", pythonToolName("paho.mqtt.client")).role, "queue");
  assert.equal(classifyTool("python", "yaml").role, "utility");
  assert.equal(classifyTool("jsts", "serialport").role, "device");
  assert.equal(classifyTool("jsts", "mqtt").role, "queue");
  assert.equal(classifyTool("bash", "piTest").role, "device");
  assert.equal(classifyTool("bash", "sudo").role, "process");
  assert.match(ROLE_LABEL.device, /hardware I\/O/);
});

test("the map draws a device box with its wire, in a category of its own; the standard library has one too", () => {
  assert.ok(BOUNDARY_ROLES.has("device"));
  assert.equal(ROLE_CATEGORY.device, "device");
  assert.equal(toolProtocol("pysoem", "device").protocol, "EtherCAT");
  assert.equal(toolProtocol("serial", "device").protocol, "serial");
  assert.equal(toolProtocol("somedriver", "device").protocol, "device I/O");
  assert.equal(ARCH_CATEGORY_LABEL.stdlib, "standard library");
});

test("the run floor knows a library is pure only from a table or a person — never from a model", () => {
  const stack = { tools: [
    { tool: "numpy", role: "data", origin: "third-party" },
    { tool: "torch", role: "tensor", origin: "third-party" },
    { tool: "serial", role: "device", origin: "third-party" },
    { tool: "mystery", role: "unknown", origin: "third-party" },
    { tool: "guessed", role: "utility", origin: "third-party", roleStatedSource: "agent" },
    { tool: "stated", role: "utility", origin: "third-party", roleStatedSource: "human" },
  ], byFile: {}, byThread: {} };
  assert.deepEqual(floorPureLibraries(stack), ["numpy", "stated", "torch"]);
});

test("a call's file is the step it hangs off, not the first file that holds the same node id", () => {
  const fix = join(ROOT, "test/fixtures/flow/owner_demo");
  const env = buildPolyglotEnvelope(fix).envelope;
  const ctx = threadContexts(env, fix, [], {});
  const c = [...ctx.byEntry.values()].find((x) => x.contract.seed?.file === "b_main.ts" || String(x.contract.entryPointId ?? "").startsWith("b_main.ts"));
  assert.ok(c, [...ctx.byEntry.keys()].join(", "));
  const call = c.contract.externals.find((x) => x.label === "fileURLToPath");
  assert.ok(call, JSON.stringify(c.contract.externals.map((x) => x.label)));
  assert.equal(call.tool?.tool, "url", `attributed to ${JSON.stringify(call.tool)}`);
});

test("Classify on the map: an estimate first (nothing spent), then answers stored agent-stated for a person", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-device-"));
  after(() => rmSync(tmp, { recursive: true, force: true }));
  cpSync(join(ROOT, "test/fixtures/stack/device_demo"), tmp, { recursive: true });
  const env = buildPolyglotEnvelope(tmp).envelope;
  const stack = buildStackIndex(env, tmp);
  assert.equal(stack.tools.find((t) => t.tool === "serial")?.role, "device", "serial is known; only obscurelib is unclassified");
  let asked = null;
  const ctx = {
    root: () => tmp, envelope: () => env, stack: () => stack, claudeAvailable: () => true, modelLabel: () => "stub",
    run: async (prompt) => { asked = prompt; return JSON.stringify({ classifications: [{ tool: "obscurelib", role: "device", confidence: "medium", definition: "Drives a plant controller.", why: "obscurelib.go(1) beside a serial write" }], unsure: [] }); },
    changed: () => {},
  };
  const est = classifyEstimate(ctx);
  assert.deepEqual([est.ok, est.tools, est.names], [true, 1, ["obscurelib"]]);
  assert.equal(asked, null, "the estimate spends nothing");
  const r = await classifyRun(ctx);
  assert.equal(r.ok, true, r.error);
  assert.match(r.detail, /1 role proposed — a model's classification until a person ratifies it/);
  const c = JSON.parse(readFileSync(join(tmp, ".vibegraph/constraints.json"), "utf-8")).constraints.find((x) => x.policy?.tool === "obscurelib");
  assert.equal(c.source, "agent");
  const after2 = buildStackIndex(env, tmp);
  assert.equal(after2.tools.find((t) => t.tool === "obscurelib")?.role, "device", "the stack reads the stated role");
  assert.ok(!floorPureLibraries(after2).includes("obscurelib"));
});
