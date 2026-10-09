// RECORDED RUNS on the map (2026-10-08, rung 4 of the run-time ladder). Zero
// tokens. The recorder (scripts/node_tracer.mjs) leaves one JSON line per
// operation it saw in .vibegraph/traces/<run>.jsonl — {actor, action, zone} —
// and this folds them in: the actor's script is a box's entry point, the zone
// a zone on the map. An operation the code also shows is CONFIRMED (the edge
// lists the runs); one it does not show is OBSERVED — a new edge, said as such.
// A run proves only the paths it took: an edge no run saw keeps its own kind.

import * as fs from "fs";
import * as path from "path";
import type { ArchModelRecord } from "../shared/protocol.ts";

export interface ObservedOp { box: string; zone: string; op: "watch" | "read" | "write"; runs: string[] }

const TRACES = path.join(".vibegraph", "traces");

/** The recorder's events, by run (other lines in the folder are not ours). */
export function readRuns(root: string): Array<{ run: string; actor: string; action: string; zone: string }> {
  const out: Array<{ run: string; actor: string; action: string; zone: string }> = [];
  let names: string[] = [];
  try { names = fs.readdirSync(path.join(root, TRACES)).filter((f) => f.endsWith(".jsonl")).sort(); } catch { return out; }
  for (const f of names) {
    let text = "";
    try { text = fs.readFileSync(path.join(root, TRACES, f), "utf-8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e?.source === "vibegraph-tracer" && typeof e.actor === "string" && typeof e.action === "string" && typeof e.zone === "string") out.push({ run: f.replace(/\.jsonl$/, ""), actor: e.actor, action: e.action, zone: e.zone });
      } catch { /* a broken line is skipped; the run's other lines stand */ }
    }
  }
  return out;
}

/** Each (box, zone, op) some run saw, with the runs that saw it. */
export function observedOps(root: string, model: ArchModelRecord): ObservedOp[] {
  const events = readRuns(root);
  if (!events.length) return [];
  const boxesOf = (file: string) => model.nodes.filter((n) => n.kind === "cluster" && (n.entryPoints ?? []).some((ep) => ep.split(":")[0] === file)).map((n) => n.id);
  const zoneIds = (z: string) => model.nodes.filter((n) => n.zoneOf && (n.label === z || n.id === z || n.id.endsWith(`/${z}`) || n.zoneOf.holds.includes(z))).map((n) => n.id);
  const by = new Map<string, ObservedOp>();
  for (const e of events) {
    if (e.zone === "unmatched" || !["watch", "read", "write"].includes(e.action)) continue;
    for (const box of boxesOf(e.actor)) for (const zone of zoneIds(e.zone)) {
      const k = `${box}|${zone}|${e.action}`;
      const o = by.get(k) ?? { box, zone, op: e.action as ObservedOp["op"], runs: [] };
      if (!o.runs.includes(e.run)) o.runs.push(e.run);
      by.set(k, o);
    }
  }
  return [...by.values()];
}

/** The map with what the runs saw: confirmed edges list their runs, new ones are `observed`. */
export function withObserved(model: ArchModelRecord, observed: ObservedOp[]): ArchModelRecord {
  if (!observed.length) return model;
  const edges = model.edges.map((e) => {
    const o = observed.find((x) => x.box === e.from && x.zone === e.to && x.op === e.protocol);
    return o && !e.evidence ? { ...e, observedRuns: o.runs.length, protocolBasis: `${e.protocolBasis} — observed in ${o.runs.length} recorded run${o.runs.length === 1 ? "" : "s"} (${o.runs.slice(-1)[0]})` } : e;
  });
  for (const o of observed) {
    if (edges.some((e) => e.from === o.box && e.to === o.zone && e.protocol === o.op)) continue;
    edges.push({
      id: `${o.box}->${o.zone}:observed:${o.op}`, from: o.box, to: o.zone, kind: "uses", protocol: o.op,
      protocolBasis: `observed in ${o.runs.length} recorded run${o.runs.length === 1 ? "" : "s"} (${o.runs.slice(-1)[0]}) — the code alone does not show it; a run proves only the paths it took`,
      count: o.runs.length, threads: [], confidence: "called", source: "derived", evidence: "observed", refs: [],
    });
  }
  return { ...model, edges };
}
