/**
 * M-SKILL.2 — remit routing over the real WS wire.
 *
 * Boots dist/server.js on a flask_demo copy with the stream-json chat stub
 * (VG_CLAUDE_BIN; FAKE_PROMPT_LOG captures every prompt the backend actually
 * sends). Pins the whole routed path: a question naming another thread's
 * symbols → chat-routed provenance to the client + routed block (skill body +
 * spawn hint) in the prompt; an identical follow-up → session dedup reference;
 * an unrelated question → zero routing artifacts (the no-op guarantee).
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/chat_routing.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { sourceHashOf } from "../src/server/readme_store.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4316;

let serverProc = null;
let tmpDir = null;
let promptLog = null;
let ws = null;
const pending = new Map(); // type -> resolver queue

function onMessage(raw) {
  const msg = JSON.parse(raw.toString());
  const q = pending.get(msg.type);
  if (q?.length) q.shift()(msg.payload);
}
function waitFor(type, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const q = pending.get(type) ?? [];
    pending.set(type, q);
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
    q.push((p) => { clearTimeout(t); resolve(p); });
  });
}
const send = (type, payload) => ws.send(JSON.stringify({ type, payload }));

/** One chat turn: send, drain to chat-done, return whether chat-routed arrived. */
async function chatTurn(text, threadEntryPointId) {
  let routedPayload = null;
  waitFor("chat-routed", 25_000).then((p) => { routedPayload = p; }, () => {});
  send("chat-send", { text, contextNodeId: null, threadEntryPointId });
  await waitFor("chat-done");
  return routedPayload;
}

const SKILL_BODY =
  "## How this thread works\nAlways obtain the connection via _get_conn; never open sqlite3 directly. `module/query.fn`";

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-chat-routing-"));
  promptLog = path.join(tmpDir, "prompts.log");
  for (const f of ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"]) {
    fs.copyFileSync(path.join(ROOT, "test", "fixtures", "threads", "flask_demo", f), path.join(tmpDir, f));
  }
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PYTHONPATH: path.join(ROOT, ".pydeps"),
      VG_CLAUDE_BIN: `node ${path.join(ROOT, "test", "fixtures", "chat", "fake_claude_stdio.mjs")}`,
      FAKE_PROMPT_LOG: promptLog,
    },
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });
  ws = new WebSocket(`ws://localhost:${PORT}`);
  ws.on("message", onMessage);
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
  const envelope = await waitFor("project-update");

  // Pre-write a RATIFIED, FRESH skill for db.py:query — hash computed from the
  // very thread IR the server routes on (threads ride the envelope verbatim).
  const thread = envelope.threads.find((t) => t.entryPointId === "db.py:query");
  assert.ok(thread, "db.py:query thread must exist in flask_demo");
  const slug = "db.py_query".replace(/[^A-Za-z0-9._-]/g, "_");
  const p = path.join(tmpDir, ".vibegraph", "thread-skills", `${slug}.md`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, [
    "---",
    "key: thread:db.py:query",
    "entryPointId: db.py:query",
    "status: ratified",
    `sourceHash: ${sourceHashOf(thread)}`,
    "generatedAt: 2026-07-20T00:00:00Z",
    "---",
    "",
    SKILL_BODY,
    "",
  ].join("\n"));
});

after(() => {
  ws?.close();
  serverProc?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("1. a question naming another thread's symbols routes: provenance + skill + hint in the prompt", async () => {
  const routed = await chatTurn("why does `db.query` sometimes fail?", "app.py:create_user_route");
  assert.ok(routed, "chat-routed must arrive before the reply");
  // Other threads WALK db:query too (routes calling it) — they may co-route,
  // but the seed owner outranks every pass-through.
  const m = routed.matches[0];
  assert.equal(m.entryPointId, "db.py:query");
  assert.equal(m.skillInjected, true);
  assert.ok(m.matchedOn.includes("`db.query`"), JSON.stringify(m.matchedOn));

  const log = fs.readFileSync(promptLog, "utf-8");
  assert.match(log, /Routed context — this question touches threads beyond the active one/);
  assert.ok(log.includes("Always obtain the connection via _get_conn"), "routed skill body must ride the prompt");
  assert.match(log, /vibegraph_spawn_thread_agent\(entryPointId, task\)/);
  // The active thread's block is separate and labelled as such.
  assert.match(log, /Active thread: app:create_user_route/);
});

test("2. the same question again dedups: routed as a reference, skill not re-pasted", async () => {
  const before = fs.readFileSync(promptLog, "utf-8");
  const routed = await chatTurn("why does `db.query` sometimes fail?", "app.py:create_user_route");
  assert.ok(routed, "still routed on the follow-up turn");
  assert.equal(routed.matches[0].entryPointId, "db.py:query");
  assert.equal(routed.matches[0].skillInjected, false, "identical skill must not re-inject");

  const turn2 = fs.readFileSync(promptLog, "utf-8").slice(before.length);
  assert.match(turn2, /already in this session's context/);
  assert.ok(!turn2.includes("Always obtain the connection"), "body must not be re-pasted");
});

test("3. an unrelated question produces ZERO routing artifacts — the no-op guarantee", async () => {
  const before = fs.readFileSync(promptLog, "utf-8");
  const routed = await chatTurn("what should I build next, any ideas?", "app.py:create_user_route");
  assert.equal(routed, null, "no chat-routed message");
  const turn3 = fs.readFileSync(promptLog, "utf-8").slice(before.length);
  assert.ok(turn3.length > 0, "the turn itself still reached the backend");
  assert.ok(!turn3.includes("Routed context"), "no routed block in the prompt");
});

test("4. node-click dispatch: an unrelated question FROM a node routes to the node's owner", async () => {
  const before = fs.readFileSync(promptLog, "utf-8");
  // Test 3's (correctly) never-resolved chat-routed waiter is still queued —
  // drop it so this test's waiter receives the event.
  pending.set("chat-routed", []);
  let routedPayload = null;
  waitFor("chat-routed", 25_000).then((p) => { routedPayload = p; }, () => {});
  // No code-shaped text at all — the contextNodeId alone must dispatch.
  send("chat-send", {
    text: "what does this actually do?",
    contextNodeId: "module/query.fn",
    filePath: "db.py",
    threadEntryPointId: "app.py:create_user_route",
  });
  await waitFor("chat-done");
  assert.ok(routedPayload, "node dispatch must route");
  const m = routedPayload.matches[0];
  assert.equal(m.entryPointId, "db.py:query", JSON.stringify(routedPayload.matches));
  assert.ok(m.matchedOn.includes("module/query.fn"), JSON.stringify(m.matchedOn));
  // The skill body already rode this session on turn 1 → honest dedup line.
  assert.equal(m.skillInjected, false);
  const turn = fs.readFileSync(promptLog, "utf-8").slice(before.length);
  assert.match(turn, /Routed context — this question touches threads beyond the active one/);
  assert.match(turn, /already in this session's context/);
});
