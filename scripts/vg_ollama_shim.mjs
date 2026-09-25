#!/usr/bin/env node
/**
 * M-PROVIDER — the Ollama shim: a local model behind the `claude -p` contract.
 *
 * VibeGraph spawns every one-shot reasoning job and every work-run worker
 * as `claude -p … <prompt>` and reads `{result}` JSON back. This script
 * accepts that exact argv, runs the prompt against a LOCAL Ollama server
 * instead (tool calling included, through the run's MCP endpoint), and
 * prints the same JSON — so no call site in the server changes when a tier
 * is routed to a local model.
 *
 * Contract honoured (what the callers pass):
 *   --ollama-endpoint URL --ollama-model NAME   (prefix args from the resolver)
 *   -p  --output-format json  --strict-mcp-config
 *   --mcp-config '<json>'     the vibegraph MCP server (may be empty)
 *   --dangerously-skip-permissions
 *   --disallowedTools A,B     accepted and ignored — this shim has NO native
 *                             tools; the only tools it can ever call are the
 *                             MCP ones, which is the floor the flag exists for
 *   --max-turns N             the tool-call loop budget (default 25)
 *   --model / --effort        claude-only; accepted and ignored
 *   [--] <prompt>             the prompt is the LAST positional
 *
 * Output: `{"result": "<final text>", "is_error": false, "session_id": "…"}`
 * on stdout, exit 0. An unreachable endpoint or a model error exits 1 with
 * the reason on stderr — callers already treat a non-zero exit as "no
 * result" and stay honest (an unavailable brief, an escalated packet).
 *
 * Tools: MCP tools are offered to the model under the SAME names the
 * prompts use (`mcp__vibegraph__<tool>`); a call with or without the prefix
 * maps back to the MCP tool. Tool results ride back as `role: "tool"`
 * messages. The loop ends when the model answers without tool calls, or
 * when the turn budget is spent (the last assistant text is the result —
 * a worker that ran out of turns produces no vg-packet-result block and
 * the server escalates it, exactly as with a claude worker).
 *
 * Env: VG_OLLAMA_NUM_CTX (default 16384), VG_OLLAMA_TEMPERATURE (0.2),
 *      VG_OLLAMA_TOOLS (comma-separated bare tool names to offer — a small
 *      model copes better with five tools than twenty-five; default: all),
 *      VG_OLLAMA_TRACE=1 (one stderr line per turn / tool call).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_TOOL_PREFIX = "mcp__vibegraph__";

function parseArgv(argv) {
  const valued = new Set([
    "--ollama-endpoint", "--ollama-model", "--mcp-config", "--max-turns", "--output-format",
    "--input-format", "--disallowedTools", "--allowedTools", "--model", "--effort", "--resume",
    "--append-system-prompt", "--system-prompt",
  ]);
  const out = { flags: {}, positionals: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { out.positionals.push(...argv.slice(i + 1)); break; }
    if (valued.has(a)) { out.flags[a] = argv[i + 1] ?? ""; i++; continue; }
    if (a.startsWith("-")) { out.flags[a] = true; continue; }
    out.positionals.push(a);
  }
  return out;
}

function fail(message, code = 1) {
  process.stderr.write(`vg_ollama_shim: ${message}\n`);
  process.exit(code);
}

const { flags, positionals } = parseArgv(process.argv.slice(2));
const endpoint = String(flags["--ollama-endpoint"] ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
const model = String(flags["--ollama-model"] ?? "");
const maxTurns = Math.max(1, Number(flags["--max-turns"] ?? 25) || 25);
const prompt = positionals.length ? positionals[positionals.length - 1] : "";
if (!model) fail("--ollama-model is required");
if (!prompt) fail("no prompt (the prompt is the last positional)");
const numCtx = Number(process.env.VG_OLLAMA_NUM_CTX ?? 16384) || 16384;
const temperature = Number(process.env.VG_OLLAMA_TEMPERATURE ?? 0.2);
// VG_OLLAMA_TRACE=1 — one stderr line per turn / tool call, so a run's
// worker behaviour can be read back (the server keeps stdout only).
const trace = process.env.VG_OLLAMA_TRACE === "1"
  ? (line) => process.stderr.write(`[vg_ollama_shim] ${line}\n`)
  : () => {};

// ── MCP tools (optional: an empty mcpServers record means none) ────────
let mcp = null;
let tools = [];
async function connectMcp() {
  let cfg = null;
  try { cfg = flags["--mcp-config"] ? JSON.parse(String(flags["--mcp-config"])) : null; } catch { cfg = null; }
  const servers = cfg?.mcpServers ? Object.values(cfg.mcpServers) : [];
  const url = servers.find((s) => s && typeof s.url === "string")?.url;
  if (!url) return;
  const client = new Client({ name: "vg-ollama-shim", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  const listed = await client.listTools();
  mcp = client;
  const allow = (process.env.VG_OLLAMA_TOOLS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  tools = (listed.tools ?? []).filter((t) => !allow.length || allow.includes(t.name)).map((t) => ({
    type: "function",
    function: {
      name: MCP_TOOL_PREFIX + t.name,
      description: (t.description ?? "").slice(0, 1024),
      parameters: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
    },
  }));
}

async function callTool(name, args) {
  const bare = name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
  if (!mcp) return { text: `no MCP tools are available in this session (requested ${bare})`, isError: true };
  try {
    const r = await mcp.callTool({ name: bare, arguments: args && typeof args === "object" ? args : {} });
    const text = (r.content ?? []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
    return { text: text || "(empty result)", isError: r.isError === true };
  } catch (e) {
    return { text: `tool ${bare} failed: ${e?.message ?? e}`, isError: true };
  }
}

// ── pseudo tool calls ─────────────────────────────────────────────────
// Small models often WRITE a tool call as a JSON block in their text
// ({"name": …, "arguments": {…}}, usually fenced) instead of using the
// tool-call channel, then continue as if it had run — the first
// local-worker drill escalated on exactly that (a confident self-report,
// zero bytes changed). When a turn carries no structured calls, scan the
// text for that shape, execute every block that names a known tool, and
// keep the loop going so the model sees the real results.
// A code payload written inline ("source": "def f():\n    \"\"\"doc\"\"\"…")
// usually carries UNESCAPED quotes — the docstring — so JSON.parse fails
// on the one block that matters. Repair that shape: take the `source`
// string as everything up to the last quote that only closing braces
// follow, escape its bare quotes, and parse again. Nothing else is
// repaired; anything still unparseable is ignored (not a call).
function parseLenient(c) {
  const t = c.trim();
  try { return JSON.parse(t); } catch { /* repair below */ }
  // The offending value is almost always the LAST string in the block (a
  // code payload); try each string key from the last one backwards.
  const keys = [...t.matchAll(/"[A-Za-z_][A-Za-z0-9_]*"\s*:\s*"/g)].reverse();
  for (const k of keys) {
    const head = t.slice(0, k.index + k[0].length);
    const rest = t.slice(k.index + k[0].length);
    for (let idx = rest.lastIndexOf('"'); idx > 0; idx = rest.lastIndexOf('"', idx - 1)) {
      if (!/^[\s}\],]*$/.test(rest.slice(idx + 1))) continue;
      const raw = rest.slice(0, idx);
      const fixed = raw.replace(/\\"/g, '\u0001').replace(/"/g, '\\"').replace(/\u0001/g, '\\"');
      try { return JSON.parse(head + fixed + rest.slice(idx)); } catch { /* try an earlier quote */ }
    }
  }
  return null;
}

