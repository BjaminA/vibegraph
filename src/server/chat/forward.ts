// ChatEvent → webview WS payload relay, extracted from server.ts
// (M-CHAT-POLISH.1). One function, no state — unit-testable without a
// real WebSocket (anything with .send(string) qualifies).
//
// M-GF3.4 — `scope` rides every payload for a NON-main conversation
// ("stage:<itemId>"): the ChatPanel ignores scoped messages, the stage
// dialog renders only its own scope. Absent scope = the main panel.
//
// M-CHAT-POLISH.1 — `toolUseId` rides both tool payloads so the client
// can pair a result to its card by id. tool-use-end carries no tool
// name in ChatEvent, and we no longer invent one ("(mcp)" was a lie
// that matched nothing and left every tool card spinning forever).

import type { ChatEvent } from "./backend";

export interface ChatEventSink {
  send(data: string): void;
}

export function forwardChatEvent(ev: ChatEvent, ws: ChatEventSink, scope?: string): void {
  const scoped = (payload: Record<string, unknown>) =>
    scope ? { ...payload, scope } : payload;
  switch (ev.type) {
    case "token":
      ws.send(JSON.stringify({ type: "chat-chunk", payload: scoped({ text: ev.delta }) }));
      return;
    case "tool-use-start":
      ws.send(JSON.stringify({
        type: "chat-tool-use",
        payload: scoped({ toolUseId: ev.toolUseId, toolName: ev.name, toolInput: ev.args }),
      }));
      return;
    case "tool-use-end": {
      const message = typeof ev.result === "string"
        ? ev.result
        : ev.result == null ? undefined : JSON.stringify(ev.result);
      ws.send(JSON.stringify({
        type: "chat-tool-result",
        payload: scoped({
          toolUseId: ev.toolUseId,
          success: !ev.isError,
          message: message || undefined,
        }),
      }));
      return;
    }
    case "error":
      ws.send(JSON.stringify({ type: "chat-error", payload: scoped({ message: ev.message }) }));
      return;
    case "done":
      ws.send(JSON.stringify({ type: "chat-done", payload: scoped({}) }));
      return;
    case "agent-step":
      // Not surfaced to the webview today; M10.4 may render step boundaries.
      return;
  }
}
