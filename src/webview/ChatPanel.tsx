// Parked by M10-chat-removal, revived in M25: the in-GUI agent chat.
// Each message spawns `claude -p` with an inline MCP config pointing
// back at this server — the same loop as a terminal Claude Code session.
import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
// M-CHAT-POLISH.4 — the tool activity card (icon map, per-tool argument
// summary, click-to-expand full command) and the routed provenance line
// live in their own modules.
import { ToolCard } from "./chat/ToolCard";
import { RoutedLine } from "./chat/RoutedLine";
import { BackendPill } from "./chat/BackendPill";

// UI polish (2026-07-26) — the full-width bar is user-resizable (drag the
// top edge). The live height is published as --vg-chat-height so every
// control that lifts clear of the bar (chat toggle, roadmap panel, compose
// error, show-hidden) follows the drag instead of assuming 320px.
const CHAT_BAR_DEFAULT_H = 320;
const CHAT_BAR_MIN_H = 200;
const CHAT_BAR_HEIGHT_KEY = "vg-chat-bar-height";

function clampBarHeight(h: number): number {
  const max = Math.max(CHAT_BAR_MIN_H, window.innerHeight - 120);
  return Math.min(Math.max(h, CHAT_BAR_MIN_H), max);
}

function initialBarHeight(): number {
  const stored = Number(window.localStorage.getItem(CHAT_BAR_HEIGHT_KEY));
  return clampBarHeight(Number.isFinite(stored) && stored > 0 ? stored : CHAT_BAR_DEFAULT_H);
}
import { bridge, type AstNode } from "./types";
// M-CHAT-POLISH.2 — segment types + the transcript live in the module
// store, so closing the panel (unmount) no longer erases the history
// the server-side session still remembers.
import {
  beginChatTurn,
  getChatSnapshot,
  newChat as storeNewChat,
  setChatDraft,
  setChatModel,
  subscribeChat,
} from "./chat/chat_store";
import { CHAT_MODELS } from "../shared/chat_models";
import { Markdown } from "./util/Markdown";

// ── main component ────────────────────────────────────────────────────────────

interface Props {
  contextNode: AstNode | null;
  activeFilePath?: string | null;
  // M26.3 — the thread the user is looking at (App's activeEntryPointId);
  // rides chat-send so handleChat can frame the cross-file flow instead
  // of a single-file lens.
  threadEntryPointId?: string | null;
  // M27.3 — tile clear of the right-side editor/CodeView docks (they
  // sit above this panel in z; without the inset the header actions
  // are unclickable while a node is selected).
  rightInset?: number | string;
  // M28.3 — when set, the chat is DOCKED at the bottom of the right-side
  // code column (always present, no close button) instead of the
  // full-width bottom bar. Right-anchored: width + right, left auto.
  dock?: { left?: number | string; right?: number | string; width?: number | string; height?: number };
  // U1.2: in directory mode the side panel takes the leftmost 280px,
  // so the chat needs to inset left or its content sits underneath.
  isDirectoryMode?: boolean;
  focusTrigger?: number;
  // Sitting-2 — input prefill from a failed-run card ("Ask Claude about this
  // error"). seq bumps per click so repeated asks re-apply.
  prefill?: { text: string; seq: number } | null;
  // The thread the chat is scoped to, shown as a chip. Detaching is
  // chat-only — it never navigates the canvas away from the thread.
  threadLabel?: string | null;
  threadDetached?: boolean;
  onToggleThreadAttach?: () => void;
  onClearContext: () => void;
}

