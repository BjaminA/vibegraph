// A RATIFIED LABEL THE FACTS NO LONGER SUPPORT (2026-10-07, field review).
// Drift (arch_drift.ts) watches membership: who is in which group. A label is
// ratified TEXT, and it can go stale while the members stay put — "Client
// identities (a/b/c)" named 3 of the 17 identities the project has; "Node
// processes (PORT 3000)" wrapped processes that use other ports or none. Two
// things a label states that the facts can check:
//
//   a list of names   2+ of them are principals the declared topology lists,
//                     and it declares more → "names 3 of 17 principals"
//   a port            `PORT 3000` / `port 3000`, and no member box shows that
//                     port (its listen port, or a literal in its identity facts)
//
// Anything else a label says is a person's or a model's wording, not checked.
// Zero tokens.

import type { ArchModelRecord } from "../shared/protocol.ts";
import type { Topology } from "../shared/topology_types.ts";
import { loadArchStore, type ArchStore } from "./arch_store.ts";
import { loadTopology } from "./topology_store.ts";
import { loadLive } from "./topology_live.ts";

export interface StaleLabel { group: string; label: string; why: string }

/** What a label's names are checked against: the DECLARED topology's
 *  principals, and the identities `topology live` last saw (live.json), when
 *  either exists. Never throws. */
export interface LabelFacts { topology: Topology | null; identities: string[] }
export function declaredTopology(root: string): LabelFacts {
  let topology: Topology | null = null;
  try { const m = loadTopology(root); topology = m.status.length ? m.topology : null; } catch { topology = null; }
  let identities: string[] = [];
  try { identities = loadLive(root)?.inventory?.identities ?? []; } catch { identities = []; }
  return { topology, identities };
}

/** Group id → why its label is stale, for a page that prints the labels
 *  (architecture.md). Never throws: no store, or no facts, is an empty map. */
export function staleLabelMap(root: string, applied: ArchModelRecord): Map<string, string> {
  try { return new Map(staleLabels(applied, loadArchStore(root), declaredTopology(root)).map((s) => [s.group, s.why])); } catch { return new Map(); }
}

const PORT = /\bport\s*[:=]?\s*(\d{2,5})\b/i;

/** Every box a group holds, through nested groups. */
function membersOf(applied: ArchModelRecord, id: string, seen = new Set<string>()): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const g = applied.groups.find((x) => x.id === id);
  if (!g) return [id];
  return g.wraps.flatMap((w) => (applied.groups.some((x) => x.id === w) ? membersOf(applied, w, seen) : [w]));
}

export function staleLabels(applied: ArchModelRecord, store: ArchStore, facts: LabelFacts | null = null): StaleLabel[] {
  const out: StaleLabel[] = [];
  // the names a label could be listing: declared principals and live identities
  const principals = [...new Set([...(facts?.topology?.principals ?? []).map((p) => p.id), ...(facts?.identities ?? [])])];
  const pset = new Set(principals.map((p) => p.toLowerCase()));
  const what = facts?.identities?.length ? "principals and live identities" : "principals the declared topology lists";
  const byId = new Map(applied.nodes.map((n) => [n.id, n]));
  for (const g of store.groups) {
    const label = g.label ?? "";
    // names: the words of a parenthesised list, split on / , ;
    const listed = [...label.matchAll(/\(([^)]*)\)/g)].flatMap((m) => m[1].split(/[/,;]| and /)).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const named = listed.filter((s) => pset.has(s));
    if (named.length >= 2 && principals.length > named.length) {
      out.push({ group: g.id, label, why: `names ${named.length} of the ${principals.length} ${what} (${named.join(", ")})` });
      continue;
    }
    const pm = PORT.exec(label);
    if (pm) {
      const members = membersOf(applied, g.id).map((id) => byId.get(id)).filter((n) => n && n.kind === "cluster");
      const shows = (n: (typeof members)[number]) => {
        const port = (n as { runtime?: { port?: number | string } }).runtime?.port;
        return String(port ?? "") === pm[1] || (n!.identity ?? []).some((i) => String(i.evidence ?? "").includes(pm[1]));
      };
      const without = members.filter((n) => !shows(n));
      if (members.length && without.length) {
        out.push({ group: g.id, label, why: `names port ${pm[1]}, and ${without.length} of its ${members.length} process box(es) show no such port (${without.slice(0, 3).map((n) => n!.label).join(", ")}${without.length > 3 ? ", …" : ""})` });
      }
    }
  }
  return out;
}
