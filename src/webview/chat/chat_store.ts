// M-CHAT-POLISH.2 — the main chat's transcript store.
//
// The ChatPanel unmounts whenever the chat closes (App mounts it
// conditionally — and fileview-chat-retract pins that the DOM node
// really goes away), but the SERVER session survives on the same WS.
// Holding the transcript in component state meant close → reopen showed
// a blank panel talking to an agent that remembered everything — the
// M27.3 resumed-note existed to apologise for exactly this. The store
// lifts segments/busy/draft to module scope: the bridge handler runs
// for the app's lifetime (streaming continues while the panel is
// closed), and remounts just re-subscribe.
//
// Scoped ("stage:<itemId>") chat traffic is a different conversation —
// the StageDetailDialog owns it; this store ignores it, as the panel
// always has.

import { bridge, type ExtensionMessage } from "../types";

// ── segment types (moved verbatim from ChatPanel — M25 shapes) ────────────────

export interface UserSegment {
  kind: "user";
  id: string;
  text: string;
}

export interface AssistantSegment {
  kind: "assistant";
  id: string;
  text: string;
  streaming: boolean;
}

export interface ToolSegment {
  kind: "tool";
  id: string;
  // M-CHAT-POLISH.1 — the backend's tool_use id; a chat-tool-result pairs
  // to its card by this, not by name (results carry no name on the wire).
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  success?: boolean;
  message?: string;
}

// M-SKILL.2 — remit-routing provenance: the server matched this question
// against other threads' remits and (maybe) injected their ratified skills.
// Rendered as a muted information line above the reply, never decoration.
export interface RoutedSegment {
  kind: "routed";
  id: string;
  matches: Array<{ entryPointId: string; qualifiedName: string; matchedOn: string[]; skillInjected: boolean; skillStale?: boolean; skillMissing?: "absent" | "draft"; skillOverBudget?: boolean; skillAlreadyShared?: boolean }>;
  /** The question matched the thread already open — reported, not routed
   * (its full context is in the prompt already). */
  selfMatch?: { qualifiedName: string; matchedOn: string[] };
}

export type Segment = UserSegment | AssistantSegment | ToolSegment | RoutedSegment;

export type ChatBackendId = "claude-stdio" | "claude-p-headless" | "agent-sdk";

export interface ChatSnapshot {
  segments: Segment[];
  busy: boolean;
  backendId: ChatBackendId | null;
  // M27.3 — honesty: the SERVER session may predate the whole store
  // (page reload over a surviving connection is no longer possible —
  // sessions die with the WS — but a crash-resumed CLI session is).
  resumedNote: boolean;
  // The composer text survives close/reopen with the transcript.
  draft: string;
  // Chosen model (`--model`), or null for the CLI's own default. Lives
  // here rather than in ChatPanel because the panel unmounts freely
  // (docking/undocking on selection) and the choice must outlive that.
  model: string | null;
}

let _segId = 0;
function nextId() { return `s${++_segId}`; }

let state: ChatSnapshot = {
  segments: [],
  busy: false,
  backendId: null,
  resumedNote: false,
  draft: "",
  model: null,
};

let sawBackendInfo = false;
// M27.3 — New chat: cleared transcript now; clearHistory rides the NEXT
// send (the server disposes the session and opens a fresh one).
let resetPending = false;

const listeners = new Set<() => void>();

