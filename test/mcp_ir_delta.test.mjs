/**
 * B3 (PLAN-v6) — the structural IR delta rides the edit response.
 *
 * Boots dist/server.js on flask_demo and proves a compose_insert / rewrite
 * returns a structural delta the agent can self-verify against: inserting a new
 * function reports it in nodesAdded; deleting it reports it in nodesRemoved.
 *
 * Boot: node --test test/mcp_ir_delta.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4316;
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
// The tool returns "<msg>\nStructural delta: <summary>\n<full json>". Parse the
// full delta object (everything from the first '{' after the summary line).
function parseDelta(text) {
  const marker = "Structural delta:";
  const i = text.indexOf(marker);
  assert.ok(i !== -1, `no structural delta in response: ${text}`);
  const after = text.slice(i + marker.length);
  const firstBrace = after.indexOf("{");
  const full = after.slice(after.indexOf("{", after.indexOf("\n", firstBrace)));
  return JSON.parse(full);
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-delta-test-"));
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
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-delta-test", version: "0.0.1" } });
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

test("compose_insert reports the new function in the structural delta", async () => {
  const ins = await callTool("vibegraph_compose_insert", {
    mode: "before", anchorNodeId: "module/insert.fn", filePath: "db.py",
    source: "def vg_delta_probe():\n    return 1\n",
  });
  assert.equal(ins.isError, false, ins.text);
  const d = parseDelta(ins.text);
  assert.ok(d.nodesAdded.some((x) => x.id === "module/vg_delta_probe.fn"), JSON.stringify(d.nodesAdded));
  assert.equal(d.noStructuralChange, false);

  // Cleanup: deleting it reports the removal in the delta.
  const del = await callTool("vibegraph_rewrite_node", {
    nodeId: "module/vg_delta_probe.fn", op: "delete_node", filePath: "db.py", payload: {},
  });
  assert.equal(del.isError, false, del.text);
  const d2 = parseDelta(del.text);
  assert.ok(d2.nodesRemoved.some((x) => x.id === "module/vg_delta_probe.fn"), JSON.stringify(d2.nodesRemoved));
});

test("M-FS5: an edit's delta never reports untouched cross-file edges as removed", async () => {
  // models.py carries reference edges into db.py (create_user -> insert,
  // list_users -> query). Rewriting ONE function used to diff the pre-edit
  // LINKED IR against the fresh UNLINKED solo re-parse, so every reference
  // edge out of models.py appeared in edgesRemoved — a transient lie the
  // in-app agent burned a chat turn investigating (full-scope review P2).
  // The edit path now re-links before diffing.
  const src = [
    "def list_users():",
    '    """All users, newest first."""',
    "    rows = query()",
    "    return rows",
  ].join("\n");
  const r = await callTool("vibegraph_rewrite_node", {
    nodeId: "module/list_users.fn", op: "replace_node", filePath: "models.py",
    payload: { newSource: src },
  });
  assert.equal(r.isError, false, r.text);
  const d = parseDelta(r.text);
  const refsRemoved = d.edgesRemoved.filter((e) => e.type === "reference");
  assert.deepEqual(
    refsRemoved.filter((e) => !e.source.startsWith("module/list_users.fn")),
    [],
    `untouched functions' reference edges reported as removed: ${JSON.stringify(refsRemoved)}`,
  );
  // The edited function's own cross-file call survives the re-link too:
  // list_users still calls db.query, so its reference edge must not be
  // reported removed either.
  assert.deepEqual(refsRemoved, [], `list_users' surviving db.query edge reported removed: ${JSON.stringify(refsRemoved)}`);
});
