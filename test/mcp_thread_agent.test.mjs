/**
 * D1 (PLAN-v6) — vibegraph_spawn_thread_agent wiring + error honesty.
 *
 * The agent's run needs the claude CLI (same constraint as README / skill /
 * explain generation) and is cost/nondeterministic, so this covers the
 * deterministic seams: the tool is registered, and an unknown thread returns a
 * structured error (never a crash, never a fabricated agent reply).
 *
 * Boot: node --test test/mcp_thread_agent.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4321;
const MCP = `http://localhost:${PORT}/mcp`;

let serverProc = null, tmpDir = null, sessionId = null, nextId = 1, promptLog = null;

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-agent-test-"));
  for (const f of ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"]) {
    fs.copyFileSync(path.join(ROOT, "test", "fixtures", "threads", "flask_demo", f), path.join(tmpDir, f));
  }
  // The agent's run goes through _runReadmeLlm, which is VG_CLAUDE_BIN-
  // stubbable (M-SKILL.4) — so the dispatch seam is testable without ever
  // spawning the real CLI. FAKE_PROMPT_CAPTURE records what actually reached
  // the model, which is how the no-execution rule is asserted end to end.
  promptLog = path.join(tmpDir, "prompts.log");
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: {
      ...process.env, PORT: String(PORT), PYTHONPATH: path.join(ROOT, ".pydeps"),
      VG_CLAUDE_BIN: `node ${path.join(ROOT, "test", "fixtures", "run_effects", "fake_claude_json.mjs")}`,
      FAKE_SYNTH_RESPONSE: "the thread already validates its input",
      FAKE_PROMPT_CAPTURE: promptLog,
    },
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-agent-test", version: "0.0.1" } });
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
  // Files parsing is NOT readiness. Entry-point discovery is a later pass,
  // so waiting only on list_files raced it: every test here dispatches by
  // entry-point id, and on a lost race they all saw []. That made the suite
  // alternate pass/fail run-to-run and looked for months like three broken
  // tests. Wait for the thing the tests actually depend on.
  for (;;) {
    const { text } = await callTool("vibegraph_list_entry_points", {});
    if (JSON.parse(text).length > 0) break;
    if (Date.now() > deadline) throw new Error("entry points never discovered");
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
  assert.ok(names.includes("vibegraph_spawn_thread_agent"), names.join(", "));
});

test("an unknown thread returns a structured error, not a fabricated reply", async () => {
  const { text, isError } = await callTool("vibegraph_spawn_thread_agent", { entryPointId: "nope.py:ghost", task: "do a thing" });
  assert.equal(isError, true, "must be a structured error");
  assert.match(text, /No thread/i);
  // 2026-07-30 sitting: refusing without saying what WOULD work cost a
  // round-trip. The error names the ids the caller could have used.
  assert.match(text, /known ids: .+\.py:/, `error must list valid ids: ${text}`);
});

// 2026-07-30 sitting: the first real dispatch was rejected because the caller
// passed `train:train` — the qualifiedName the UI prints everywhere (chip,
// routed line, plan_work packets) — when only `train.py:train` was accepted.
test("the qualified name the UI shows is accepted, not just the entry-point id", async () => {
  const eps = JSON.parse((await callTool("vibegraph_list_entry_points", {})).text);
  const ep = eps.find((e) => e.id && e.qualifiedName && e.qualifiedName !== e.id);
  assert.ok(ep, `need an entry point whose qualifiedName differs from its id: ${JSON.stringify(eps).slice(0, 200)}`);

  const { text, isError } = await callTool("vibegraph_spawn_thread_agent",
    { entryPointId: ep.qualifiedName, task: "summarise this thread" });
  assert.equal(isError, false, `qualifiedName must resolve: ${text}`);
  const r = JSON.parse(text);
  // It resolves to the CANONICAL id, so downstream consumers see one identity.
  assert.equal(r.entryPointId, ep.id);
  assert.equal(r.escalated, false);
  assert.match(r.result, /already validates its input/); // the stub's reply
});

test("the dispatched prompt tells the agent it cannot run anything", async () => {
  const sent = fs.readFileSync(promptLog, "utf8");
  assert.match(sent, /cannot run code, execute tests, read files, or search the project/);
  assert.match(sent, /Never claim, or imply, that you ran, tested, executed, benchmarked, or grepped/);
  assert.ok(!/read source \/ run \/ ask/.test(sent), "must not offer running as an option");
});
