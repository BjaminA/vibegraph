// M10.3 — backend status pill (extracted from ChatPanel in
// M-CHAT-POLISH.4's line-ceiling pass, verbatim). Streaming dot in
// --accent-thread for agent-sdk, muted dot for headless. Hidden until
// the server announces a backend on the first chat-send.
// M-PROVIDER — "ollama": the chat is on the LOCAL server from the Models
// panel (streamed, in-memory conversation, MCP tools; no claude process).
import React from "react";
import type { ChatBackendId } from "./chat_store";

const TITLE: Record<ChatBackendId, string> = {
  "agent-sdk": "Streaming · Agent SDK (ANTHROPIC_API_KEY set)",
  "claude-stdio": "Session · one claude process, conversation memory between messages (your Claude Code auth)",
  "claude-p-headless": "Headless · claude -p (no API key — using your Claude Code auth)",
  "ollama": "Local · Ollama server from the Models panel — streamed, conversation memory in this session, vibegraph tools available",
};

const LABEL: Record<ChatBackendId, string> = {
  "agent-sdk": "Streaming · Agent SDK",
  "claude-stdio": "Session · claude",
  "claude-p-headless": "Headless · claude -p",
  "ollama": "Local · Ollama",
};

export function BackendPill({ backendId }: { backendId: ChatBackendId }) {
  const live = backendId === "agent-sdk" || backendId === "ollama";
  return (
    <span
      data-chat-backend={backendId}
      title={TITLE[backendId] ?? backendId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        color: "var(--text-muted)",
        fontFamily: "Inter, sans-serif",
        padding: "2px 8px",
        borderRadius: 4,
        border: "1px solid var(--border-edge)",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: live ? "var(--accent-thread)" : "var(--text-secondary)",
        }}
      />
      {LABEL[backendId] ?? backendId}
    </span>
  );
}
