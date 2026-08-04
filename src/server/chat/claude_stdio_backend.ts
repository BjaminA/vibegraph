// ClaudeStdioBackend — ONE long-running `claude -p --input-format
// stream-json` child per chat session (M27.1, PLAN-M27).
//
// The per-send backend (claude_p_backend, now parked) spawned a fresh
// process per message: the GUI chat had amnesia between sends. Stdio
// mode (verified on CLI 2.1.175, PLAN-M27 context block) keeps a
// single process that accepts user turns as stream-json lines on
// stdin, holds conversation memory between them, and marks each
// turn's completion with a `result` event:
//   - session_id is captured from the system/init event (re-emitted
//     per turn with the same id — tolerate both).
//   - If the child died (crash, idle reap, server hiccup), the next
//     turn respawns with `--resume <session_id>` and the conversation
//     continues where it left off.
//   - clearHistory = dispose + a fresh session (no --resume).
//   - An idle child is reaped after idleMs (default 15 min) so a
//     forgotten tab doesn't pin a process; resume makes the reap
//     invisible to the user.
//
// VG_CLAUDE_BIN (whitespace-split; first token = command) overrides
// the spawned binary so the unit test can drive a stub that speaks
// stream-json — automated tests never spawn the real `claude`
// (auth/cost; project convention recorded at M10R.7).

import { spawn, type ChildProcess } from "child_process";
import type { ChatBackend, ChatSession, ChatSessionInit, ChatEvent } from "./backend";
import { mapClaudeStreamMessage } from "./stream_json.ts";

const DEFAULT_IDLE_MS = 15 * 60_000;

function resolveBin(): { cmd: string; args: string[] } {
  const raw = process.env.VG_CLAUDE_BIN;
  if (raw && raw.trim().length > 0) {
    const parts = raw.trim().split(/\s+/);
    return { cmd: parts[0], args: parts.slice(1) };
  }
  return { cmd: "claude", args: [] };
}

class StdioSession implements ChatSession {
  private child: ChildProcess | null = null;
  private stdoutBuf = "";
  private stderrTail = "";
  private id: string | null = null;
  private disposed = false;

  // Exactly one turn is in flight at a time (the panel disables send
  // while busy); its events queue here between yields.
  private turnActive = false;
  private turnDone = false;
  private queue: ChatEvent[] = [];
  private wakeTurn: (() => void) | null = null;

  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  // Plain field assignment, not a TS parameter property — the unit test
  // imports this file via --experimental-strip-types, which can't strip
  // parameter properties (they generate code).
  private readonly init: ChatSessionInit;
  private model: string | undefined;
  constructor(init: ChatSessionInit) {
    this.init = init;
    this.model = init.model;
  }

  sessionId(): string | null {
    return this.id;
  }

  /**
   * Switch model without losing the conversation. Retiring the child is
   * enough: ensureChild() respawns with `--resume <id>` whenever an id is
   * known, so the next turn gets the new `--model` AND the memory. Only
   * the idle-reap path did this before; a model switch is the same shape
   * of event.
   */
  setModel(model: string | undefined): void {
    if (model === this.model) return;
    this.model = model;
    this.killChild();
  }

  dispose(): void {
    this.disposed = true;
    this.clearIdle();
    this.killChild();
  }

