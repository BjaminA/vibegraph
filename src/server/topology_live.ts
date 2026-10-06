// The live side of the topology (2026-10-06, direction review M8): what
// `topology live` saved — a whole topology the platform printed, or an
// INVENTORY of named resources (shared/live_inventory.ts) — read back for the
// CLI, the map and the export. Never written by anything but `topology live`.

import * as fs from "node:fs";
import * as path from "node:path";
import { TOPOLOGY_DIR } from "./topology_store.ts";
import { validateTopology } from "./topology_store.ts";
import { countLive, readInventory, type LiveCount, type LiveInventory } from "../shared/live_inventory.ts";
import type { Topology } from "../shared/topology_types.ts";

export interface LiveRecord { at: string; command: string; topology?: Topology; inventory?: LiveInventory }

export function liveFile(root: string): string { return path.join(root, TOPOLOGY_DIR, "live.json"); }

export function loadLive(root: string): LiveRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(liveFile(root), "utf-8"));
    if (raw?.topology && !validateTopology(raw.topology)) return { at: String(raw.at), command: String(raw.command ?? ""), topology: raw.topology };
    if (raw?.inventory && Array.isArray(raw.inventory.resources)) return { at: String(raw.at), command: String(raw.command ?? ""), inventory: { resources: raw.inventory.resources, identities: raw.inventory.identities ?? [] } };
  } catch { /* nothing saved */ }
  return null;
}

/** What a live command printed: a topology, an inventory, or why it is neither. */
export function parseLive(json: unknown): { topology?: Topology; inventory?: LiveInventory; error?: string } {
  if (!validateTopology(json)) return { topology: json as Topology };
  const inv = readInventory(json);
  return inv ? { inventory: inv } : { error: "it is neither a topology nor an inventory (a list of objects with a name, alias or id)" };
}

export function saveLive(root: string, command: string, live: { topology?: Topology; inventory?: LiveInventory }, now = new Date()): void {
  fs.mkdirSync(path.join(root, TOPOLOGY_DIR), { recursive: true });
  fs.writeFileSync(liveFile(root), JSON.stringify({ at: now.toISOString(), command, ...live }, null, 2) + "\n");
}

/** Declared vs provisioned for one store's zones (all stores when `store` is omitted). */
export function liveCount(t: Topology, inv: LiveInventory, store?: string): LiveCount {
  return countLive((t.zones ?? []).filter((z) => !store || z.store === store), inv);
}

export function liveLine(c: LiveCount, identities: number): string {
  return `${c.declared} declared · ${c.provisioned.length} provisioned${identities ? ` · ${identities} live identit${identities === 1 ? "y" : "ies"}` : ""}`;
}
