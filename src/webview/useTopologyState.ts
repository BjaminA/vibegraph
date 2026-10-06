// The declared topology in the webview (2026-10-02): the Resources and
// Decisions lenses and the trace overlay read it. Asked for on mount and after
// every re-derive (a regenerated topology moves with the export).

import { useEffect, useState } from "react";
import { bridge, type ExtensionMessage } from "./types";
import type { TopologyModel } from "../shared/topology_types";
import type { TopologyDrift, TraceStep } from "../shared/topology_analysis";
import type { LiveInventory } from "../shared/live_inventory";

export interface TopologyState {
  model: TopologyModel | null;
  live: { at: string; drift: TopologyDrift } | null;
  inventory?: { at: string; command: string; inventory: LiveInventory } | null;
  traces: Array<{ name: string; steps: TraceStep[]; errors: string[] }>;
}

export function useTopologyState(): TopologyState {
  const [state, setState] = useState<TopologyState>({ model: null, live: null, traces: [] });
  useEffect(() => {
    const ask = () => bridge.postMessage({ type: "topology-get" } as never);
    // Every re-derive asks again; an unchanged reply keeps the same state
    // object, so nothing downstream (the map's model and layout) recomputes.
    let last = "";
    const handler = (msg: ExtensionMessage) => {
      const t = (msg as { type: string }).type;
      if (t === "topology-state") {
        const payload = (msg as unknown as { payload: TopologyState }).payload;
        const text = JSON.stringify(payload);
        if (text === last) return;
        last = text;
        setState(payload);
      }
      else if (t === "project-update") ask();
    };
    bridge.onMessage(handler);
    ask();
    return () => bridge.removeListener(handler);
  }, []);
  return state;
}
