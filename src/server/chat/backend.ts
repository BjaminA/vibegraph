// Chat backend abstraction — M10.1, session-shaped since M27.1.
//
// One interface, three implementations:
//   * ClaudeStdioBackend     — ONE long-running `claude -p` stdio child
//                              per chat session; real multi-turn memory
//                              (the no-API-key default since M27.1)
//   * AgentSDKBackend        — @anthropic-ai/claude-agent-sdk (M10.2);
//                              per-turn semantics behind the session
//                              interface (no cross-turn memory — SDK
//                              resume support is out of M27 scope)
//   * ClaudePHeadlessBackend — PARKED (superseded by stdio): fresh
//                              `claude -p` per turn, no carried state
//
// The WS handler in server.ts (handleChat) opens ONE ChatSession per
// connected client, builds the per-turn prompt, iterates sendTurn(),
// and forwards each event to the webview. Backends own nothing
// webview-shaped — they speak ChatEvent only.

export type ChatEvent =
  | { type: "token"; delta: string }
  | { type: "tool-use-start"; toolUseId: string; name: string; args: unknown }
  | { type: "tool-use-end"; toolUseId: string; result: unknown; isError?: boolean }
  | { type: "agent-step"; index: number }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ChatSessionInit {
  mcpServerUrl: string;
  /** The ANALYZED project dir (terminal parity: its CLAUDE.md loads,
   * and `--resume` looks sessions up per-cwd) — not VibeGraph's own
   * repo. */
  cwd: string;
  /** Idle-reap override for tests; default 15 min (stdio backend). */
  idleMs?: number;
  /** Override the child's --mcp-config JSON (stdio backend only). The
   * builder session (VG_BUILD_SESSION) passes '{"mcpServers":{}}' so
   * the drafting child has the SAME zero-MCP surface as the per-spawn
   * `claude -p` path it replaces. Absent = the vibegraph http config. */
  mcpConfigJson?: string;
  /** Tool names denied to the child (`--disallowedTools`). The GUI chat
   * passes the raw file-write tools so edits can only reach disk through
   * the CST chokepoint: facing a refusal, the chat's Claude used to finish
   * the task with its own `Edit` tool and silently leave that path
   * entirely (reviews/modify-showdown-2026-08/). Safe to deny only
   * because the rewriter now retries unformatted before refusing, so a
   * refusal is recoverable rather than a dead end. Absent = no
   * restriction (the builder session drafts text and writes nothing). */
  disallowedTools?: string[];
  /** Model id for the child (`--model`). Absent = whatever the `claude`
   * CLI resolves on its own (settings.json / ANTHROPIC_MODEL), which is
   * the historical behaviour — VibeGraph never pinned a model. */
  model?: string;
}

export interface ChatSession {
  /** Send one user turn; the iterable completes after the turn's
   * `done` event. Exactly one turn may be in flight per session. */
  sendTurn(prompt: string): AsyncIterable<ChatEvent>;
  /** The CLI conversation id, once known (null before the first
   * system/init — or always, for backends without sessions). */
  sessionId(): string | null;
  /** Switch the model for subsequent turns. The conversation is KEPT:
   * the child is retired and the next turn respawns it with the new
   * `--model` and `--resume <id>`, so the session remembers what it has
   * already been told. No-op when the model is unchanged, or on
   * backends that do not spawn a CLI. */
  setModel?(model: string | undefined): void;
  dispose(): void;
}

export interface ChatBackend {
  readonly id: "claude-stdio" | "claude-p-headless" | "agent-sdk";
  openSession(init: ChatSessionInit): ChatSession;
}

import { ClaudeStdioBackend } from "./claude_stdio_backend";
import { AgentSDKBackend } from "./agent_sdk_backend";

// M10.3 — backend selection (M27.1: stdio replaces per-send headless).
//
// If ANTHROPIC_API_KEY is present, use the in-process Agent SDK loop.
// Otherwise the zero-friction stdio spawn, which reuses the user's
// existing Claude Code auth. One env-var check, no UI. The webview
// learns which backend is active via the chat-backend-info WS message.
export function selectBackend(): ChatBackend {
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 0) {
    return new AgentSDKBackend();
  }
  return new ClaudeStdioBackend();
}