export function ChatPanel({ contextNode, activeFilePath, threadEntryPointId, rightInset, dock, isDirectoryMode, focusTrigger, prefill, threadLabel, threadDetached, onToggleThreadAttach, onClearContext }: Props) {
  const docked = !!dock;
  // Drag-resizable full-width bar height (docked height stays owner-driven).
  const [barHeight, setBarHeight] = useState<number>(initialBarHeight);
  // M-CHAT-POLISH.2 — transcript/busy/backend/draft come from the module
  // store; this component is a view over it and unmounts freely.
  const { segments, busy, backendId, resumedNote, draft: input, model } = useSyncExternalStore(
    subscribeChat,
    getChatSnapshot
  );
  const setInput = setChatDraft;
  const setModel = setChatModel;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments]);

  // Focus input on mount and whenever focusTrigger bumps (called when chat opens via node sparkle button)
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [focusTrigger]);

  // The prompt box grows with its content (up to 120px, then scrolls) —
  // a fixed one-row textarea hid every line after the first while typing.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  // Publish the full-width bar's height so lifted controls track the drag.
  useEffect(() => {
    if (docked) return;
    document.documentElement.style.setProperty("--vg-chat-height", `${barHeight}px`);
    return () => {
      document.documentElement.style.removeProperty("--vg-chat-height");
    };
  }, [docked, barHeight]);

  // Drag the top edge to resize (full-width bar only).
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: barHeight };
  }, [barHeight]);
  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setBarHeight(clampBarHeight(d.startH + (d.startY - e.clientY)));
  }, []);
  const onResizeEnd = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setBarHeight((h) => {
      window.localStorage.setItem(CHAT_BAR_HEIGHT_KEY, String(h));
      return h;
    });
  }, []);

  // Sitting-2 — a failed run's "Ask Claude about this error" prefills the
  // input (prop-carried so it survives the panel mounting AFTER the click).
  // PREFILL ONLY: the human reviews and sends; nothing auto-sends.
  useEffect(() => {
    if (!prefill?.text) return;
    setInput(prefill.text);
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.seq]);

  // M-CHAT-POLISH.2 — server-message handling lives in chat_store.ts,
  // registered once for the app's lifetime: streaming keeps landing in
  // the transcript even while this panel is closed.

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    const { clearHistory } = beginChatTurn(text);
    bridge.postMessage({
      type: "chat-send",
      payload: {
        text,
        contextNodeId: contextNode?.id ?? null,
        filePath: activeFilePath ?? undefined,
        threadEntryPointId: threadEntryPointId ?? null,
        clearHistory: clearHistory || undefined,
        model: model ?? undefined,
      },
    });
  }, [input, busy, contextNode, activeFilePath, threadEntryPointId, model]);

  // M27.3 — New chat: empty the transcript now; the server session is
  // dropped on the next send (clearHistory). Affordance matches the
  // operation: the agent genuinely forgets, unlike the old local-only
  // "Clear" which left the server session's memory intact.
  const newChat = storeNewChat;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const contextLabel = contextNode
    ? (contextNode as any).name ?? (contextNode as any).funcName ?? (contextNode as any).target ?? contextNode.type
    : null;

  return (
    <div
      data-chat-panel
      style={{
        position: "fixed",
        bottom: 0,
        // M28.3 — docked under the code column: right-anchored, region
        // width, no left inset. Otherwise the full-width bottom bar that
        // clears the side panel (280px) in directory mode (U1.2).
        left: docked ? (dock!.left ?? "auto") : (isDirectoryMode ? 280 : 0),
        right: docked ? (dock!.right ?? 0) : (rightInset ?? 0),
        width: docked ? dock!.width : undefined,
        height: docked ? (dock!.height ?? 320) : barHeight,
        transition: docked ? "none" : "right var(--motion-view-dur) var(--motion-view-ease)",
        background: "var(--bg-node)",
        borderTop: "2px solid var(--border-edge)",
        // A left edge when docked so it reads as its own column footer.
        borderLeft: docked ? "1px solid var(--border-edge)" : undefined,
        display: "flex",
        flexDirection: "column",
        zIndex: 900,
        boxShadow: "0 -8px 40px hsl(0 0% 0% / 0.5)",
      }}
    >
      {/* ── resize handle (full-width bar only) — drag up to grow ── */}
      {!docked && (
        <div
          data-chat-resize-handle
          title="Drag to resize the chat"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          style={{
            position: "absolute",
            top: -5,
            left: 0,
            right: 0,
            height: 10,
            cursor: "ns-resize",
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            touchAction: "none",
          }}
        >
          <div
            style={{
              width: 48,
              height: 4,
              borderRadius: 2,
              background: "var(--border-edge)",
            }}
          />
        </div>
      )}
      {/* ── header ── */}
      <div
        style={{
          padding: "8px 14px",
          borderBottom: "1px solid var(--border-edge)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--bg-node)",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "var(--accent-chat)", fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Claude Chat
        </span>

        {backendId && <BackendPill backendId={backendId} />}

        {/* Which thread the chat is scoped to. "Session · claude" said
            nothing, so there was no way to tell that a question about the
            open thread is deliberately not re-routed — it just looked like
            routing had failed. Attached = that thread's full context rides
            the prompt; detached = routing may reach it like any other. */}
        {threadLabel && (
          <button
            data-chat-thread-chip
            data-attached={threadDetached ? "false" : "true"}
            onClick={onToggleThreadAttach}
            title={threadDetached
              ? `Detached from ${threadLabel} — routing can match every thread, including this one. Click to re-attach.`
              : `Scoped to ${threadLabel} — its full context (nodes, skill, artifacts) rides every turn, and routing skips it as already-present. Click to detach.`}
            style={{
              background: threadDetached
                ? "none"
                : "color-mix(in oklab, var(--accent-thread) 10%, transparent)",
              border: `1px solid ${threadDetached
                ? "var(--border-edge)"
                : "color-mix(in oklab, var(--accent-thread) 30%, transparent)"}`,
              borderRadius: 4,
              color: threadDetached ? "var(--text-muted)" : "var(--accent-thread)",
              fontSize: 10,
              padding: "2px 8px",
              marginRight: 6,
              cursor: "pointer",
              fontFamily: "monospace",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {threadDetached ? `all threads (${threadLabel} detached)` : `⑂ ${threadLabel}`}
            {!threadDetached && <span style={{ opacity: 0.6 }}>×</span>}
          </button>
        )}

        {contextLabel && (
          <button
            onClick={onClearContext}
            style={{
              background: "color-mix(in oklab, var(--accent-chat) 10%, transparent)",
              border: "1px solid color-mix(in oklab, var(--accent-chat) 30%, transparent)",
              borderRadius: 4,
              color: "var(--accent-chat)",
              fontSize: 10,
              padding: "2px 8px",
              cursor: "pointer",
              fontFamily: "monospace",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
            title="Clear node context"
          >
            ◈ {contextLabel}
            <span style={{ opacity: 0.6 }}>×</span>
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Model picker. "Default" sends no --model, which is exactly the
            pre-selector behaviour, so leaving it alone changes nothing.
            Switching mid-conversation KEEPS the session: the server
            respawns the child with --resume, so the agent still
            remembers. */}
        <select
          data-chat-model
          value={model ?? ""}
          onChange={(e) => setModel(e.target.value === "" ? null : e.target.value)}
          disabled={busy}
          title={
            busy
              ? "Model can't change mid-turn"
              : "Model for this chat — switching keeps the conversation"
          }
          style={{
            // Opaque, not "none": the open option list is drawn by the
            // browser over the canvas, and a transparent background lets
            // the code behind it read through.
            background: "var(--bg-node)",
            border: "1px solid var(--border-edge)",
            borderRadius: 4,
            color: "var(--text-muted)",
            fontSize: 10,
            padding: "2px 6px",
            marginRight: 6,
            cursor: busy ? "not-allowed" : "pointer",
            fontFamily: "monospace",
          }}
        >
          {CHAT_MODELS.map((m) => (
            <option
              key={m.id ?? "default"}
              value={m.id ?? ""}
              title={m.hint}
              style={{ background: "var(--bg-node)", color: "var(--text-primary)" }}
            >
              {m.label}
            </option>
          ))}
        </select>

        <button
          data-chat-new
          onClick={newChat}
          style={{
            background: "none",
            border: "1px solid var(--border-edge)",
            borderRadius: 4,
            color: "var(--text-muted)",
            fontSize: 10,
            padding: "2px 8px",
            cursor: "pointer",
            fontFamily: "monospace",
          }}
          title="Start a new conversation — the agent forgets this one"
        >
          New chat
        </button>

        {/* No in-header close: the docked chat is a permanent fixture of
            the code column (M28.3), and the full-width bar is closed by the
            floating sparkle toggle (which shows the one large X while
            open) — a second header X was a duplicate affordance. */}
      </div>

      {/* ── messages ── */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {/* M27.3 — honesty note: the session predates this panel mount,
            so the agent remembers messages not shown below. */}
        {resumedNote && (
          <div
            data-chat-resumed-note
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              fontFamily: "monospace",
              padding: "4px 0",
            }}
          >
            Continuing an earlier conversation — the agent remembers messages this panel no
            longer shows. “New chat” starts fresh.
          </div>
        )}
        {segments.length === 0 && (
          <div
            style={{
              color: "var(--border-edge)",
              fontSize: 12,
              fontFamily: "monospace",
              textAlign: "center",
              marginTop: 20,
            }}
          >
            {contextLabel
              ? `Ask about ${contextLabel}, or type a change request`
              : "Click a node to set context, then ask Claude to modify it"}
          </div>
        )}

        {segments.map((seg) => {
          if (seg.kind === "user") {
            return (
              <div key={seg.id} data-chat-user-msg style={{ display: "flex", justifyContent: "flex-end" }}>
                <div
                  style={{
                    background: "color-mix(in oklab, var(--type-call) 12%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--type-call) 25%, transparent)",
                    borderRadius: "10px 10px 2px 10px",
                    padding: "6px 10px",
                    maxWidth: "65%",
                    color: "var(--text-primary)",
                    fontSize: 12,
                    fontFamily: "monospace",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {seg.text}
                </div>
              </div>
            );
          }

          if (seg.kind === "assistant") {
            return (
              <div key={seg.id} data-chat-assistant-msg style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: "80%" }}>
                <div
                  style={{
                    color: "var(--text-primary)",
                    fontSize: 12,
                    fontFamily: "monospace",
                    lineHeight: 1.6,
                    wordBreak: "break-word",
                  }}
                >
                  {/* M-CHAT-POLISH.3 — replies render markdown (headings,
                      bold, bullets, fences, `code` chips); user messages
                      stay plain. Streaming-safe per markdown_parse.ts. */}
                  <Markdown text={seg.text} />
                  {seg.streaming && (
                    <span
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 12,
                        background: "var(--accent-chat)",
                        marginLeft: 2,
                        verticalAlign: "text-bottom",
                        animation: "vg-blink 1s step-end infinite",
                      }}
                    />
                  )}
                </div>
              </div>
            );
          }

          if (seg.kind === "tool") {
            return <ToolCard key={seg.id} seg={seg} />;
          }

          if (seg.kind === "routed") {
            return <RoutedLine key={seg.id} seg={seg} />;
          }

          return null;
        })}
      </div>

      {/* ── input ── */}
      <div
        style={{
          padding: "8px 14px 10px",
          borderTop: "1px solid var(--border-edge)",
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
          flexShrink: 0,
          background: "var(--bg-node)",
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
          placeholder={busy ? "Claude is thinking…" : "Ask Claude to modify the code… (Enter to send, Shift+Enter for newline)"}
          rows={1}
          style={{
            flex: 1,
            background: "var(--bg-node)",
            border: "1px solid var(--border-edge)",
            borderRadius: 6,
            color: busy ? "var(--text-muted)" : "var(--text-primary)",
            fontSize: 12,
            fontFamily: "monospace",
            padding: "6px 10px",
            resize: "none",
            outline: "none",
            lineHeight: 1.5,
            maxHeight: 120,
            overflowY: "auto",
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || busy}
          style={{
            background: !input.trim() || busy ? "var(--border-edge)" : "color-mix(in oklab, var(--accent-chat) 15%, transparent)",
            color: !input.trim() || busy ? "var(--border-edge)" : "var(--accent-chat)",
            border: `1px solid ${!input.trim() || busy ? "var(--border-edge)" : "color-mix(in oklab, var(--accent-chat) 40%, transparent)"}`,
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 11,
            fontWeight: 700,
            cursor: !input.trim() || busy ? "not-allowed" : "pointer",
            fontFamily: "monospace",
            transition: "all 0.12s",
            flexShrink: 0,
          }}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>

      {/* blink keyframe (injected once) */}
      <style>{`@keyframes vg-blink { 50% { opacity: 0; } }`}</style>
    </div>
  );
}
