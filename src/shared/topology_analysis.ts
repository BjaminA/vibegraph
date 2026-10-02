// What the declared topology lets a reader follow (2026-10-02), pure and
// webview-safe — the CLI and the Decisions / Resources lenses read it alike.
//
//   decisionChain   decision node → the families it reads → their zones → who
//                   may write each: "can a requester forge the evidence this
//                   verdict rests on?" becomes a path to read, not a guess
//   diffTopology    the declared topology against a LIVE inventory (the
//                   platform's actual resources and grants, from a read-only
//                   command): undeclared resources, missing and extra grants
//   replayTrace     a JSON-lines event log checked event by event against the
//                   declared grants and decision structures

import type { Topology, TopoDecisionNode } from "./topology_types.ts";
import { whoMay, zoneOfFamily } from "./topology_query.ts";

export interface ChainLink { family: string; zone?: string; writers: string[]; readers: string[] }
export interface DecisionChain { tree: string; node: TopoDecisionNode; evaluatedBy?: string; evidence: ChainLink[]; path: string[] }

/** The evidence chain behind one decision node, and the path to it from the root. */
export function decisionChain(t: Topology, treeId: string, nodeId: string): DecisionChain | null {
  const tree = (t.decisionTrees ?? []).find((d) => d.id === treeId);
  const node = tree?.nodes.find((n) => n.id === nodeId);
  if (!tree || !node) return null;
  const evidence = (node.reads ?? []).map((r) => {
    const zone = r.startsWith("zone:") ? r.slice(5) : zoneOfFamily(t, r);
    const family = r.startsWith("zone:") ? `(zone ${r.slice(5)})` : r;
    return { family, zone, writers: zone ? [...new Set(whoMay(t, zone, "write").map((w) => w.principal))] : [], readers: zone ? [...new Set(whoMay(t, zone, "read").map((w) => w.principal))] : [] };
  });
  // root → node, by yes/no edges (breadth-first; a tree, but be safe about cycles).
  const parent = new Map<string, string>();
  const queue = [tree.root];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift()!;
    const n = tree.nodes.find((x) => x.id === id);
    for (const [k, next] of [["yes", n?.yes], ["no", n?.no]] as const) {
      if (next && !seen.has(next)) { seen.add(next); parent.set(next, `${id}:${k}`); queue.push(next); }
    }
  }
  const path: string[] = [];
  for (let cur: string | undefined = nodeId; cur && cur !== tree.root;) {
    const p = parent.get(cur);
    if (!p) break;
    path.unshift(p);
    cur = p.split(":")[0];
  }
  return { tree: treeId, node, ...(node.evaluatedBy ? { evaluatedBy: node.evaluatedBy } : {}), evidence, path };
}

export function formatChain(c: DecisionChain): string {
  const lines = [`${c.tree} › ${c.node.id}${c.node.question ? ` — ${c.node.question}` : ""}${c.node.outcome ? ` → outcome ${c.node.outcome}` : ""}`];
  if (c.path.length) lines.push(`  reached from the root by: ${c.path.join(" → ")}`);
  if (c.evaluatedBy) lines.push(`  evaluated by ${c.evaluatedBy}`);
  if (!c.evidence.length) lines.push("  reads no declared evidence");
  for (const e of c.evidence) {
    lines.push(`  reads ${e.family} → ${e.zone ? `zone ${e.zone}` : "NO ZONE (the family's zone is not declared)"}`
      + (e.zone ? ` → writable by ${e.writers.length ? e.writers.join(", ") : "NO ONE declared"}` : ""));
  }
  return lines.join("\n");
}

// ── live inventory ──

export interface TopologyDrift {
  undeclaredStores: string[];
  undeclaredZones: string[];
  missingZones: string[];
  /** declared, absent on the platform */
  missingGrants: string[];
  /** on the platform, not declared */
  extraGrants: string[];
}

const gkey = (g: { who: string; zone: string; access: string }) => `${g.who} ${g.access} ${g.zone}`;