  async *sendTurn(prompt: string): AsyncIterable<ChatEvent> {
    if (this.disposed) {
      yield { type: "error", message: "Chat session is closed — start a new chat." };
      yield { type: "done" };
      return;
    }
    if (this.turnActive) {
      yield { type: "error", message: "A turn is already in progress." };
      yield { type: "done" };
      return;
    }
    this.turnActive = true;
    this.turnDone = false;
    this.queue = [];
    this.clearIdle();

    try {
      this.ensureChild();
      this.child!.stdin!.write(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text: prompt }] },
        }) + "\n",
      );
    } catch (err: any) {
      this.push({ type: "error", message: `Could not reach claude: ${err?.message ?? err}` });
      this.push({ type: "done" });
      this.turnDone = true;
    }

    while (!this.turnDone || this.queue.length > 0) {
      if (this.queue.length === 0) {
        await new Promise<void>((resolve) => { this.wakeTurn = resolve; });
        continue;
      }
      yield this.queue.shift()!;
    }
    this.turnActive = false;
    this.armIdle();
  }

  // ── child lifecycle ─────────────────────────────────────────────

  private ensureChild(): void {
    if (this.child && this.child.exitCode === null && !this.child.killed) return;
    const { cmd, args: binArgs } = resolveBin();
    const mcpConfig = this.init.mcpConfigJson ?? JSON.stringify({
      mcpServers: { vibegraph: { type: "http", url: this.init.mcpServerUrl } },
    });
    const args = [
      ...binArgs,
      "-p",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--mcp-config", mcpConfig,
      "--strict-mcp-config",
      "--dangerously-skip-permissions",
      ...(this.init.disallowedTools?.length
        ? ["--disallowedTools", this.init.disallowedTools.join(",")]
        : []),
      // Absent = let the CLI resolve its own default (settings.json /
      // ANTHROPIC_MODEL). VibeGraph pins a model only when asked to.
      ...(this.model ? ["--model", this.model] : []),
      // Crash/reap recovery: same conversation, fresh process. The
      // session file lives under the cwd's project dir — spawn and
      // respawn MUST share init.cwd or resume looks up nothing.
      ...(this.id ? ["--resume", this.id] : []),
    ];
    const child = spawn(cmd, args, { cwd: this.init.cwd, env: { ...process.env } });
    this.child = child;
    this.stdoutBuf = "";
    this.stderrTail = "";

    child.stdout!.on("data", (b: Buffer) => {
      this.stdoutBuf += b.toString();
      let idx;
      while ((idx = this.stdoutBuf.indexOf("\n")) >= 0) {
        const line = this.stdoutBuf.slice(0, idx);
        this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
        if (line.trim()) this.onLine(line);
      }
    });
    child.stderr!.on("data", (b: Buffer) => {
      this.stderrTail = (this.stderrTail + b.toString()).slice(-2000);
    });
    child.on("close", (code) => {
      if (this.child === child) this.child = null;
      if (this.turnActive && !this.turnDone) {
        const firstLine = this.stderrTail.split("\n").find((l) => l.trim()) ?? `exit ${code}`;
        this.push({ type: "error", message: `claude exited mid-turn (${code}): ${firstLine}` });
        this.push({ type: "done" });
        this.turnDone = true;
      }
    });
    child.on("error", (err: any) => {
      if (this.child === child) this.child = null;
      if (this.turnActive && !this.turnDone) {
        this.push({
          type: "error",
          message: `Could not spawn claude: ${err.message}. Is Claude Code installed?`,
        });
        this.push({ type: "done" });
        this.turnDone = true;
      }
    });
  }

  private onLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch (e: any) {
      console.warn(`  [ClaudeStdio] stream-json parse: ${e.message} :: ${line.slice(0, 100)}`);
      return;
    }
    if (msg.type === "system" && msg.subtype === "init" && typeof msg.session_id === "string") {
      this.id = msg.session_id; // re-emitted per turn, same id — idempotent
      return;
    }
    mapClaudeStreamMessage(msg, (ev) => this.push(ev));
    if (msg.type === "result") {
      // THE turn boundary — the process stays alive for the next turn,
      // so (unlike the per-send backend) `done` cannot ride on exit.
      this.push({ type: "done" });
      this.turnDone = true;
      this.wake();
    }
  }

  private push(ev: ChatEvent): void {
    if (!this.turnActive) return; // stray event between turns — drop
    this.queue.push(ev);
    this.wake();
  }

  private wake(): void {
    const w = this.wakeTurn;
    this.wakeTurn = null;
    w?.();
  }

  private killChild(): void {
    const c = this.child;
    this.child = null;
    c?.kill();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private armIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => this.killChild(), this.init.idleMs ?? DEFAULT_IDLE_MS);
  }
}

export class ClaudeStdioBackend implements ChatBackend {
  readonly id = "claude-stdio" as const;

  openSession(init: ChatSessionInit): ChatSession {
    return new StdioSession(init);
  }
}
