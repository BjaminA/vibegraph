// The declared topology in the running app (2026-10-02): `topology-get` → the
// merged model, the drift against the last live inventory (`topology live`
// saved it), and every saved trace replayed against the declaration. Read-only:
// the app never runs a generator or a live command — those are a person's CLI
// steps.

import * as fs from "fs";
import * as path from "path";
import type { TopologyModel } from "../shared/topology_types.ts";
import { TOPOLOGY_DIR, loadTopology, validateTopology } from "./topology_store.ts";
import { diffTopology, parseTrace, replayTrace, type TopologyDrift, type TraceStep } from "../shared/topology_analysis.ts";

export interface TopologyReply {
  model: TopologyModel;
  live: { at: string; drift: TopologyDrift } | null;
  traces: Array<{ name: string; steps: TraceStep[]; errors: string[] }>;
}

export function topologyState(root: string): TopologyReply {
  const model = loadTopology(root);
  let live: TopologyReply["live"] = null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, TOPOLOGY_DIR, "live.json"), "utf-8"));
    if (!validateTopology(raw.topology)) live = { at: String(raw.at), drift: diffTopology(model.topology, raw.topology) };
  } catch { /* no live inventory saved */ }
  const traces: TopologyReply["traces"] = [];
  const dir = path.join(root, TOPOLOGY_DIR, "traces");
  try {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort().slice(0, 20)) {
      const { events, errors } = parseTrace(fs.readFileSync(path.join(dir, f), "utf-8"));
      traces.push({ name: f.replace(/\.jsonl$/, ""), steps: replayTrace(model.topology, events.slice(0, 2000)), errors });
    }
  } catch { /* no traces saved */ }
  return { model, live, traces };
}
