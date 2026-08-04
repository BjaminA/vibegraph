/**
 * A1 (PLAN-v6) — vibegraph_thread_blind_spots over the real MCP wire.
 *
 * Boots dist/server.js on a copy of flask_demo (directory mode) and drives the
 * streamable-HTTP MCP tool. Proves the per-thread honesty roll-up the tool
 * builds reflects the real extractor:
 *   - db:query     -> 3 runtimeDispatch (conn/cursor, all locally bound), a db
 *                     effect, no resolution gaps, staticallyComplete.
 *   - models:create_user -> 1 resolutionGap (the unresolved `User` constructor,
 *                     post cross-file link) + a db effect, not staticallyComplete.
 *
 * The seed choice matters: create_user_route's call into models.create_user
 * RESOLVES cross-file on the live (linked) server, so it is NOT a gap — the
 * genuine post-link gap is the `User` class instantiation inside create_user.
 *
 * Boot: node --test test/mcp_blind_spots.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4313;
const MCP = `http://localhost:${PORT}/mcp`;

let serverProc = null;
let tmpDir = null;
let sessionId = null;
let nextId = 1;

function sseJson(text) {
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  assert.ok(lines.length > 0, `no SSE data frame in response: ${text.slice(0, 200)}`);
  return JSON.parse(lines[lines.length - 1].slice("data: ".length));
}

async function rpc(method, params) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!sessionId) sessionId = res.headers.get("mcp-session-id");
  return sseJson(await res.text());
}

async function callTool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  assert.ok(r.result, `tools/call ${name} returned no result: ${JSON.stringify(r)}`);
  return { text: r.result.content?.[0]?.text ?? "", isError: !!r.result.isError };
}

async function blindSpots(seedNodeId, filePath) {
  const { text } = await callTool("vibegraph_thread_blind_spots", { seedNodeId, filePath });
  return JSON.parse(text);
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-bs-test-"));
  for (const f of ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"]) {
    fs.copyFileSync(path.join(ROOT, "test", "fixtures", "threads", "flask_demo", f), path.join(tmpDir, f));
  }
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: { ...process.env, PORT: String(PORT), PYTHONPATH: path.join(ROOT, ".pydeps") },
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (process.env.VG_MCP_DEBUG) {
    serverProc.stdout.on("data", (d) => process.stderr.write(`[srv] ${d}`));
    serverProc.stderr.on("data", (d) => process.stderr.write(`[srv!] ${d}`));
  }
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });
  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-blind-spots-test", version: "0.0.1" },
  });
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
  assert.ok(names.includes("vibegraph_thread_blind_spots"), `tool missing: ${names.join(", ")}`);
});

test("db:query roll-up — runtimeDispatch + a db effect, no gaps, staticallyComplete", async () => {
  const r = await blindSpots("module/query.fn", "db.py");
  assert.equal(r.totals.runtimeDispatch, 3, JSON.stringify(r.totals));
  assert.equal(r.totals.resolutionGaps, 0);
  assert.equal(r.totals.uncaptured, 0);
  assert.equal(r.staticallyComplete, true, "no gaps + no uncaptured");
  // The conn-bound dynamics name how their receiver was bound (the honesty detail).
  assert.ok(
    r.runtimeDispatch.some((d) => d.receiverBoundFrom === "_get_conn"),
    "a dynamic terminal should report its receiver came from _get_conn",
  );
  // The execute is a known db effect (separate axis, joined from the per-file IR).
  assert.ok(r.effects.some((e) => e.effectKind === "db"), JSON.stringify(r.effects));
});

test("models:create_user roll-up — the unresolved User constructor is a post-link resolution gap", async () => {
  const r = await blindSpots("module/create_user.fn", "models.py");
  assert.equal(r.totals.resolutionGaps, 1, JSON.stringify(r.totals));
  assert.equal(r.totals.runtimeDispatch, 0);
  assert.equal(r.staticallyComplete, false, "an unresolved gap makes the thread incomplete");
  assert.ok(r.resolutionGaps.some((g) => g.label.includes("User")), JSON.stringify(r.resolutionGaps));
});

test("a sibling thread's cross-file call RESOLVES (no false gap) — link pass honoured", async () => {
  // create_user_route calls models.create_user, which links cross-file → NOT a
  // resolution gap. Guards against re-flattening resolved calls into blind spots.
  const r = await blindSpots("module/create_user_route.fn", "app.py");
  assert.equal(r.totals.resolutionGaps, 0, JSON.stringify(r.totals));
  assert.equal(r.staticallyComplete, true);
});
