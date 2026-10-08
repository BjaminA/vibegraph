// The decision inbox in the GUI (2026-10-06, direction review M11): the same
// list `vibegraph-knowledge inbox` prints and the Stop hook counts, asked for
// on mount and after every re-derive, echoed back after each decision.

import { useEffect, useState } from "react";
import { bridge, type ExtensionMessage } from "./types";

export interface InboxItemView { id: string; kind: string; title: string; detail: string[]; decidable: boolean }
/** `answered` counts replies to a decision (they carry a message or an
 *  error): the panel clears what it was waiting on when it moves. */
export interface InboxState { items: InboxItemView[]; pending: number; message?: string; error?: string; loaded: boolean; answered: number }

export function sendInboxDecision(id: string, decision: "agree" | "reject"): void {
  bridge.postMessage({ type: "inbox-decide", payload: { id, decision } } as never);
}

export function useInboxState(enabled: boolean): InboxState {
  const [state, setState] = useState<InboxState>({ items: [], pending: 0, loaded: false, answered: 0 });
  useEffect(() => {
    if (!enabled) return;
    const ask = () => bridge.postMessage({ type: "inbox-get" } as never);
    const handler = (msg: ExtensionMessage) => {
      const m = msg as unknown as { type: string; payload?: { items?: InboxItemView[]; message?: string; error?: string } };
      if (m.type === "inbox-state") {
        const items = m.payload?.items ?? [];
        // a decision's reply is followed by a refresh (every re-derive asks
        // again): the last message stays until a new one replaces it
        const said = m.payload?.message !== undefined || m.payload?.error !== undefined;
        setState((prev) => ({
          items, pending: items.filter((i) => i.decidable).length, loaded: true,
          message: said ? m.payload?.message : prev.message, error: said ? m.payload?.error : prev.error,
          answered: prev.answered + (said ? 1 : 0),
        }));
      } else if (m.type === "project-update" || m.type === "plan-state") ask();
    };
    bridge.onMessage(handler);
    ask();
    return () => bridge.removeListener(handler);
  }, [enabled]);
  return state;
}
