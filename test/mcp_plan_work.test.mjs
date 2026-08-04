/**
 * vibegraph_plan_work over the real MCP wire.
 *
 * Boots dist/server.js on flask_demo and proves the decomposition reads the
 * LIVE envelope: a task naming `db.query` and `list_users_route` yields
 * packets for both threads with the called thread (db.py:query) ordered
 * first, boundary + skill annotations present, zero-match and
 * unmatched-token honesty over the wire.
 *
 * Boot: node --test test/mcp_plan_work.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4322;
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
async function planWork(task, maxPackets) {
  const { text } = await callTool("vibegraph_plan_work", { task, ...(maxPackets ? { maxPackets } : {}) });
  return JSON.parse(text);
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-plan-work-test-"));
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
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-plan-work-test", version: "0.0.1" } });
  assert.equal(init.result.serverInfo.name, "vibegraph");
  await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  // Threads land asynchronously after the file parses — poll the envelope.
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
  assert.ok(names.includes("vibegraph_plan_work"), `tool missing: ${names.join(", ")}`);
});

test("a two-thread task decomposes dependencies-first with full annotations", async () => {
  const p = await planWork("add pagination to `db.query` and surface it in `list_users_route`");
  const ids = p.packets.map((x) => x.entryPointId);
  assert.ok(ids.includes("db.py:query"), JSON.stringify(ids));
  assert.ok(ids.includes("app.py:list_users_route"), JSON.stringify(ids));
  // The route thread walks query's head → db.py:query builds first.
  assert.ok(ids.indexOf("db.py:query") < ids.indexOf("app.py:list_users_route"), ids.join(", "));
  const route = p.packets.find((x) => x.entryPointId === "app.py:list_users_route");
  assert.ok(route.boundaries.dependsOn.includes("db.py:query"), JSON.stringify(route.boundaries));
  assert.equal(route.kind, "route");
  // No skills seeded → every packet says so, with the next action named.
  for (const pk of p.packets) {
    assert.equal(pk.skill.status, "none");
    assert.match(pk.skill.note, /vibegraph_generate_thread_skill/);
  }
  assert.ok(p.verification.some((v) => v.includes("vibegraph_spawn_thread_agent")));
});

test("zero matches: honest empty plan with guidance, never an error", async () => {
  const p = await planWork("make everything nicer please");
  assert.deepEqual(p.packets, []);
  assert.match(p.planNote, /No thread's remit matched/);
});

test("unmatched code-shaped tokens are NAMED as coverage gaps", async () => {
  const p = await planWork("connect `db.query` to the new `warp_drive` subsystem");
  assert.ok(p.packets.some((x) => x.entryPointId === "db.py:query"));
  assert.ok(p.unmatchedTokens.includes("`warp_drive`"), JSON.stringify(p.unmatchedTokens));
});
