/**
 * Scope / explain honesty: when the headless CLI cannot answer, the error
 * says WHY. Measured on 2026-09-21: with an expired login the tooltip's
 * Scope button read "explanation returned nothing" while the CLI was
 * answering "Failed to authenticate: OAuth session expired" — the gen runner
 * mapped every failure to null and the reason never left it. The fake CLI
 * answers the way the real one does on that failure (an is_error envelope,
 * exit 1); the tool's error must carry that text.
 *
 * Boot: node --test test/mcp_explain_failure.test.mjs   (needs dist/ built)
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
const AUTH_FAILURE = "Failed to authenticate: OAuth session expired and could not be refreshed";

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

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-explain-failure-test-"));
  for (const f of ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"]) {
    fs.copyFileSync(path.join(ROOT, "test", "fixtures", "threads", "flask_demo", f), path.join(tmpDir, f));
  }
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: {
      ...process.env, PORT: String(PORT), PYTHONPATH: path.join(ROOT, ".pydeps"),
      VG_CLAUDE_BIN: `node ${path.join(ROOT, "test", "fixtures", "run_effects", "fake_claude_json.mjs")}`,
      FAKE_IS_ERROR: AUTH_FAILURE,
    },
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-explain-failure-test", version: "0.0.1" } });
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

test("a CLI that cannot answer leaves its reason in the explain error — never a bare 'returned nothing'", async () => {
  const { text } = await callTool("vibegraph_explain_node", { nodeId: "module/list_users.fn", filePath: "models.py" });
  const r = JSON.parse(text);
  assert.equal(r.interpretation, null, "no fabricated interpretation");
  assert.match(r.error ?? "", /explanation returned nothing — claude exited 1: Failed to authenticate/, r.error);
  assert.match(r.attribution, /NOT a resolved fact/, "the attribution travels even on error");
});