function pseudoToolCalls(text) {
  if (typeof text !== "string" || !text.includes('"arguments"')) return [];
  const known = new Set(tools.map((t) => t.function.name));
  const candidates = [];
  for (const m of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) candidates.push(m[1]);
  if (!candidates.length) candidates.push(text);
  const calls = [];
  for (const c of candidates) {
    const j = parseLenient(c);
    if (j === null || typeof j !== "object") continue;
    for (const item of Array.isArray(j) ? j : [j]) {
      const name = item?.name ?? item?.function?.name ?? item?.tool;
      const args = item?.arguments ?? item?.function?.arguments ?? item?.parameters;
      if (typeof name !== "string" || !args || typeof args !== "object") continue;
      const full = name.startsWith(MCP_TOOL_PREFIX) ? name : MCP_TOOL_PREFIX + name;
      if (known.has(full)) calls.push({ function: { name: full, arguments: args } });
    }
  }
  return calls;
}

// ── the chat loop ─────────────────────────────────────────────────────
async function chat(messages) {
  const res = await fetch(`${endpoint}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, messages, stream: false,
      ...(tools.length ? { tools } : {}),
      options: { num_ctx: numCtx, temperature },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${endpoint}/api/chat → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(String(data.error));
  return data.message ?? { role: "assistant", content: "" };
}

async function main() {
  try { await connectMcp(); } catch (e) { fail(`could not connect to the MCP server: ${e?.message ?? e}`); }
  const messages = [{ role: "user", content: prompt }];
  let final = "";
  let turns = 0;
  try {
    while (turns < maxTurns) {
      turns++;
      const lastTurn = turns === maxTurns;
      if (lastTurn && maxTurns > 1) {
        // The last turn is for the REPORT, not for more tools: a small
        // model that keeps re-reading would otherwise spend the budget
        // with its edit on disk and no result block — which the server
        // escalates as a broken output contract. Say so, once.
        messages.push({ role: "user", content: "TURN BUDGET SPENT. Do not call any more tools. Finish NOW with the required fenced result block, reporting only what the tool results above show you actually did." });
      }
      const msg = await chat(messages);
      messages.push(msg);
      let calls = lastTurn ? [] : (Array.isArray(msg.tool_calls) ? msg.tool_calls : []);
      let pseudo = false;
      if (!lastTurn && !calls.length && tools.length) {
        // ONE text-written call per turn: a small model that writes "read
        // it, then rewrite it" in one breath has not seen the source yet —
        // executing the rewrite would splice its placeholder. Give it the
        // first result and let it write the next call with that in hand.
        calls = pseudoToolCalls(msg.content).slice(0, 1);
        pseudo = calls.length > 0;
      }
      if (typeof msg.content === "string" && msg.content.trim() && !pseudo) final = msg.content;
      else if (lastTurn && typeof msg.content === "string" && msg.content.trim()) final = msg.content;
      trace(`turn ${turns}: ${calls.length} tool call(s)${pseudo ? " (written as text — executed)" : ""}; text ${JSON.stringify((msg.content ?? "").slice(0, 120))}`);
      if (!calls.length) break;
      for (const call of calls) {
        const name = call?.function?.name ?? "";
        let args = call?.function?.arguments ?? {};
        if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
        const r = await callTool(name, args);
        trace(`  ${name}(${JSON.stringify(args).slice(0, 160)}) → ${r.isError ? "ERROR " : ""}${r.text.slice(0, 160).replace(/\n/g, " ")}`);
        messages.push({ role: "tool", content: (r.isError ? "ERROR: " : "") + r.text, tool_name: name });
      }
      if (pseudo) {
        messages.push({
          role: "user",
          content: "The FIRST tool call you wrote as JSON was EXECUTED; its result is above. Nothing else has happened yet — read the result, then write the NEXT tool call you need (one per message, with real values, never placeholders), and only after the last result finish with the required fenced result block.",
        });
      }
    }
  } catch (e) {
    try { await mcp?.close(); } catch { /* closing */ }
    fail(`model error: ${e?.message ?? e}`);
  }
  try { await mcp?.close(); } catch { /* closing */ }
  if (turns >= maxTurns && !final) final = `[turn budget of ${maxTurns} exhausted without a final answer]`;
  process.stdout.write(JSON.stringify({ result: final, is_error: false, session_id: `ollama-${process.pid}`, model, turns }));
}

main().catch((e) => fail(e?.message ?? String(e)));
