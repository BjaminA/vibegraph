/**
 * B5 (PLAN-v6) — runtime-assisted resolution over the MCP wire.
 *
 * Boots dist/server.js on observe_demo (eng = make_engine(); eng.run() is a
 * dynamic dispatch) and proves the honest flow: observing a dynamic target
 * inherently runs an UNPROVABLE path (that's the point), so the SM3 floor
 * gates it — the first call returns requires-confirmation + a token; re-calling
 * with the token observes Engine as the runtime target, labelled a runtime
 * sample (never static), with the file untouched. Plus honesty gates: an unsafe
 * receiver is rejected, and a non-dynamic-scoped node declines.
 *
 * Boot: node --test test/mcp_observe_dynamic.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4320;
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
  return JSON.parse(r.result.content?.[0]?.text ?? "{}");
}

const OUT = "module/dispatch.fn/out.assign";

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-observe-test-"));
  fs.copyFileSync(path.join(ROOT, "test", "fixtures", "threads", "observe_demo", "calc.py"), path.join(tmpDir, "calc.py"));
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: { ...process.env, PORT: String(PORT), PYTHONPATH: path.join(ROOT, ".pydeps") },
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-observe-test", version: "0.0.1" } });
  assert.equal(init.result.serverInfo.name, "vibegraph");
  await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  const deadline = Date.now() + 20_000;
  for (;;) {
    const files = await callTool("vibegraph_list_files", {});
    if (Array.isArray(files) && files.length > 0) break;
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
  assert.ok(names.includes("vibegraph_observe_dynamic_target"), names.join(", "));
});

test("a dynamic target inherently requires consent (the floor gates the unprovable path)", async () => {
  const r = await callTool("vibegraph_observe_dynamic_target", { nodeId: OUT, receiver: "eng", filePath: "calc.py" });
  assert.equal(r.outcome, "requires-confirmation", JSON.stringify(r));
  assert.ok(r.effects?.some((e) => e.kind === "dynamic"), "the dynamic dispatch is among the floor offenses");
  assert.ok(typeof r.effectConsentToken === "string" && r.effectConsentToken.length > 0);
  assert.match(r.note, /Runtime sample/);
});

test("with consent, observing reveals Engine as the runtime target — labelled, file untouched", async () => {
  const before = fs.readFileSync(path.join(tmpDir, "calc.py"), "utf-8");
  const refused = await callTool("vibegraph_observe_dynamic_target", { nodeId: OUT, receiver: "eng", filePath: "calc.py" });
  assert.equal(refused.outcome, "requires-confirmation");
  const r = await callTool("vibegraph_observe_dynamic_target", {
    nodeId: OUT, receiver: "eng", filePath: "calc.py", effectConsent: refused.effectConsentToken,
  });
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.match(r.observedTarget ?? "", /Engine/, "the runtime type of eng is Engine");
  assert.match(r.note, /NOT promoted to a static/);
  assert.equal(fs.readFileSync(path.join(tmpDir, "calc.py"), "utf-8"), before, "observation must not write the file");
});

test("an unsafe receiver expression is rejected (no arbitrary code)", async () => {
  const r = await callTool("vibegraph_observe_dynamic_target", { nodeId: OUT, receiver: "eng or boom()", filePath: "calc.py" });
  assert.equal(r.outcome, "value-ambiguous", JSON.stringify(r));
  assert.equal(r.observedTarget, null);
});

test("a node not inside a function declines unsupported-target", async () => {
  const r = await callTool("vibegraph_observe_dynamic_target", { nodeId: "module/Engine.class", receiver: "x", filePath: "calc.py" });
  assert.equal(r.outcome, "unsupported-target", JSON.stringify(r));
});
