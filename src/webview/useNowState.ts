// The "now" summary in the GUI (2026-10-16, src/server/now_state.ts): asked
// for on mount and again whenever something it summarises may have moved — a
// re-derive, the plan, the inbox, the project's direction.

import { useEffect, useState } from "react";
import { bridge, type ExtensionMessage } from "./types";
import type { NowState } from "../shared/now_wire";

const MOVES = new Set(["project-update", "plan-state", "inbox-state", "project-direction", "brief-state", "rules-state"]);

export function useNowState(enabled: boolean): NowState | null {
  const [now, setNow] = useState<NowState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let queued = false;
    // several moves arrive together (a decision echoes inbox + plan): ask once
    const ask = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; bridge.postMessage({ type: "now-get" } as never); }, 150); };
    const onMsg = (m: ExtensionMessage) => {
      const t = (m as { type: string }).type;
      if (t === "now-state") setNow((m as unknown as { payload: NowState | null }).payload);
      else if (MOVES.has(t)) ask();
    };
    bridge.onMessage(onMsg);
    bridge.postMessage({ type: "now-get" } as never);
    return () => bridge.removeListener(onMsg);
  }, [enabled]);
  return now;
}
