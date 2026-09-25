/**
 * M-PROVIDER — the Ollama shim and the endpoint probe, pinned against a
 * FAKE Ollama server (plain node http) and a minimal in-process MCP server
 * (the real SDK, one `vibegraph_echo` tool). No real model, no real claude.
 *
 * Proves:
 *   * the shim accepts the claude -p argv the callers pass (prefix args,
 *     -p, --output-format json, --mcp-config, --disallowedTools, --max-turns,
 *     prompt last) and prints the claude result JSON;
 *   * MCP tools are offered under the prompts' `mcp__vibegraph__` names, a
 *     tool call round-trips through MCP, and the result reaches the model;
 *   * --max-turns bounds the tool loop (a model that never stops calling
 *     tools ends with the budget note, exit 0 — the server escalates it);
 *   * an unreachable endpoint exits 1 (callers read "no result");
 *   * probeOllamaEndpoint reports version + models + tok/s, refuses a bad
 *     URL, and names a model the server does not have.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/ollama_shim.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { probeOllamaEndpoint } from "../src/server/model_store.ts";
import { resolveClaudeBin, setModelTiers, setShimPath } from "../src/server/run/synth_args.ts";
import { DEFAULT_TIERS, sanitiseTiers } from "../src/shared/model_tiers.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHIM = join(ROOT, "scripts", "vg_ollama_shim.mjs");

// ── a fake Ollama: scripted /api/chat behaviour per model name ──────────
const seen = { chats: [], generates: 0 };
let fakeOllama, fakePort;
function scriptedReply(model, messages) {
  const lastRole = messages[messages.length - 1]?.role;
  if (model === "tooly") {
    // call the echo tool once, then answer with what it said
    if (lastRole === "user") {
      return { role: "assistant", content: "", tool_calls: [{ function: { name: "mcp__vibegraph__vibegraph_echo", arguments: { text: "ping" } } }] };
    }
    const toolMsg = messages.find((m) => m.role === "tool");
    return { role: "assistant", content: `tool said: ${toolMsg?.content}\n\`\`\`vg-packet-result\n{"outcome":"done","summary":"echoed"}\n\`\`\`` };
  }
  if (model === "texty") {
    // writes the call as text (the small-model habit); after the executed result arrives, answers for real
    if (!messages.some((m) => m.role === "tool")) {
      return { role: "assistant", content: 'I will call the tool.\n```json\n{"name": "vibegraph_echo", "arguments": {"text": "pseudo"}}\n```\nDone.\n```vg-packet-result\n{"outcome":"done","summary":"claimed before doing"}\n```' };
    }
    const toolMsg = messages.find((m) => m.role === "tool");
    return { role: "assistant", content: `real answer after ${toolMsg?.content}` };
  }
  if (model === "quoty") {
    // the docstring habit: a code payload with UNESCAPED triple quotes inside the JSON text
    if (!messages.some((m) => m.role === "tool")) {
      return { role: "assistant", content: '```json\n{"name": "vibegraph_echo", "arguments": {"text": "def f():\\n    """doc string"""\\n    return 1"}}\n```' };
    }
    return { role: "assistant", content: `got ${messages.find((m) => m.role === "tool")?.content}` };
  }
  if (model === "looper") {
    return { role: "assistant", content: "still working", tool_calls: [{ function: { name: "vibegraph_echo", arguments: { text: "again" } } }] };
  }
  return { role: "assistant", content: `plain answer to: ${messages[0]?.content?.slice(0, 20)}` };
}
before(async () => {
  fakeOllama = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url === "/api/version") return json({ version: "0.9.3-fake" });
      if (req.url === "/api/tags") return json({ models: [{ name: "tooly" }, { name: "looper" }, { name: "plain" }, { name: "texty" }] });
      if (req.url === "/api/generate") { seen.generates++; return json({ response: "OK", eval_count: 4, eval_duration: 200_000_000, load_duration: 1_500_000_000 }); }
      if (req.url === "/api/chat") {
        const parsed = JSON.parse(body);
        seen.chats.push(parsed);
        return json({ model: parsed.model, message: scriptedReply(parsed.model, parsed.messages), done: true });
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => fakeOllama.listen(0, "127.0.0.1", r));
  fakePort = fakeOllama.address().port;
});
after(() => fakeOllama?.close());

// ── a minimal MCP server with one tool, on the SDK's streamable transport ──
let mcpHttp, mcpUrl;
const echoed = [];
before(async () => {
  const sessions = new Map();
  mcpHttp = createServer(async (req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      const parsed = body ? JSON.parse(body) : null;
      const sid = req.headers["mcp-session-id"];
      let s = sid ? sessions.get(sid) : undefined;
      if (!s) {
        const server = new McpServer({ name: "fake-vibegraph", version: "0" });
        server.registerTool("vibegraph_echo", { description: "echo", inputSchema: { text: z.string() } }, async ({ text }) => {
          echoed.push(text);
          return { content: [{ type: "text", text: `echo:${text}` }] };
        });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => `s${sessions.size + 1}`, onsessioninitialized: (id) => sessions.set(id, { transport, server }) });
        await server.connect(transport);
        s = { transport, server };
      }
      await s.transport.handleRequest(req, res, parsed);
    });
  });
  await new Promise((r) => mcpHttp.listen(0, "127.0.0.1", r));
  mcpUrl = `http://127.0.0.1:${mcpHttp.address().port}/mcp`;
});
after(() => mcpHttp?.close());

function runShim(args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SHIM, ...args], { env: { ...process.env, ...env }, timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}
const claudeArgs = (mcpConfig, prompt, extra = []) => [
  "-p", "--output-format", "json", "--strict-mcp-config", "--mcp-config", mcpConfig,
  "--dangerously-skip-permissions", "--disallowedTools", "Edit,Write,MultiEdit,NotebookEdit", ...extra, "--", prompt,
];

test("the shim speaks the claude -p contract and answers without tools when the MCP config is empty", async () => {
  const r = await runShim(["--ollama-endpoint", `http://127.0.0.1:${fakePort}`, "--ollama-model", "plain", ...claudeArgs('{"mcpServers":{}}', "hello there")]);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.is_error, false);
  assert.match(out.result, /^plain answer to: hello there/);
  assert.match(out.session_id, /^ollama-\d+$/);
  const last = seen.chats[seen.chats.length - 1];
  assert.equal(last.tools, undefined, "no MCP server → no tools offered");
  assert.equal(last.options.num_ctx, 16384);
});

test("MCP tools are offered under the prompts' names and a tool call round-trips through MCP", async () => {
  const cfg = JSON.stringify({ mcpServers: { vibegraph: { type: "http", url: mcpUrl } } });
  const r = await runShim(["--ollama-endpoint", `http://127.0.0.1:${fakePort}`, "--ollama-model", "tooly", ...claudeArgs(cfg, "use the tool", ["--max-turns", "25"])]);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.match(out.result, /tool said: echo:ping/);
  assert.match(out.result, /```vg-packet-result/);
  assert.deepEqual(echoed.slice(-1), ["ping"]);
  const withTools = seen.chats.filter((c) => c.model === "tooly");
  assert.ok(withTools[0].tools.some((t) => t.function.name === "mcp__vibegraph__vibegraph_echo"), "prefixed name offered");
  assert.equal(withTools[0].tools[0].function.parameters.type, "object");
  const toolMsg = withTools[1].messages.find((m) => m.role === "tool");
  assert.equal(toolMsg.content, "echo:ping");
});

test("--max-turns bounds a model that never stops calling tools; an unprefixed call still maps to the MCP tool", async () => {
  const cfg = JSON.stringify({ mcpServers: { vibegraph: { type: "http", url: mcpUrl } } });
  const before = echoed.length;
  const r = await runShim(["--ollama-endpoint", `http://127.0.0.1:${fakePort}`, "--ollama-model", "looper", ...claudeArgs(cfg, "loop", ["--max-turns", "3"])]);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.turns, 3);
  assert.equal(echoed.length - before, 2, "one tool call per turn, but the LAST turn is the report turn — no tool runs there");
  assert.equal(out.result, "still working", "the last assistant text is the result — no packet block, so the server will escalate it");
  const last = seen.chats.filter((c) => c.model === "looper").pop();
  assert.match(last.messages[last.messages.length - 1].content, /TURN BUDGET SPENT\. Do not call any more tools/);
});

test("a tool call WRITTEN AS TEXT is executed, the premature result block is not accepted, and the model answers again with the real result", async () => {
  const cfg = JSON.stringify({ mcpServers: { vibegraph: { type: "http", url: mcpUrl } } });
  const before = echoed.length;
  const r = await runShim(["--ollama-endpoint", `http://127.0.0.1:${fakePort}`, "--ollama-model", "texty", ...claudeArgs(cfg, "go")]);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.turns, 2);
  assert.deepEqual(echoed.slice(before), ["pseudo"], "the JSON block named a known tool → executed once");
  assert.equal(out.result, "real answer after echo:pseudo", "the text that CLAIMED completion was not the result");
  const second = seen.chats.filter((c) => c.model === "texty")[1];
  assert.equal(second.messages.filter((m) => m.role === "tool").length, 1);
  assert.match(second.messages[second.messages.length - 1].content, /FIRST tool call you wrote as JSON was EXECUTED; its result is above/);
});

test("a text-written call whose code payload carries unescaped quotes is repaired and executed", async () => {
  const cfg = JSON.stringify({ mcpServers: { vibegraph: { type: "http", url: mcpUrl } } });
  const before = echoed.length;
  const r = await runShim(["--ollama-endpoint", `http://127.0.0.1:${fakePort}`, "--ollama-model", "quoty", ...claudeArgs(cfg, "go")]);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(echoed.length - before, 1);
  assert.equal(echoed[echoed.length - 1], 'def f():\n    """doc string"""\n    return 1', "the quotes survived as content");
  assert.match(out.result, /^got echo:def f\(\):/);
});

test("an unreachable endpoint exits 1 — callers read 'no result' and stay honest", async () => {
  const r = await runShim(["--ollama-endpoint", "http://127.0.0.1:9", "--ollama-model", "plain", ...claudeArgs('{"mcpServers":{}}', "hi")]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /model error/);
});

test("resolveClaudeBin routes an ollama tier to the shim with its endpoint/model, ignores VG_CLAUDE_BIN for it, and labels it", () => {
  const prev = process.env.VG_CLAUDE_BIN;
  process.env.VG_CLAUDE_BIN = "node /stub.mjs";
  setShimPath("/repo/scripts/vg_ollama_shim.mjs");
  setModelTiers(sanitiseTiers({
    thinking: "claude-opus-5", routine: "claude-sonnet-5", worker: "match",
    local: { endpoint: "http://localhost:11434/", model: "qwen2.5-coder:7b" },
    routes: { worker: { provider: "ollama" }, routine: { provider: "ollama", model: "qwen3:8b", endpoint: "http://10.0.0.5:11434" }, thinking: { provider: "command", command: "  node /my/shim.mjs --flag  " } },
  }));
  try {
    const w = resolveClaudeBin("worker");
    assert.equal(w.cmd, process.execPath);
    assert.deepEqual(w.args, ["/repo/scripts/vg_ollama_shim.mjs", "--ollama-endpoint", "http://localhost:11434", "--ollama-model", "qwen2.5-coder:7b"]);
    assert.equal(w.provider, "ollama");
    assert.equal(w.label, "ollama:qwen2.5-coder:7b@http://localhost:11434");
    assert.equal(w.timeoutMs, 1_800_000, "a local worker gets the long budget");
    const r = resolveClaudeBin("routine");
    assert.deepEqual(r.args.slice(1), ["--ollama-endpoint", "http://10.0.0.5:11434", "--ollama-model", "qwen3:8b"], "per-tier endpoint/model override the local defaults");
    const t = resolveClaudeBin("thinking");
    assert.equal(t.cmd, "node");
    assert.deepEqual(t.args, ["/my/shim.mjs", "--flag"]);
    assert.equal(t.provider, "command");
    assert.equal(t.label, "command:node");
    // no tier = unrouted = claude with the stub, as before
    assert.equal(resolveClaudeBin().cmd, "node");
    assert.deepEqual(resolveClaudeBin().args, ["/stub.mjs"]);
  } finally {
    if (prev === undefined) delete process.env.VG_CLAUDE_BIN; else process.env.VG_CLAUDE_BIN = prev;
    setModelTiers(DEFAULT_TIERS);
  }
});

test("probeOllamaEndpoint: version + models + tok/s; a bad URL is refused; an absent model is named", async () => {
  const ep = `http://127.0.0.1:${fakePort}`;
  const ok = await probeOllamaEndpoint(ep, "plain");
  assert.equal(ok.ok, true);
  assert.equal(ok.version, "0.9.3-fake");
  assert.deepEqual(ok.models, ["tooly", "looper", "plain", "texty"]);
  assert.equal(ok.tokPerSec, 20);
  assert.equal(ok.loadSeconds, 1.5);
  assert.equal(ok.error, undefined);
  const noModel = await probeOllamaEndpoint(ep + "/");
  assert.equal(noModel.ok, true); assert.equal(noModel.endpoint, ep, "trailing slash normalised"); assert.equal(noModel.tokPerSec, undefined);
  const missing = await probeOllamaEndpoint(ep, "nope:1b");
  assert.equal(missing.ok, true); assert.match(missing.error, /not on this server/);
  const bad = await probeOllamaEndpoint("ftp://x/", "plain");
  assert.equal(bad.ok, false); assert.match(bad.error, /http\(s\) URL/);
  const creds = await probeOllamaEndpoint("http://user:pw@localhost:11434");
  assert.equal(creds.ok, false);
  const down = await probeOllamaEndpoint("http://127.0.0.1:9");
  assert.equal(down.ok, false); assert.match(down.error, /unreachable/);
});
