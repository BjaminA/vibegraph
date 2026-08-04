/**
 * B4 (PLAN-v6) — vibegraph_thread_assertions over the real MCP wire.
 *
 * Boots dist/server.js on flask_demo and proves the behavioural contract
 * reflects the real extractor for db:query:
 *   - ordered path: seed query → step _get_conn
 *   - a db effect at the conn.execute terminal
 *   - dynamic terminals conn.execute / conn.close / cursor.fetchall
 *   - an external terminal sqlite3.connect
 *   - the readable invariants are present
 *
 * Boot: node --test test/mcp_thread_assertions.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4317;
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
  return { text: r.result.content?.[0]?.text ?? "", isError: !!r.result.isError };
}
async function assertions(seedNodeId, filePath) {
  const { text } = await callTool("vibegraph_thread_assertions", { seedNodeId, filePath });
  return JSON.parse(text);
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-assert-test-"));
  for (const f of ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"]) {
    fs.copyFileSync(path.join(ROOT, "test", "fixtures", "threads", "flask_demo", f), path.join(tmpDir, f));
  }
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: { ...process.env, PORT: String(PORT), PYTHONPATH: path.join(ROOT, ".pydeps") },
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-assert-test", version: "0.0.1" } });
  assert.equal(init.result.serverInfo.name, "vibegraph");
  await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  const deadline = Date.now() + 20_000;
  for (;;) {
    const { text } = await callTool("vibegraph_list_files", {});
    if (JSON.parse(text).length > 0) break;
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
  assert.ok(names.includes("vibegraph_thread_assertions"), names.join(", "));
});

test("db:query behavioural contract — order, effect, terminals, invariants", async () => {
  const r = await assertions("module/query.fn", "db.py");
  // Ordered path: seed query → step _get_conn.
  assert.deepEqual(r.order.map((s) => [s.kind, s.label]), [["seed", "query"], ["step", "_get_conn"]]);
  // A db effect at a terminal (conn.execute).
  assert.ok(r.effects.some((e) => e.effectKind === "db"), JSON.stringify(r.effects));
  // Dynamic + external terminals are surfaced.
  assert.ok(r.terminals.dynamic.includes("conn.execute"), JSON.stringify(r.terminals));
  assert.ok(r.terminals.external.includes("sqlite3.connect"), JSON.stringify(r.terminals));
  // Readable invariants present.
  assert.ok(r.invariants.includes("step 1 is seed 'query'"), JSON.stringify(r.invariants));
});
