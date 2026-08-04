/**
 * A2 (PLAN-v6) — vibegraph_blast_radius over the real MCP wire.
 *
 * Boots dist/server.js on flask_demo and proves the reverse index reflects the
 * real cross-file linker:
 *   - db.py:_get_conn  -> 2 dependents (query + insert, both db.py).
 *   - models.py:create_user -> 3 cross-file dependents (create_user_route/app.py,
 *     cmd_create/cli.py, test_create_then_find/test_flow.py), and the affected
 *     threads are non-empty (the create_user_route flow reaches it).
 *
 * Boot: node --test test/mcp_blast_radius.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4314;
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
async function blast(nodeId, filePath) {
  const { text } = await callTool("vibegraph_blast_radius", { nodeId, filePath });
  return JSON.parse(text);
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-blast-test-"));
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
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-blast-test", version: "0.0.1" } });
  assert.equal(init.result.serverInfo.name, "vibegraph");
  await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  // Prime: files parse first, but the threads roll-up (latestThreads, which the
  // `threads` field reads) is extracted asynchronously AFTER — poll the v2.0
  // envelope until threads land, else the blast call races to an empty list.
  const deadline = Date.now() + 25_000;
  for (;;) {
    const { text } = await callTool("vibegraph_get_project_ir", {});
    const env = JSON.parse(text);
    if (Array.isArray(env.threads) && env.threads.length > 0) break;
    if (Date.now() > deadline) throw new Error("project threads never primed");
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
  assert.ok(names.includes("vibegraph_blast_radius"), `tool missing: ${names.join(", ")}`);
});

test("_get_conn — 2 same-file dependents (query + insert)", async () => {
  const r = await blast("module/_get_conn.fn", "db.py");
  assert.equal(r.totals.dependents, 2, JSON.stringify(r.dependents));
  const fns = r.dependents.map((d) => d.enclosingFn).sort();
  assert.deepEqual(fns, ["insert", "query"]);
  assert.ok(r.dependents.every((d) => d.file === "db.py"));
});

test("create_user — 3 cross-file dependents; affected threads non-empty", async () => {
  const r = await blast("module/create_user.fn", "models.py");
  assert.equal(r.totals.dependents, 3, JSON.stringify(r.dependents));
  const route = r.dependents.find((d) => d.enclosingFn === "create_user_route");
  assert.ok(route, "create_user_route must be a dependent");
  assert.equal(route.file, "app.py");
  assert.equal(route.qualifiedTarget, "models:create_user");
  assert.ok(r.dependents.every((d) => d.qualifiedTarget === "models:create_user"));
  // The route flow reaches create_user, so editing it affects ≥1 thread.
  assert.ok(r.totals.threads >= 1, `expected affected threads: ${JSON.stringify(r.threads)}`);
});

test("the honest blind-spot caveat is always present", async () => {
  const r = await blast("module/_get_conn.fn", "db.py");
  assert.ok(r.notes.some((n) => /dynamic dispatch|runtime-bound|NOT in this list/.test(n)), JSON.stringify(r.notes));
});
