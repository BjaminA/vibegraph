// M10.3 — backend status pill (extracted from ChatPanel in
// M-CHAT-POLISH.4's line-ceiling pass, verbatim). Streaming dot in
// --accent-thread for agent-sdk, muted dot for headless. Hidden until
// the server announces a backend on the first chat-send.
import React from "react";
import type { ChatBackendId } from "./chat_store";

export function BackendPill({ backendId }: { backendId: ChatBackendId }) {
  return (
    <span
      title={
        backendId === "agent-sdk"
          ? "Streaming · Agent SDK (ANTHROPIC_API_KEY set)"
          : backendId === "claude-stdio"
            ? "Session · one claude process, conversation memory between messages (your Claude Code auth)"
            : "Headless · claude -p (no API key — using your Claude Code auth)"
      }
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
          background: backendId === "agent-sdk" ? "var(--accent-thread)" : "var(--text-secondary)",
        }}
      />
      {backendId === "agent-sdk"
        ? "Streaming · Agent SDK"
        : backendId === "claude-stdio"
          ? "Session · claude"
          : "Headless · claude -p"}
    </span>
  );
}
