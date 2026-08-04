/**
 * M-CHAT-POLISH.1 — forwardChatEvent unit test.
 *
 * The ChatEvent → webview WS payload relay must carry toolUseId on BOTH
 * tool payloads so the client can pair a result to its card. The old
 * relay stamped every result `toolName: "(mcp)"`, which matched no
 * pending card — tool spinners never resolved. Pin the honest shape.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/chat_forward.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardChatEvent } from "../src/server/chat/forward.ts";

function sink() {
  const sent = [];
  return { send: (data) => sent.push(JSON.parse(data)), sent };
}

test("tool-use-start forwards toolUseId + name + args", () => {
  const ws = sink();
  forwardChatEvent(
    { type: "tool-use-start", toolUseId: "tu-9", name: "Bash", args: { command: "ls" } },
    ws
  );
  assert.deepEqual(ws.sent, [
    { type: "chat-tool-use", payload: { toolUseId: "tu-9", toolName: "Bash", toolInput: { command: "ls" } } },
  ]);
});

test("tool-use-end forwards toolUseId and never invents a toolName", () => {
  const ws = sink();
  forwardChatEvent({ type: "tool-use-end", toolUseId: "tu-9", result: "ok" }, ws);
  assert.equal(ws.sent.length, 1);
  assert.equal(ws.sent[0].type, "chat-tool-result");
  assert.deepEqual(ws.sent[0].payload, { toolUseId: "tu-9", success: true, message: "ok" });
  assert.ok(!("toolName" in ws.sent[0].payload), "result payload must not carry a name");
});

test("tool-use-end with isError forwards success:false", () => {
  const ws = sink();
  forwardChatEvent({ type: "tool-use-end", toolUseId: "tu-2", result: "boom", isError: true }, ws);
  assert.deepEqual(ws.sent[0].payload, { toolUseId: "tu-2", success: false, message: "boom" });
});

test("scope rides every tool payload when present", () => {
  const ws = sink();
  forwardChatEvent(
    { type: "tool-use-start", toolUseId: "tu-1", name: "Read", args: {} },
    ws,
    "stage:item-3"
  );
  forwardChatEvent({ type: "tool-use-end", toolUseId: "tu-1", result: null }, ws, "stage:item-3");
  assert.equal(ws.sent[0].payload.scope, "stage:item-3");
  assert.equal(ws.sent[1].payload.scope, "stage:item-3");
  assert.equal(ws.sent[1].payload.message, undefined, "null result → no message");
});

test("token / error / done shapes are unchanged", () => {
  const ws = sink();
  forwardChatEvent({ type: "token", delta: "hi" }, ws);
  forwardChatEvent({ type: "error", message: "bad" }, ws);
  forwardChatEvent({ type: "done" }, ws);
  assert.deepEqual(ws.sent, [
    { type: "chat-chunk", payload: { text: "hi" } },
    { type: "chat-error", payload: { message: "bad" } },
    { type: "chat-done", payload: {} },
  ]);
});
