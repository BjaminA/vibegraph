// LIVE NEXT TO DECLARED (2026-10-06, direction review M8). A declared
// topology says which zones exist; only the running platform says which were
// PROVISIONED. A project registers a read-only command that prints what is
// live (`topology live --command "…"`); its output is either a topology or an
// INVENTORY — any JSON holding a list of named resources (`name`, `alias`,
// `aliases`, `id`) and, optionally, the identities it was read as. Each
// declared zone is matched to a live resource BY NAME (the zone's id, a
// `<prefix>-<zone>` name, or its label's `<placeholder>` spelled out);
// nothing else is inferred. Webview-safe: no I/O.

import type { TopoZone } from "./topology_types.ts";

/** `resources`: one row per live resource, every name it goes by */
export interface LiveInventory { resources: string[][]; identities: string[] }
export interface LiveCount { declared: number; provisioned: string[]; missing: string[]; undeclared: string[] }

const NAME_KEYS = ["name", "alias", "id"];

/** The resources and identities an inventory JSON reports, or null when it holds no list of named things. */
export function readInventory(json: unknown): LiveInventory | null {
  const identities = new Set<string>();
  let best: string[][] | null = null;
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      const named = v.filter((x) => x && typeof x === "object" && (NAME_KEYS.some((k) => typeof (x as any)[k] === "string") || Array.isArray((x as any).aliases)));
      if (named.length && named.length >= v.length / 2 && (!best || named.length > best.length)) {
        best = named.map((x: any) => [...NAME_KEYS.map((k) => x[k]), ...(Array.isArray(x.aliases) ? x.aliases : [])].filter((s): s is string => typeof s === "string" && s.length > 0 && s.length < 200));
      }
      for (const x of v.slice(0, 500)) walk(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/^(identity|identity_did|principal)$/i.test(k) && typeof x === "string") identities.add(x);
      if (/^(identities|principals)$/i.test(k) && Array.isArray(x)) for (const i of x) if (typeof i === "string") identities.add(i);
      walk(x, depth + 1);
    }
  };
  walk(json, 0);
  const rows = best as string[][] | null; // assigned inside walk(): TS cannot see it
  if (!rows) return null;
  return { resources: rows.map((r) => [...new Set(r.map((s) => s.replace(/^@/, "")))]).filter((r) => r.length), identities: [...identities] };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A zone id or label as a name test: `{Role}` / `<alias>` placeholders match one name piece. */
const nameTest = (pattern: string) => new RegExp(`^${esc(pattern).replace(/\\\{[^}]*\\\}|<[^>]*>/g, "[A-Za-z0-9_.-]+?")}$`, "i");

/** Which declared zones a live inventory shows provisioned. */
export function countLive(zones: TopoZone[], inv: LiveInventory): LiveCount {
  const matched = new Set<string[]>();
  const provisioned: string[] = [];
  const missing: string[] = [];
  for (const z of zones) {
    const label = z.label?.replace(/^\S+\s+(?=\S*<)/, ""); // "bucket <alias>-core" → "<alias>-core"
    const tests = [nameTest(z.id), new RegExp(`[-_.]${esc(z.id).replace(/\\\{[^}]*\\\}/g, "[A-Za-z0-9_]+?")}$`, "i"), ...(label && /<[^>]+>|\{[^}]+\}/.test(label) ? [nameTest(label)] : [])];
    const hits = inv.resources.filter((row) => row.some((r) => tests.some((t) => t.test(r))));
    if (hits.length) { provisioned.push(z.id); for (const h of hits) matched.add(h); } else missing.push(z.id);
  }
  return { declared: zones.length, provisioned, missing, undeclared: inv.resources.filter((row) => !matched.has(row)).map((row) => row.find((r) => !/^[0-9a-f-]{36}$/i.test(r)) ?? row[0]) };
}

/** A writer the catalogue SPEAKS rather than names (`any-writer`, `owner-of-entry`): a rule, not a principal. */
export const isCatalogueWord = (w: string) => /^(any|anyone|all|everyone|owner|self|creator)([-_]|$)/i.test(w);
