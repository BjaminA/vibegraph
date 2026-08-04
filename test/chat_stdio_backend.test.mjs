/**
 * M27.1 — ClaudeStdioBackend unit test (PLAN-M27 §M27.1).
 *
 * Drives the persistent-session backend against the stream-json stub
 * (test/fixtures/chat/fake_claude_stdio.mjs) via VG_CLAUDE_BIN — the
 * real `claude` is never spawned (auth/cost; convention from M10R.7).
 *
 * Pinned behaviours:
 *  - two turns ride ONE process (the stub's in-memory turn counter);
 *  - each sendTurn's iterable ends on the result event (`done`);
 *  - a result with is_error surfaces an error event, then done —
 *    and the SAME process keeps serving later turns;
 *  - mid-turn crash → error + done; the NEXT turn respawns with
 *    --resume <session_id> (stub proves it via the "resumed:" prefix);
 *  - the idle reaper kills a quiet child; the next turn resumes
 *    transparently;
 *  - dispose kills the child; a fresh session starts un-resumed.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/chat_stdio_backend.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeStdioBackend } from "../src/server/chat/claude_stdio_backend.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STUB = path.join(ROOT, "test", "fixtures", "chat", "fake_claude_stdio.mjs");

let tmpDir = "";
const pidFile = () => path.join(tmpDir, "stub.pid");

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-stdio-test-"));
  process.env.VG_CLAUDE_BIN = `node ${STUB}`;
  process.env.FAKE_PID_FILE = pidFile();
});
after(() => {
  delete process.env.VG_CLAUDE_BIN;
  delete process.env.FAKE_PID_FILE;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const INIT = { mcpServerUrl: "http://localhost:9999/mcp", cwd: process.cwd() };

async function collect(iterable) {
  const events = [];
  for await (const ev of iterable) events.push(ev);
  return events;
}
const texts = (events) => events.filter((e) => e.type === "token").map((e) => e.delta);
const readPid = () => Number(fs.readFileSync(pidFile(), "utf-8"));
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function waitPidDead(pid, ms) {
  const deadline = Date.now() + ms;
  while (pidAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
  return true;
}

test("two turns ride ONE process; each iterable ends on result", async () => {
  const session = new ClaudeStdioBackend().openSession(INIT);
  try {
    const t1 = await collect(session.sendTurn("hello"));
    assert.deepEqual(texts(t1), ["t1:echo:hello"]);
    assert.equal(t1[t1.length - 1].type, "done", "turn 1 must end with done");

    const t2 = await collect(session.sendTurn("again"));
    // t2 — the stub's in-process counter — IS the multi-turn proof.
    assert.deepEqual(texts(t2), ["t2:echo:again"]);
    assert.equal(session.sessionId(), "fake-session-1");
  } finally {
    session.dispose();
  }
});

// M-CHAT-POLISH.1 — the tool_use/tool_result pair carries ONE toolUseId
// end-to-end; the webview pairs the result card to its spinner by it.
test("tool events carry a matching toolUseId with name + args on start", async () => {
  const session = new ClaudeStdioBackend().openSession(INIT);
  try {
    const events = await collect(session.sendTurn("tooluse"));
    const start = events.find((e) => e.type === "tool-use-start");
    const end = events.find((e) => e.type === "tool-use-end");
    assert.ok(start, "tool-use-start must surface");
    assert.ok(end, "tool-use-end must surface");
    assert.equal(start.toolUseId, "tu-1");
    assert.equal(end.toolUseId, start.toolUseId, "start/end must share one id");
    assert.equal(start.name, "vibegraph_explain_node", "mcp prefix stripped");
    assert.deepEqual(start.args, { nodeId: "module/train.fn" });
    assert.equal(end.isError, false);
    assert.equal(events[events.length - 1].type, "done");
  } finally {
    session.dispose();
  }
});

test("a failed turn surfaces error + done, and the process survives it", async () => {
  const session = new ClaudeStdioBackend().openSession(INIT);
  try {
    await collect(session.sendTurn("hello"));
    const failed = await collect(session.sendTurn("fail"));
    assert.ok(failed.some((e) => e.type === "error" && /fake failure/.test(e.message)));
    assert.equal(failed[failed.length - 1].type, "done");
    // Same process: counter continues at t3.
    const t3 = await collect(session.sendTurn("after"));
    assert.deepEqual(texts(t3), ["t3:echo:after"]);
  } finally {
    session.dispose();
  }
});

test("mid-turn crash → error+done; the next turn respawns with --resume", async () => {
  const session = new ClaudeStdioBackend().openSession(INIT);
  try {
    await collect(session.sendTurn("hello"));
    const crashed = await collect(session.sendTurn("die"));
    assert.ok(
      crashed.some((e) => e.type === "error" && /exited mid-turn/.test(e.message)),
      `expected mid-turn exit error, got: ${JSON.stringify(crashed)}`,
    );
    assert.equal(crashed[crashed.length - 1].type, "done");

    // Respawn carries --resume <id>: the stub echoes the resumed id and
    // prefixes replies. Fresh process → counter restarts at t1.
    const t = await collect(session.sendTurn("back"));
    assert.deepEqual(texts(t), ["resumed:t1:echo:back"]);
    assert.equal(session.sessionId(), "fake-session-1", "conversation id survives the crash");
  } finally {
    session.dispose();
  }
});

test("idle reap kills a quiet child; the next turn resumes transparently", async () => {
  const session = new ClaudeStdioBackend().openSession({ ...INIT, idleMs: 150 });
  try {
    await collect(session.sendTurn("hello"));
    const pid = readPid();
    assert.ok(await waitPidDead(pid, 2_000), "idle reaper should kill the child");
    const t = await collect(session.sendTurn("back"));
    assert.deepEqual(texts(t), ["resumed:t1:echo:back"], "post-reap turn must resume, not restart");
  } finally {
    session.dispose();
  }
});

test("dispose kills the child; a fresh session starts un-resumed", async () => {
  const backend = new ClaudeStdioBackend();
  const session = backend.openSession(INIT);
  await collect(session.sendTurn("hello"));
  const pid = readPid();
  session.dispose();
  assert.ok(await waitPidDead(pid, 2_000), "dispose must kill the child");

  // clearHistory path = dispose + openSession: no --resume, no memory.
  const fresh = backend.openSession(INIT);
  try {
    const t = await collect(fresh.sendTurn("hi"));
    assert.deepEqual(texts(t), ["t1:echo:hi"], "fresh session must NOT resume");
  } finally {
    fresh.dispose();
  }
});

test("a second concurrent turn is refused without disturbing the first", async () => {
  const session = new ClaudeStdioBackend().openSession(INIT);
  try {
    const first = collect(session.sendTurn("hello"));
    const second = await collect(session.sendTurn("overlap"));
    assert.ok(second.some((e) => e.type === "error" && /already in progress/.test(e.message)));
    const events = await first;
    assert.deepEqual(texts(events), ["t1:echo:hello"], "first turn unaffected");
  } finally {
    session.dispose();
  }
});

// M-DIRTY follow-up — the GUI chat may not write files directly.
//
// Facing a rejected CST edit, the chat's Claude used to finish the task
// with its own `Edit` tool, so the change reached disk with none of the
// structural verification the architecture promises and the user was
// never told (reviews/modify-showdown-2026-08/). The backend must pass
// the deny-list through so that door is closed at the process boundary,
// not merely discouraged in the prompt.
test("disallowedTools reaches the child's argv", async () => {
  const argvFile = path.join(tmpDir, "argv.txt");
  process.env.FAKE_ARGV_FILE = argvFile;
  const session = new ClaudeStdioBackend().openSession({
    ...INIT,
    disallowedTools: ["Edit", "Write", "MultiEdit", "NotebookEdit"],
  });
  try {
    await collect(session.sendTurn("hello"));
    const argv = fs.readFileSync(argvFile, "utf-8").split("\n");
    const ix = argv.indexOf("--disallowedTools");
    assert.ok(ix >= 0, "--disallowedTools must be passed to the child");
    assert.equal(argv[ix + 1], "Edit,Write,MultiEdit,NotebookEdit");
  } finally {
    session.dispose();
    delete process.env.FAKE_ARGV_FILE;
  }
});

test("no disallowedTools = no flag (the builder session writes nothing)", async () => {
  const argvFile = path.join(tmpDir, "argv-none.txt");
  process.env.FAKE_ARGV_FILE = argvFile;
  const session = new ClaudeStdioBackend().openSession(INIT);
  try {
    await collect(session.sendTurn("hello"));
    const argv = fs.readFileSync(argvFile, "utf-8").split("\n");
    assert.ok(!argv.includes("--disallowedTools"), "must not restrict tools unasked");
  } finally {
    session.dispose();
    delete process.env.FAKE_ARGV_FILE;
  }
});

// Model selection — the picker is only honest if --model actually
// reaches the child, and if switching keeps the conversation.
test("init model reaches the child's argv; absent = no flag", async () => {
  const argvFile = path.join(tmpDir, "argv-model.txt");
  process.env.FAKE_ARGV_FILE = argvFile;
  const withModel = new ClaudeStdioBackend().openSession({ ...INIT, model: "claude-haiku-4-5-20251001" });
  try {
    await collect(withModel.sendTurn("hello"));
    const argv = fs.readFileSync(argvFile, "utf-8").split("\n");
    const ix = argv.indexOf("--model");
    assert.ok(ix >= 0, "--model must be passed when set");
    assert.equal(argv[ix + 1], "claude-haiku-4-5-20251001");
  } finally {
    withModel.dispose();
  }

  // Default (no model) must be byte-identical to the pre-selector spawn.
  const plain = new ClaudeStdioBackend().openSession(INIT);
  try {
    await collect(plain.sendTurn("hello"));
    const argv = fs.readFileSync(argvFile, "utf-8").split("\n");
    assert.ok(!argv.includes("--model"), "no model set must not pin one");
  } finally {
    plain.dispose();
    delete process.env.FAKE_ARGV_FILE;
  }
});

test("setModel switches model for the next turn AND keeps the conversation", async () => {
  const argvFile = path.join(tmpDir, "argv-switch.txt");
  process.env.FAKE_ARGV_FILE = argvFile;
  const session = new ClaudeStdioBackend().openSession(INIT);
  try {
    const t1 = await collect(session.sendTurn("hello"));
    assert.deepEqual(texts(t1), ["t1:echo:hello"]);
    const pid1 = readPid();

    session.setModel("claude-opus-5");
    assert.ok(await waitPidDead(pid1, 2_000), "switching model retires the child");

    const t2 = await collect(session.sendTurn("again"));
    const argv = fs.readFileSync(argvFile, "utf-8").split("\n");
    const ix = argv.indexOf("--model");
    assert.ok(ix >= 0 && argv[ix + 1] === "claude-opus-5", "new model on the respawn");
    // --resume proves the memory came with it (stub prefixes "resumed:").
    assert.ok(argv.includes("--resume"), "respawn must resume, not start fresh");
    assert.ok(texts(t2).some((s) => /resumed:/.test(s)), `expected a resumed turn, got ${JSON.stringify(texts(t2))}`);

    // Same model again = no churn.
    const pid2 = readPid();
    session.setModel("claude-opus-5");
    assert.ok(pidAlive(pid2), "re-selecting the same model must not respawn");
  } finally {
    session.dispose();
    delete process.env.FAKE_ARGV_FILE;
  }
});
