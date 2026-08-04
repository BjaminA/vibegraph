/**
 * C1 (PLAN-v6) — thread-skill MCP tools over the real wire.
 *
 * Generation needs the `claude` CLI (same constraint as README generation), so
 * this test covers the deterministic seams: both tools are registered, an
 * ungenerated thread reads exists:false, and a skill written to the store
 * (simulating generation + a human ratifying / a stale ratification) reads back
 * over the wire with the correct status + staleness. The fresh+inject path is
 * unit-covered (thread_skill_store + chat_prompt).
 *
 * Boot: node --test test/mcp_thread_skill.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4315;
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
async function getSkill(entryPointId) {
  const { text } = await callTool("vibegraph_get_thread_skill", { entryPointId });
  return JSON.parse(text);
}

// Write a skill file directly into the store (simulating generation + ratify).
function writeSkill(entryPointId, status, sourceHash, body) {
  const slug = entryPointId.replace(/[^A-Za-z0-9._-]/g, "_");
  const p = path.join(tmpDir, ".vibegraph", "thread-skills", `${slug}.md`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `---\nkey: thread:${entryPointId}\nentryPointId: ${entryPointId}\nstatus: ${status}\nsourceHash: ${sourceHash}\ngeneratedAt: 2026-06-29T00:00:00Z\n---\n\n${body}\n`);
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-skill-mcp-"));
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
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-skill-test", version: "0.0.1" } });
  assert.equal(init.result.serverInfo.name, "vibegraph");
  await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
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

test("both thread-skill tools are registered", async () => {
  const r = await rpc("tools/list", {});
  const names = (r.result.tools ?? []).map((t) => t.name);
  assert.ok(names.includes("vibegraph_generate_thread_skill"), names.join(", "));
  assert.ok(names.includes("vibegraph_get_thread_skill"), names.join(", "));
});

test("an ungenerated thread reads exists:false", async () => {
  const r = await getSkill("db.py:query");
  assert.equal(r.exists, false);
  assert.equal(r.entryPointId, "db.py:query");
});

test("a draft skill reads back as draft over the wire", async () => {
  writeSkill("db.py:insert", "draft", "sha256:whatever", "## Purpose\nInserts a row.");
  const r = await getSkill("db.py:insert");
  assert.equal(r.exists, true);
  assert.equal(r.status, "draft");
  assert.match(r.body, /Inserts a row/);
});

test("a ratified skill with a stale hash reads ratified + stale (never silently fresh)", async () => {
  writeSkill("db.py:query", "ratified", "sha256:OLD_HASH", "## Purpose\nReads rows.");
  const r = await getSkill("db.py:query");
  assert.equal(r.status, "ratified");
  assert.equal(r.stale, true, "an old hash must read stale, not fresh");
});
