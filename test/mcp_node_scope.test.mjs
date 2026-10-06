/**
 * In → Process → Out and "Scope this node" over the MCP wire (2026-10-06).
 * Boots dist/server.js on a copy of test/fixtures/system/views_demo with the
 * stub Claude (test/fixtures/system/fake_claude_scope.mjs). Pinned:
 * vibegraph_node_io answers a box (and names near ids for a wrong one);
 * vibegraph_scope_node stores a PROPOSED scope that changes nothing; a
 * person's ratify (the CLI) merges it; editing a line the scope was drawn
 * from marks it STALE — in node_io, in `scope list` and in architecture.md.
 *
 * Boot: node --test test/mcp_node_scope.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4333;
const MCP = `http://localhost:${PORT}/mcp`;
let serverProc = null, tmpDir = null, proj = null, sessionId = null, nextId = 1;

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
async function tool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  const text = r.result?.content?.[0]?.text ?? "";
  return { isError: !!r.result?.isError, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}
async function until(fn, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 400)); }
}
const cli = (...args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(ROOT, "scripts/cli/main.mjs"), ...args], { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "" } });

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-mcp-scope-"));
  proj = path.join(tmpDir, "p");
  fs.cpSync(path.join(ROOT, "test/fixtures/system/views_demo"), proj, { recursive: true });
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), proj], {
    env: { ...process.env, PORT: String(PORT), VG_CLAUDE_BIN: `node ${path.join(ROOT, "test/fixtures/system/fake_claude_scope.mjs")}` },
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 30_000);
  });
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-scope-test", version: "0.0.1" } });
  assert.equal(init.result.serverInfo.name, "vibegraph");
  await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.ok(await until(async () => !(await tool("vibegraph_node_io", { nodeId: "tool:fetch" })).isError), "the map is ready");
});
after(() => { serverProc?.kill(); if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

test("vibegraph_node_io: a box as in → process → out; a wrong id names the near ones", async () => {
  const d = await tool("vibegraph_node_io", { nodeId: "cluster:scripts:decider" });
  assert.ok(!d.isError, d.text);
  assert.ok(d.json.process.some((p) => p.word === "decide"));
  assert.match(d.json.summary.out, /phase/);
  // the map the GUI draws: the declared store under its plan name
  const store = await tool("vibegraph_node_io", { nodeId: "store:ledger" });
  assert.ok(!store.isError, store.text);
  assert.ok(store.json.in.some((r) => r.label === "order decider"));
  const bad = await tool("vibegraph_node_io", { nodeId: "decider" });
  assert.ok(bad.isError);
  assert.match(bad.text, /did you mean: cluster:scripts:decider/);
});

test("vibegraph_scope_node proposes; a person ratifies; a changed line makes it STALE everywhere", async () => {
  const s = await tool("vibegraph_scope_node", { nodeId: "tool:fetch", note: "what does it return?" });
  assert.ok(!s.isError, s.text);
  assert.equal(s.json.proposed, true);
  assert.ok(s.json.scope.proposed.basis, "the scope records what it was drawn from");
  const before = await tool("vibegraph_node_io", { nodeId: "tool:fetch" });
  assert.ok(before.json.scope?.proposed);
  assert.ok(!before.json.process.some((p) => p.word === "store"), "a proposal changes nothing");
  // ratify is a person's step (their terminal)
  assert.equal(cli("scope", "ratify", "tool:fetch", "--root", proj).status, 0);
  const ratified = await until(async () => { const r = await tool("vibegraph_node_io", { nodeId: "tool:fetch" }); return r.json?.scope?.ratified ? r : null; });
  assert.ok(ratified, "the ratified scope reaches the server");
  assert.equal(ratified.json.scope.ratified.stale, false);
  assert.ok(ratified.json.process.some((p) => p.word === "store" && p.scoped));
  // change the line the scope cites (lib/store.ts:3, the fetch call)
  const f = path.join(proj, "lib/store.ts");
  fs.writeFileSync(f, fs.readFileSync(f, "utf-8").replace("https://ledger.example/", "https://ledger.example/v2/"));
  const stale = await until(async () => { const r = await tool("vibegraph_node_io", { nodeId: "tool:fetch" }); return r.json?.scope?.ratified?.stale ? r : null; });
  assert.ok(stale, "the scope reads STALE once the code under it changed");
  assert.ok(stale.json.process.find((p) => p.word === "store").evidence.some((e) => /STALE/.test(e)));
  const list = cli("scope", "list", "--root", proj);
  assert.equal(list.status, 1);
  assert.match(list.stdout, /tool:fetch: ratified \([^)]*STALE/);
  assert.equal(cli("export", proj).status, 0);
  assert.match(fs.readFileSync(path.join(proj, ".vibegraph/knowledge/architecture.md"), "utf-8"), /ratified, STALE — the code under it changed/);
});
