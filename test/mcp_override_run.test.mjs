/**
 * B2 (PLAN-v6) — ephemeral upstream override over the MCP wire.
 *
 * Boots dist/server.js on override_demo (a pure chain: base feeds result) and
 * proves the what-if override: a baseline run captures result=16; overriding
 * `base` to 5 captures result=25 — WITHOUT writing the file (the override is
 * ephemeral). Plus the honesty gates: a non-literal value is value-ambiguous,
 * and an override target that isn't a plain-identifier assignment is
 * unsupported-target.
 *
 * Boot: node --test test/mcp_override_run.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4319;
const MCP = `http://localhost:${PORT}/mcp`;

let serverProc = null, tmpDir = null, sessionId = null, nextId = 1;

function sseJson(text) {
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  assert.ok(lines.length > 0, `no SSE data frame: ${text.slice(0, 200)}`);
  return JSON.parse(lines[lines.length - 1].slice("data: ".length));
}
async function rpc(method, params) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!sessionId) sessionId = res.headers.get("mcp-session-id");
  return sseJson(await res.text());
}
async function callTool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  assert.ok(r.result, `tools/call ${name}: ${JSON.stringify(r)}`);
  return JSON.parse(r.result.content?.[0]?.text ?? "{}");
}

const RESULT = "module/chained.fn/result.assign";
const BASE = "module/chained.fn/base.assign";

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-override-test-"));
  fs.copyFileSync(path.join(ROOT, "test", "fixtures", "threads", "override_demo", "calc.py"), path.join(tmpDir, "calc.py"));
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: { ...process.env, PORT: String(PORT), PYTHONPATH: path.join(ROOT, ".pydeps") },
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-override-test", version: "0.0.1" } });
  assert.equal(init.result.serverInfo.name, "vibegraph");
  await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  const deadline = Date.now() + 20_000;
  for (;;) {
    const files = await callTool("vibegraph_list_files", {});
    if (Array.isArray(files) && files.length > 0) break;
    if (Date.now() > deadline) throw new Error("project parse never primed");
    await new Promise((r) => setTimeout(r, 250));
  }
});

after(() => {
  serverProc?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("the tool is registered", async () => {
  const r = await rpc("tools/list", {});
  const names = (r.result.tools ?? []).map((t) => t.name);
  assert.ok(names.includes("vibegraph_run_thread_to_node_override"), names.join(", "));
});

test("baseline (no override) captures result=16", async () => {
  const r = await callTool("vibegraph_run_thread_to_node", { nodeId: RESULT, filePath: "calc.py" });
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "16");
  assert.equal(r.provenance, "real-input");
});

test("overriding base=5 captures result=25 under a synthesized premise; file untouched", async () => {
  const before = fs.readFileSync(path.join(tmpDir, "calc.py"), "utf-8");
  const r = await callTool("vibegraph_run_thread_to_node_override", {
    nodeId: RESULT, overrideNodeId: BASE, value: "5", filePath: "calc.py",
  });
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "25", "double(5) = 25 under the override");
  assert.equal(r.provenance, "synthesized-input", "an override run is never real-input");
  assert.equal(r.override, "base = 5", "the applied override travels with the result");
  assert.equal(fs.readFileSync(path.join(tmpDir, "calc.py"), "utf-8"), before, "the override must not write the file");
});

test("a non-literal override value is value-ambiguous (the literal gate holds)", async () => {
  const r = await callTool("vibegraph_run_thread_to_node_override", {
    nodeId: RESULT, overrideNodeId: BASE, value: "boom()", filePath: "calc.py",
  });
  assert.equal(r.outcome, "value-ambiguous", JSON.stringify(r));
});

test("an override target that isn't a plain-identifier assignment is unsupported-target", async () => {
  const r = await callTool("vibegraph_run_thread_to_node_override", {
    nodeId: RESULT, overrideNodeId: "module/chained.fn/return@0", value: "5", filePath: "calc.py",
  });
  assert.equal(r.outcome, "unsupported-target", JSON.stringify(r));
});