function emit(patch: Partial<ChatSnapshot>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribeChat(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChatSnapshot(): ChatSnapshot {
  return state;
}

export function setChatDraft(draft: string): void {
  emit({ draft });
}

/** Model for subsequent turns; null = the CLI's own default. Survives
 * New chat — it is a user preference, not conversation state. */
export function setChatModel(model: string | null): void {
  emit({ model });
}

/** Append the user's message and mark the turn in flight. Returns the
 * payload flags the component's chat-send must carry (clearHistory is
 * consumed here — one armed New-chat rides exactly one send). */
export function beginChatTurn(text: string): { clearHistory: boolean } {
  emit({
    segments: [...state.segments, { kind: "user", id: nextId(), text } as UserSegment],
    busy: true,
    draft: "",
  });
  const clearHistory = resetPending;
  resetPending = false;
  return { clearHistory };
}

/** M27.3 — New chat: the ONLY forgetting path. Empties the transcript
 * and arms clearHistory for the next send. */
export function newChat(): void {
  resetPending = true;
  emit({ segments: [], resumedNote: false });
}

function sealStreaming(segments: Segment[]): Segment[] {
  return segments.map((s) =>
    s.kind === "assistant" && s.streaming ? { ...s, streaming: false } : s
  );
}

function handleChatMessage(msg: ExtensionMessage): void {
  // M-GF3.4 — scoped chat traffic belongs to a stage dialogue
  // (StageDetailDialog), never to the main panel.
  if ("payload" in msg && (msg.payload as { scope?: string } | undefined)?.scope) return;
  if (msg.type === "chat-backend-info") {
    const patch: Partial<ChatSnapshot> = { backendId: msg.payload.backend };
    if (!sawBackendInfo) {
      sawBackendInfo = true;
      if (msg.payload.resumed) patch.resumedNote = true;
    }
    emit(patch);
  } else if (msg.type === "chat-routed") {
    emit({ segments: [...state.segments, { kind: "routed", id: nextId(), matches: msg.payload.matches, selfMatch: (msg.payload as any).selfMatch } as RoutedSegment] });
  } else if (msg.type === "chat-chunk") {
    const prev = state.segments;
    const last = prev[prev.length - 1];
    if (last?.kind === "assistant" && last.streaming) {
      emit({ segments: [...prev.slice(0, -1), { ...last, text: last.text + msg.payload.text }] });
    } else {
      emit({ segments: [...prev, { kind: "assistant", id: nextId(), text: msg.payload.text, streaming: true } as AssistantSegment] });
    }
  } else if (msg.type === "chat-tool-use") {
    emit({
      segments: [
        ...sealStreaming(state.segments),
        {
          kind: "tool",
          id: nextId(),
          toolUseId: msg.payload.toolUseId,
          name: msg.payload.toolName,
          input: msg.payload.toolInput,
        } as ToolSegment,
      ],
    });
  } else if (msg.type === "chat-tool-result") {
    const prev = state.segments;
    // Pair by toolUseId; an empty id (defensive) falls back to the
    // latest unresolved card so a result is never silently dropped.
    const idx = [...prev].reverse().findIndex(
      (s) =>
        s.kind === "tool" &&
        (s as ToolSegment).success === undefined &&
        (msg.payload.toolUseId ? (s as ToolSegment).toolUseId === msg.payload.toolUseId : true)
    );
    if (idx === -1) return;
    const realIdx = prev.length - 1 - idx;
    const seg = prev[realIdx] as ToolSegment;
    emit({
      segments: [
        ...prev.slice(0, realIdx),
        { ...seg, success: msg.payload.success, message: msg.payload.message },
        ...prev.slice(realIdx + 1),
      ],
    });
  } else if (msg.type === "chat-done") {
    emit({ segments: sealStreaming(state.segments), busy: false });
  } else if (msg.type === "chat-error") {
    emit({
      segments: [
        ...sealStreaming(state.segments),
        { kind: "assistant", id: nextId(), text: `Error: ${msg.payload.message}`, streaming: false } as AssistantSegment,
      ],
      busy: false,
    });
  }
}

// Register ONCE for the app's lifetime, idempotently — a second import
// (or an HMR-style double eval) must not double-append segments.
declare global {
  interface Window { __vgChatStoreWired?: boolean }
}
if (!window.__vgChatStoreWired) {
  window.__vgChatStoreWired = true;
  bridge.onMessage(handleChatMessage);
}
