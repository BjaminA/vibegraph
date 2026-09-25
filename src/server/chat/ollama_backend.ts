// OllamaChatBackend — M-PROVIDER: the GUI chat on a LOCAL model.
//
// One in-memory conversation per session (real multi-turn memory: the
// message list IS the session), streamed token by token from Ollama's
// /api/chat, with the vibegraph MCP tools offered to the model under the
// same `mcp__vibegraph__*` names the prompts use — so a local model can
// drive the graph exactly like the claude session does. Tool calls run
// through an MCP client to `init.mcpServerUrl`, the results ride back as
// `role: "tool"` messages, and the loop continues until the model answers
// without a call (or the turn budget is spent).
//
// There is no prompt cache to protect here, so switching the model between
// turns simply changes the next request. There are no native tools at all,
// so `disallowedTools` is satisfied by construction. There is no
// `--resume`: a session dropped by the server is gone, and the panel says
// so through the same resumed/backend signals as the claude session.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ChatBackend, ChatSession, ChatSessionInit, ChatEvent } from "./backend";
import { normaliseEndpoint, type LocalEndpoint } from "../../shared/model_tiers.ts";

const MCP_TOOL_PREFIX = "mcp__vibegraph__";
const MAX_TOOL_ROUNDS = 25;

interface OllamaMessage { role: "user" | "assistant" | "tool" | "system"; content: string; tool_calls?: any[]; tool_name?: string }

class OllamaSession implements ChatSession {
  private readonly init: ChatSessionInit;
  private readonly endpoint: string;
  private model: string;
  private messages: OllamaMessage[] = [];
  private mcp: Client | null = null;
  private tools: any[] = [];
  private disposed = false;
  private turnActive = false;
  private readonly id: string;

  constructor(init: ChatSessionInit, local: LocalEndpoint) {
    this.init = init;
    this.endpoint = normaliseEndpoint(local.endpoint);
    this.model = local.model;
    this.id = `ollama-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  sessionId(): string | null { return this.id; }

  /** The chat picker sends claude ids or "ollama"; a local model name is
   * `ollama:<name>`. Anything else keeps the current model. */
  setModel(model: string | undefined): void {
    if (model && model.startsWith("ollama:") && model.length > 7) this.model = model.slice(7);
  }

  dispose(): void {
    this.disposed = true;
    const c = this.mcp; this.mcp = null;
    c?.close().catch(() => { /* closing */ });
  }

  private async ensureTools(): Promise<void> {
    if (this.mcp) return;
    const client = new Client({ name: "vg-ollama-chat", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.init.mcpServerUrl)));
    const listed = await client.listTools();
    this.mcp = client;
    this.tools = (listed.tools ?? []).map((t) => ({
      type: "function",
      function: {
        name: MCP_TOOL_PREFIX + t.name,
        description: (t.description ?? "").slice(0, 1024),
        parameters: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
      },
    }));
  }

  private async callTool(name: string, args: unknown): Promise<{ text: string; isError: boolean }> {
    const bare = name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
    if (!this.mcp) return { text: `no MCP tools available (requested ${bare})`, isError: true };
    try {
      const r: any = await this.mcp.callTool({ name: bare, arguments: (args && typeof args === "object" ? args : {}) as Record<string, unknown> });
      const text = (r.content ?? []).map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
      return { text: text || "(empty result)", isError: r.isError === true };
    } catch (e: any) {
      return { text: `tool ${bare} failed: ${e?.message ?? e}`, isError: true };
    }
  }

  /** One streamed /api/chat request: yields token deltas, returns the full assistant message. */
  private async *streamOnce(): AsyncGenerator<ChatEvent, OllamaMessage> {
    const res = await fetch(`${this.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model, messages: this.messages, stream: true,
        ...(this.tools.length ? { tools: this.tools } : {}),
        options: { num_ctx: Number(process.env.VG_OLLAMA_NUM_CTX ?? 16384) || 16384 },
      }),
    });
    if (!res.ok || !res.body) throw new Error(`${this.endpoint}/api/chat → HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let content = "";
    const toolCalls: any[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let j: any;
        try { j = JSON.parse(line); } catch { continue; }
        if (j.error) throw new Error(String(j.error));
        const delta = typeof j.message?.content === "string" ? j.message.content : "";
        if (delta) { content += delta; yield { type: "token", delta }; }
        if (Array.isArray(j.message?.tool_calls)) toolCalls.push(...j.message.tool_calls);
      }
    }
    return { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
  }

  async *sendTurn(prompt: string): AsyncIterable<ChatEvent> {
    if (this.disposed) { yield { type: "error", message: "Chat session is closed — start a new chat." }; yield { type: "done" }; return; }
    if (this.turnActive) { yield { type: "error", message: "A turn is already in progress." }; yield { type: "done" }; return; }
    this.turnActive = true;
    try {
      try { await this.ensureTools(); } catch (e: any) {
        yield { type: "error", message: `Could not reach the vibegraph MCP server for tools: ${e?.message ?? e}` };
      }
      this.messages.push({ role: "user", content: prompt });
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        yield { type: "agent-step", index: round };
        const gen = this.streamOnce();
        let next = await gen.next();
        while (!next.done) { yield next.value; next = await gen.next(); }
        const msg = next.value;
        this.messages.push(msg);
        const calls = msg.tool_calls ?? [];
        if (!calls.length) break;
        for (const [i, call] of calls.entries()) {
          const name = call?.function?.name ?? "";
          let args = call?.function?.arguments ?? {};
          if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
          const toolUseId = `${this.id}-${round}-${i}`;
          yield { type: "tool-use-start", toolUseId, name: name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name, args };
          const r = await this.callTool(name, args);
          yield { type: "tool-use-end", toolUseId, result: r.text, isError: r.isError };
          this.messages.push({ role: "tool", content: (r.isError ? "ERROR: " : "") + r.text, tool_name: name });
        }
      }
    } catch (e: any) {
      yield { type: "error", message: `Local model error: ${e?.message ?? e}` };
    } finally {
      this.turnActive = false;
    }
    yield { type: "done" };
  }
}

export class OllamaChatBackend implements ChatBackend {
  readonly id = "ollama" as const;
  private readonly local: LocalEndpoint;
  constructor(local: LocalEndpoint) { this.local = local; }
  openSession(init: ChatSessionInit): ChatSession {
    return new OllamaSession(init, this.local);
  }
}
