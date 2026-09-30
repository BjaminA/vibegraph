// A module-seeded thread's seed opens and saves (reported 2026-09-30: the
// tooltip on "decision-tree.ts", a thread seeded on the MODULE, said "Node
// not found"). "module" is a pseudo node — no IR node carries it — so the
// edit handlers now treat it as the whole file, the way getNodeSource and the
// MCP replace_node already did; the save routes to replace_module_body.
//
//   node --test test/module_seed_edit.test.mjs   (needs dist/ built)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4331;
const SCRIPT = "#!/usr/bin/env python3\nimport sys\n\nprint(sys.argv)\n";

let serverProc = null;
let tmpDir = null;
let ws = null;
const pending = new Map();
function waitFor(type, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const q = pending.get(type) ?? [];
    pending.set(type, q);
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
    q.push((p) => { clearTimeout(t); resolve(p); });
  });
}
const send = (type, payload) => ws.send(JSON.stringify({ type, payload }));

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-module-seed-"));
  fs.writeFileSync(path.join(tmpDir, "job.py"), SCRIPT);
  fs.writeFileSync(path.join(tmpDir, "lib.py"), "def f():\n    return 1\n");
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: { ...process.env, PORT: String(PORT), PYTHONPATH: path.join(ROOT, ".pydeps") },
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });
  ws = new WebSocket(`ws://localhost:${PORT}`);
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    const q = pending.get(msg.type);
    if (q?.length) q.shift()(msg.payload);
  });
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
  await waitFor("project-update");
});

after(() => {
  ws?.close();
  serverProc?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("opening the module seed shows the whole file", async () => {
  const reply = waitFor("edit-node-source");
  send("edit-node-open", { nodeId: "module", filePath: "job.py" });
  const p = await reply;
  assert.equal(p.error, undefined, p.error);
  assert.equal(p.source, SCRIPT);
});

test("saving the module seed rewrites the whole file through the chokepoint", async () => {
  const next = SCRIPT.replace("print(sys.argv)", "print(len(sys.argv))");
  const reply = waitFor("edit-node-saved");
  send("edit-node-save", { nodeId: "module", filePath: "job.py", newSource: next });
  const p = await reply;
  assert.equal(p.success, true, p.error);
  assert.match(fs.readFileSync(path.join(tmpDir, "job.py"), "utf-8"), /print\(len\(sys\.argv\)\)/);
});

// ── the same answer through every other door (findNode knows "module" now) ──
let sessionId = null;
let rpcId = 1;
async function rpc(method, params) {
  const res = await fetch(`http://localhost:${PORT}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
  });
  if (!sessionId) sessionId = res.headers.get("mcp-session-id");
  const lines = (await res.text()).split("\n").filter((l) => l.startsWith("data: "));
  return JSON.parse(lines[lines.length - 1].slice(6));
}
async function tool(name, args) {
  if (rpcId === 1) {
    await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "module-seed-test", version: "0" } });
    await fetch(`http://localhost:${PORT}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  }
  const r = await rpc("tools/call", { name, arguments: args });
  return r.result?.content?.[0]?.text ?? JSON.stringify(r);
}

test("compose on the module: after appends, before says there is no before", async () => {
  const after = await tool("vibegraph_compose_insert", { mode: "after", anchorNodeId: "module", source: "print('done')\n", filePath: "job.py" });
  assert.doesNotMatch(after, /Node not found/, after);
  assert.match(fs.readFileSync(path.join(tmpDir, "job.py"), "utf-8"), /print\("done"\)|print\('done'\)\s*$/);
  const before = await tool("vibegraph_compose_insert", { mode: "before", anchorNodeId: "module", source: "x = 1\n", filePath: "job.py" });
  assert.match(before, /nothing comes before it/);
});

test("rename, run-to-here and Observe on the module refuse with the reason, not a not-found", async () => {
  const rename = await tool("vibegraph_rewrite_node", { nodeId: "module", op: "rename_symbol", payload: { newName: "x" }, filePath: "job.py" });
  assert.match(rename, /whole file, not a definition/);
  const run = await tool("vibegraph_run_thread_to_node", { nodeId: "module", filePath: "job.py" });
  assert.match(run, /unsupported-target/);
  assert.match(run, /whole script/);
  assert.doesNotMatch(run, /not found/i);
  const observe = await tool("vibegraph_observe_dynamic_target", { nodeId: "module", receiver: "sys", filePath: "job.py" });
  assert.match(observe, /whole script, not a call site/);
});

test("a real missing node still says so", async () => {
  const reply = waitFor("edit-node-source");
  send("edit-node-open", { nodeId: "module/nope.fn", filePath: "lib.py" });
  assert.equal((await reply).error, "Node not found");
});
