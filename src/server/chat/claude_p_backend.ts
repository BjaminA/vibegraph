// ClaudePHeadlessBackend — PARKED at M27.1 (park-don't-delete; M16/M10
// precedent). Spawns `claude -p --output-format stream-json` once per
// chat send: per-send semantics, NO carried session state — the GUI
// chat's amnesia the persistent ClaudeStdioBackend replaced. Kept on
// disk, zero live imports from selectBackend; revive only if the
// long-running stdio child turns out to be a liability.
//
// Reuses the user's existing Claude Code auth (no ANTHROPIC_API_KEY).
// The stream-json mapping moved to ./stream_json (shared with the
// stdio backend) at M27.1.

import { spawn } from "child_process";
import type { ChatBackend, ChatSession, ChatSessionInit, ChatEvent } from "./backend";
import { mapClaudeStreamMessage } from "./stream_json.ts";

interface ChatBackendInput extends ChatSessionInit {
  prompt: string;
}

export class ClaudePHeadlessBackend implements ChatBackend {
  readonly id = "claude-p-headless" as const;

  // M27.1 session adapter: every turn is a fresh spawn (the parked
  // behaviour, made explicit at the interface).
  openSession(init: ChatSessionInit): ChatSession {
    const self = this;
    return {
      sendTurn: (prompt: string) => self.send({ prompt, ...init }),
      sessionId: () => null,
      dispose: () => {},
    };
  }

  private async *send(input: ChatBackendInput): AsyncIterable<ChatEvent> {
    const mcpConfig = JSON.stringify({
      mcpServers: {
        vibegraph: { type: "http", url: input.mcpServerUrl },
      },
    });

    const child = spawn(
      "claude",
      [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--mcp-config", mcpConfig,
        "--strict-mcp-config",
        "--dangerously-skip-permissions",
        // CLI-drift fix applied while parked: --mcp-config is variadic,
        // so the prompt needs `--` or it's read as a config path.
        "--",
        input.prompt,
      ],
      { cwd: input.cwd, env: { ...process.env } },
    );

    const queue: ChatEvent[] = [];
    let closed = false;
    let pendingResolve: (() => void) | null = null;
    const wake = () => { if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(); } };
    const push = (ev: ChatEvent) => { queue.push(ev); wake(); };

    let buf = "";
    child.stdout.on("data", (b) => {
      buf += b.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          mapClaudeStreamMessage(JSON.parse(line), push);
        } catch (e: any) {
          console.warn(`  [ClaudePBackend] stream-json parse: ${e.message} :: ${line.slice(0, 100)}`);
        }
      }
    });

    let stderrBuf = "";
    child.stderr.on("data", (b) => { stderrBuf += b.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        const firstLine = stderrBuf.split("\n").find((l) => l.trim()) ?? `exit ${code}`;
        push({ type: "error", message: `claude exited ${code}: ${firstLine}` });
      }
      push({ type: "done" });
      closed = true;
      wake();
    });

    child.on("error", (err: any) => {
      push({ type: "error", message: `Could not spawn claude: ${err.message}. Is Claude Code installed?` });
      push({ type: "done" });
      closed = true;
      wake();
    });

    while (!closed || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((res) => { pendingResolve = res; });
        continue;
      }
      yield queue.shift()!;
    }
  }
}
