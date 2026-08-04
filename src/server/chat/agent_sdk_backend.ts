// AgentSDKBackend — uses @anthropic-ai/claude-agent-sdk to run a real
// agent loop in-process (M10.2). Selected by selectBackend() when
// ANTHROPIC_API_KEY is set in the environment.
//
// Registers VibeGraph's own /mcp as a tool source via mcpServers, so
// the SDK agent has the same vibegraph_* tool surface the headless
// backend exposes — single source of truth for capabilities (PLAN §3.5).
//
// Mapping is structurally similar to claude_p_backend's stream-json
// parser: assistant.message.content blocks become token / tool-use-start
// events; user.message.content tool_result blocks become tool-use-end;
// result.is_error becomes an error event. SDK system(init) and
// result(success) are intentionally ignored — `done` is emitted once at
// the end of iteration.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ChatBackend, ChatSession, ChatSessionInit, ChatEvent } from "./backend";

const MCP_TOOL_PREFIX = "mcp__vibegraph__";

function unprefixToolName(name: string): string {
  return name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
}

function* mapAssistantBlocks(msg: any): Iterable<ChatEvent> {
  const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      yield { type: "token", delta: block.text };
    } else if (block.type === "tool_use") {
      yield {
        type: "tool-use-start",
        toolUseId: typeof block.id === "string" ? block.id : "",
        name: unprefixToolName(typeof block.name === "string" ? block.name : ""),
        args: block.input ?? {},
      };
    }
  }
}

function* mapUserBlocks(msg: any): Iterable<ChatEvent> {
  const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
  for (const block of content) {
    if (block.type === "tool_result") {
      const raw = block.content;
      const text = Array.isArray(raw)
        ? raw.map((c: any) => (c.type === "text" ? c.text : "")).join("\n")
        : (typeof raw === "string" ? raw : "");
      yield {
        type: "tool-use-end",
        toolUseId: typeof block.tool_use_id === "string" ? block.tool_use_id : "",
        result: text,
        isError: block.is_error === true,
      };
    }
  }
}

export class AgentSDKBackend implements ChatBackend {
  readonly id = "agent-sdk" as const;

  // M27.1 — session-shaped interface. The SDK path keeps its per-turn
  // semantics behind it: each sendTurn is an independent query() with
  // NO cross-turn memory (SDK `resume` support is a named M27 scope
  // cut). The stdio backend is the multi-turn default.
  openSession(init: ChatSessionInit): ChatSession {
    const self = this;
    return {
      sendTurn: (prompt: string) => self.run(prompt, init),
      sessionId: () => null,
      dispose: () => {},
    };
  }

  private async *run(prompt: string, init: ChatSessionInit): AsyncIterable<ChatEvent> {
    let errored = false;
    try {
      const iterator = query({
        prompt,
        options: {
          cwd: init.cwd,
          permissionMode: "bypassPermissions",
          mcpServers: {
            vibegraph: { type: "http", url: init.mcpServerUrl },
          },
          // settingSources defaults load ~/.claude and ./.claude — we
          // restrict to the project so the in-webview chat is not
          // polluted by the user's global skills, agents, or plugins.
          settingSources: ["project"],
        },
      });

      for await (const msg of iterator) {
        if (msg.type === "assistant") {
          yield* mapAssistantBlocks(msg);
        } else if (msg.type === "user") {
          yield* mapUserBlocks(msg);
        } else if (msg.type === "result" && msg.is_error === true) {
          // SDKResultError has errors: string[] (no `result` field — that's
          // only on SDKResultSuccess). Take the first non-empty error line.
          errored = true;
          const firstErr = (msg as { errors?: string[] }).errors?.find((e) => e && e.trim().length > 0);
          yield {
            type: "error",
            message: firstErr ?? `agent-sdk error (${msg.subtype})`,
          };
        }
        // system(init), result(success) intentionally not surfaced.
      }
    } catch (err: any) {
      if (!errored) {
        yield { type: "error", message: `Agent SDK exception: ${err?.message ?? String(err)}` };
      }
    }
    yield { type: "done" };
  }
}