export function diffTopology(declared: Topology, live: Topology): TopologyDrift {
  const ids = (xs?: Array<{ id: string }>) => new Set((xs ?? []).map((x) => x.id));
  const dS = ids(declared.stores), lS = ids(live.stores), dZ = ids(declared.zones), lZ = ids(live.zones);
  const dG = new Set((declared.grants ?? []).map(gkey)), lG = new Set((live.grants ?? []).map(gkey));
  return {
    undeclaredStores: [...lS].filter((x) => !dS.has(x)),
    undeclaredZones: [...lZ].filter((x) => !dZ.has(x)),
    missingZones: [...dZ].filter((x) => !lZ.has(x)),
    missingGrants: [...dG].filter((x) => !lG.has(x)),
    extraGrants: [...lG].filter((x) => !dG.has(x)),
  };
}

export const driftCount = (d: TopologyDrift) => d.undeclaredStores.length + d.undeclaredZones.length + d.missingZones.length + d.missingGrants.length + d.extraGrants.length;

// ── trace overlay ──

export interface TraceEvent {
  actor: string;
  action: "read" | "write" | "watch" | "decide" | "transition" | string;
  zone?: string;
  document?: string;
  /** decide: `tree:node` or `tree:node=outcome`; transition: `machine:from>to` */
  decision?: string;
  at?: string;
}

export interface TraceStep { i: number; event: TraceEvent; flags: string[] }

/** Parse a JSON-lines log; a malformed line is reported, never skipped silently. */
export function parseTrace(text: string): { events: TraceEvent[]; errors: string[] } {
  const events: TraceEvent[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const e = JSON.parse(line);
      if (typeof e?.actor !== "string" || typeof e?.action !== "string") errors.push(`line ${i + 1}: needs actor and action`);
      else events.push(e);
    } catch (err) { errors.push(`line ${i + 1}: not JSON (${(err as Error).message})`); }
  });
  return { events, errors };
}

/** Each event checked against the declaration: a write with no grant, an
 *  undeclared zone, a decision node or transition the topology does not have. */
export function replayTrace(t: Topology, events: TraceEvent[]): TraceStep[] {
  const zones = new Set((t.zones ?? []).map((z) => z.id));
  return events.map((event, i) => {
    const flags: string[] = [];
    if (event.zone && !zones.has(event.zone)) flags.push(`zone ${event.zone} is not declared`);
    if (event.zone && zones.has(event.zone) && (event.action === "write" || event.action === "read" || event.action === "watch")) {
      const access = event.action === "write" ? "write" : "read";
      const may = whoMay(t, event.zone, access).some((w) => w.principal === event.actor)
        || (access === "read" && whoMay(t, event.zone, "write").some((w) => w.principal === event.actor));
      if (!may) flags.push(`${event.actor} has no declared ${access} grant on ${event.zone}`);
    }
    if (event.action === "decide" && event.decision) {
      const [tree, rest = ""] = event.decision.split(":");
      const node = rest.split("=")[0];
      const d = (t.decisionTrees ?? []).find((x) => x.id === tree);
      if (!d) flags.push(`decision tree ${tree} is not declared`);
      else if (node && !d.nodes.some((n) => n.id === node)) flags.push(`decision node ${tree}:${node} is not declared`);
    }
    if (event.action === "transition" && event.decision) {
      const m = /^([^:]+):([^>]+)>(.+)$/.exec(event.decision);
      const sm = m && (t.stateMachines ?? []).find((x) => x.id === m[1]);
      const tr = sm?.transitions.find((x) => x.from === m![2] && x.to === m![3]);
      if (!m) flags.push(`transition "${event.decision}" is not machine:from>to`);
      else if (!sm) flags.push(`state machine ${m[1]} is not declared`);
      else if (!tr) flags.push(`transition ${m[2]} → ${m[3]} is not declared on ${m[1]}`);
      else if (tr.roles?.length) {
        const roles = new Set((t.principals ?? []).find((p) => p.id === event.actor)?.roles ?? []);
        if (!tr.roles.some((r) => r === event.actor || (r.startsWith("role:") && roles.has(r.slice(5))))) flags.push(`${event.actor} is not among those who may make ${m[2]} → ${m[3]} (${tr.roles.join(", ")})`);
      }
    }
    return { i, event, flags };
  });
}
