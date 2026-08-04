/**
 * M-SKILL.4 — sweep over the real wire (MCP tool + WS progress/summary).
 *
 * VG_CLAUDE_BIN points at a stub whose output cites NO node ids, so every
 * generation fails the grounding gate — pinning the honest-failure path:
 * every target lands in `failed` with the refusal reason, none silently
 * missing, and a pre-ratified fresh thread lands in `skipped`.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/mcp_skill_sweep.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { sourceHashOf } from "../src/server/readme_store.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4318;
const MCP = `http://localhost:${PORT}/mcp`;

let serverProc = null, tmpDir = null, ws = null, sessionId = null, nextId = 1;
const pending = new Map();
const progressEvents = [];

function onMessage(raw) {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "skill-sweep-progress") progressEvents.push(msg.payload);
  const q = pending.get(msg.type);
  if (q?.length) q.shift()(msg.payload);
}
function waitFor(type, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const q = pending.get(type) ?? [];
    pending.set(type, q);
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
    q.push((p) => { clearTimeout(t); resolve(p); });
  });
}

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-skill-sweep-"));
  for (const f of ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"]) {
    fs.copyFileSync(path.join(ROOT, "test", "fixtures", "threads", "flask_demo", f), path.join(tmpDir, f));
  }
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PYTHONPATH: path.join(ROOT, ".pydeps"),
      // Ungrounded output (no node ids) → every generation refused at the gate.
      VG_CLAUDE_BIN: `node ${path.join(ROOT, "test", "fixtures", "run_effects", "fake_claude_json.mjs")}`,
      FAKE_SYNTH_RESPONSE: "This prose cites no node ids at all.",
    },
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });
  ws = new WebSocket(`ws://localhost:${PORT}`);
  ws.on("message", onMessage);
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
  const envelope = await waitFor("project-update");

  // Ratify one thread FRESH so the sweep must skip it.
  const thread = envelope.threads.find((t) => t.entryPointId === "db.py:query");
  assert.ok(thread, "db.py:query thread must exist");
  const p = path.join(tmpDir, ".vibegraph", "thread-skills", "db.py_query.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `---\nkey: thread:db.py:query\nentryPointId: db.py:query\nstatus: ratified\nsourceHash: ${sourceHashOf(thread)}\ngeneratedAt: t0\n---\n\n## Purpose\nAlready reviewed. \`module/query.fn\`\n`);

  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "sweep-test", version: "0.0.1" } });
  assert.equal(init.result.serverInfo.name, "vibegraph");
  await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
});

after(() => {
  ws?.close();
  serverProc?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("the sweep tool is registered", async () => {
  const r = await rpc("tools/list", {});
  const names = (r.result.tools ?? []).map((t) => t.name);
  assert.ok(names.includes("vibegraph_sweep_thread_skills"), names.join(", "));
});

test("sweep: every ungrounded target lands in failed (none silently missing); ratified-fresh is skipped", async () => {
  const { text, isError } = await callTool("vibegraph_sweep_thread_skills", {});
  assert.equal(isError, false, text);
  const summary = JSON.parse(text);
  assert.ok(summary.total >= 1, "at least one target on flask_demo");
  assert.equal(summary.drafted.length, 0, "ungrounded prose must never persist");
  assert.equal(summary.failed.length, summary.total, "every target accounted for");
  for (const f of summary.failed) assert.match(f.error, /not grounded/, JSON.stringify(f));
  assert.ok(summary.skipped.includes("db.py:query"), `ratified-fresh skipped: ${JSON.stringify(summary.skipped)}`);
  // and nothing reached disk as a draft
  const dir = path.join(tmpDir, ".vibegraph", "thread-skills");
  assert.deepEqual(fs.readdirSync(dir), ["db.py_query.md"], "no ungrounded file persisted");
  // WS progress mirrored every item to all clients
  assert.equal(progressEvents.length, summary.total);
  assert.ok(progressEvents.every((e) => e.ok === false));
});
