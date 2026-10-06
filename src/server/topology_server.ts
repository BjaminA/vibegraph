// The declared topology in the running app (2026-10-02): `topology-get` → the
// merged model, the drift against the last live inventory (`topology live`
// saved it), and every saved trace replayed against the declaration. Read-only:
// the app never runs a generator or a live command — those are a person's CLI
// steps.

import * as fs from "fs";
import * as path from "path";
import type { Topology, TopologyModel } from "../shared/topology_types.ts";
import { TOPOLOGY_DIR, loadTopology } from "./topology_store.ts";
import { diffTopology, parseTrace, replayTrace, type TopologyDrift, type TraceStep } from "../shared/topology_analysis.ts";
import { loadLive } from "./topology_live.ts";
import type { LiveInventory } from "../shared/live_inventory.ts";

export interface TopologyReply {
  model: TopologyModel;
  live: { at: string; drift: TopologyDrift } | null;
  /** M8: an inventory of what is provisioned, counted against the declared zones on the map */
  inventory: { at: string; command: string; inventory: LiveInventory } | null;
  traces: Array<{ name: string; steps: TraceStep[]; errors: string[] }>;
}

let derivedMemo: { stack: unknown; threads: unknown; value: Topology | undefined } | null = null;

/** The derived topology costs ~0.3 s on a large project and every re-derive
 *  makes every open client ask for it again. It reads the parse, the stack and
 *  the threads; the stack index is rebuilt (a new object) on every derived
 *  pass, so the identity of stack + threads says when to recompute. A config
 *  file no derived pass watches is re-read at the next pass, not before. */
export function derivedTopologyOnce(stack: unknown, threads: unknown, compute: () => Topology | undefined): Topology | undefined {
  if (derivedMemo && derivedMemo.stack === stack && derivedMemo.threads === threads) return derivedMemo.value;
  const value = compute();
  derivedMemo = { stack, threads, value };
  return value;
}

/** `derived` — the topology read from the code (data_arch.ts), the lowest-ranked source. */
export function topologyState(root: string, derived?: Topology): TopologyReply {
  const model = loadTopology(root, derived);
  const saved = loadLive(root);
  const live: TopologyReply["live"] = saved?.topology ? { at: saved.at, drift: diffTopology(model.topology, saved.topology) } : null;
  const inventory: TopologyReply["inventory"] = saved?.inventory ? { at: saved.at, command: saved.command, inventory: saved.inventory } : null;
  const traces: TopologyReply["traces"] = [];
  const dir = path.join(root, TOPOLOGY_DIR, "traces");
  try {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort().slice(0, 20)) {
      const { events, errors } = parseTrace(fs.readFileSync(path.join(dir, f), "utf-8"));
      traces.push({ name: f.replace(/\.jsonl$/, ""), steps: replayTrace(model.topology, events.slice(0, 2000)), errors });
    }
  } catch { /* no traces saved */ }
  return { model, live, inventory, traces };
}
