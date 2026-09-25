// M-ARCH.4 (PLAN-M-ARCH.md) — `.vibegraph/architecture.json`: what only the
// operator knows about the architecture, and the model's pending proposal.
//
//   groups      STATED deployment/trust boundaries (host, region, subnet,
//               trust, network, process, account), each wrapping derived
//               node ids, nestable by `parent`.
//   names       STATED display names for derived nodes (a cluster called
//               "Volt host" rather than "Scripts · ops-scripts").
//   primaryPath STATED: the entry points a reader should walk first.
//   proposal    PENDING, from a model (src/server/arch_propose.ts): the same
//               shapes, each item carrying its `evidence` — citations that
//               were checked against what the model was shown; an item with
//               none is INFERRED and drawn as a ghost. Ratify moves it into
//               the stated half; reject drops it. A model never writes the
//               stated half directly.
//
// Validated at the boundary; a mangled entry is dropped, never half-loaded.

import { stampHierarchy } from "../shared/arch_hierarchy.ts";
import * as fs from "fs";
import * as path from "path";
import type { ArchGroupRecord, ArchModelRecord } from "../shared/protocol.ts";

export const ARCH_STORE_FILE = path.join(".vibegraph", "architecture.json");
export const GROUP_KINDS = ["host", "region", "subnet", "trust", "network", "process", "account", "zone"] as const;

export interface StatedGroup { id: string; kind: string; label: string; wraps: string[]; parent?: string; note?: string }
export interface ProposedGroup extends StatedGroup { evidence: string[] }
export interface ProposedName { label: string; evidence: string[] }

export interface ArchProposal {
  at: string;
  model: string;
  groups: ProposedGroup[];
  names: Record<string, ProposedName>;
  primaryPath?: { entryPoints: string[]; evidence: string[] };
  narrative?: string;
  /** what the validator refused from the model's reply, with why. */
  refused: Array<{ item: string; reason: string }>;
}

export interface ArchStore {
  version: "1";
  groups: StatedGroup[];
  names: Record<string, string>;
  primaryPath?: string[];
  notes?: string[];
  proposal?: ArchProposal;
}

const ID = /^[A-Za-z][\w.:-]{0,79}$/;

function validGroup(g: unknown): g is StatedGroup {
  if (!g || typeof g !== "object") return false;
  const x = g as Record<string, unknown>;
  return typeof x.id === "string" && ID.test(x.id)
    && typeof x.kind === "string" && (GROUP_KINDS as readonly string[]).includes(x.kind)
    && typeof x.label === "string" && x.label.trim().length > 0 && x.label.length <= 80
    && Array.isArray(x.wraps) && x.wraps.every((w) => typeof w === "string")
    && (x.parent === undefined || typeof x.parent === "string");
}

export function emptyStore(): ArchStore {
  return { version: "1", groups: [], names: {} };
}

export function loadArchStore(root: string | null): ArchStore {
  if (!root) return emptyStore();
  const p = path.join(root, ARCH_STORE_FILE);
  if (!fs.existsSync(p)) return emptyStore();
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    if (raw.version !== "1") return emptyStore();
    const groups = (Array.isArray(raw.groups) ? raw.groups : []).filter(validGroup) as StatedGroup[];
    const names: Record<string, string> = {};
    for (const [k, v] of Object.entries((raw.names ?? {}) as Record<string, unknown>)) if (typeof v === "string" && v.trim()) names[k] = v.slice(0, 80);
    const store: ArchStore = { version: "1", groups, names };
    if (Array.isArray(raw.primaryPath)) store.primaryPath = raw.primaryPath.filter((x): x is string => typeof x === "string");
    if (Array.isArray(raw.notes)) store.notes = raw.notes.filter((x): x is string => typeof x === "string");
    const pr = raw.proposal as Record<string, unknown> | undefined;
    if (pr && typeof pr === "object" && Array.isArray(pr.groups)) {
      store.proposal = {
        at: typeof pr.at === "string" ? pr.at : "",
        model: typeof pr.model === "string" ? pr.model : "unknown",
        groups: (pr.groups as unknown[]).filter(validGroup).map((g) => ({ ...(g as StatedGroup), evidence: Array.isArray((g as unknown as Record<string, unknown>).evidence) ? ((g as unknown as Record<string, unknown>).evidence as unknown[]).filter((e): e is string => typeof e === "string") : [] })),
        names: (pr.names && typeof pr.names === "object" ? pr.names : {}) as Record<string, ProposedName>,
        ...(pr.primaryPath && typeof pr.primaryPath === "object" ? { primaryPath: pr.primaryPath as ArchProposal["primaryPath"] } : {}),
        ...(typeof pr.narrative === "string" ? { narrative: pr.narrative } : {}),
        refused: Array.isArray(pr.refused) ? (pr.refused as ArchProposal["refused"]) : [],
      };
    }
    return store;
  } catch {
    return emptyStore();
  }
}

export function saveArchStore(root: string, store: ArchStore): void {
  const p = path.join(root, ARCH_STORE_FILE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, p);
}

/** Ratify: the proposal's items become stated (evidence kept as a note).
 *  A proposed group with an id the stated half already has replaces it. */
export function ratifyProposal(store: ArchStore): ArchStore {
  const p = store.proposal;
  if (!p) return store;
  const groups = store.groups.filter((g) => !p.groups.some((x) => x.id === g.id));
  for (const g of p.groups) {
    const { evidence, ...rest } = g;
    groups.push({ ...rest, note: `ratified from ${p.model} (${p.at})${evidence.length ? `; evidence: ${evidence.join(", ")}` : "; INFERRED — no evidence cited"}` });
  }
  const names = { ...store.names };
  for (const [id, n] of Object.entries(p.names)) names[id] = n.label;
  const out: ArchStore = { ...store, groups, names };
  if (p.primaryPath?.entryPoints.length) out.primaryPath = p.primaryPath.entryPoints;
  if (p.narrative) out.notes = [...(store.notes ?? []), p.narrative];
  delete out.proposal;
  return out;
}

export function rejectProposal(store: ArchStore): ArchStore {
  const out = { ...store };
  delete out.proposal;
  return out;
}

/** The model the view draws: derived facts + stated groups/names + the
 *  pending proposal, every element keeping its source. Groups that wrap no
 *  node the model has are dropped (the code moved; the statement did not). */
export function applyArchStore(model: ArchModelRecord, store: ArchStore): ArchModelRecord {
  const ids = new Set(model.nodes.map((n) => n.id));
  const groups: ArchGroupRecord[] = [];
  const groupIds = new Set<string>();
  // A statement about a box the code no longer yields is SAID, never dropped
  // in silence: the code moved (or the derivation was corrected) under a
  // person's decision, and they should see it (2026-09-25).
  const staleNotes: string[] = [];
  const add = (g: StatedGroup, source: "stated" | "proposed", evidence?: string[]) => {
    const wraps = g.wraps.filter((w) => ids.has(w) || [...store.groups, ...(store.proposal?.groups ?? [])].some((x) => x.id === w));
    const gone = g.wraps.filter((w) => !wraps.includes(w));
    if (gone.length && !groupIds.has(g.id)) {
      staleNotes.push(wraps.length
        ? `The ${source} group "${g.label}" names ${gone.join(", ")}, which the code no longer yields; it is drawn without ${gone.length === 1 ? "it" : "them"}.`
        : `The ${source} group "${g.label}" is not drawn: nothing it wraps (${gone.join(", ")}) exists in the code any more. Restate it, or remove it from .vibegraph/architecture.json.`);
    }
    if (!wraps.length || groupIds.has(g.id)) return;
    groupIds.add(g.id);
    groups.push({ id: g.id, kind: g.kind, label: g.label, wraps, ...(g.parent ? { parent: g.parent } : {}), source, ...(evidence ? { evidence } : {}) });
  };
  for (const g of store.groups) add(g, "stated");
  for (const g of store.proposal?.groups ?? []) add(g, "proposed", g.evidence);
  for (const g of groups) if (g.parent && !groupIds.has(g.parent)) delete g.parent;

  for (const [id, label] of Object.entries(store.names)) {
    if (!ids.has(id)) staleNotes.push(`The stated name "${label}" is for ${id}, which the code no longer yields.`);
  }
  const nodes = model.nodes.map((n) => {
    const stated = store.names[n.id];
    const proposed = store.proposal?.names[n.id];
    if (stated) return { ...n, label: stated, labelSource: "stated" as const, derivedLabel: n.label };
    if (proposed) return { ...n, label: proposed.label, labelSource: "proposed" as const, derivedLabel: n.label, labelEvidence: proposed.evidence };
    return n;
  });
  const primary = store.primaryPath?.length
    ? { entryPoints: store.primaryPath, source: "stated" as const }
    : store.proposal?.primaryPath?.entryPoints.length
      ? { entryPoints: store.proposal.primaryPath.entryPoints, source: "proposed" as const, evidence: store.proposal.primaryPath.evidence }
      : null;
  // The hierarchy is stamped AFTER the stated groups land: they are what
  // it is resolved from (src/shared/arch_hierarchy.ts).
  return stampHierarchy({
    ...model,
    nodes,
    groups,
    notes: [...model.notes, ...staleNotes],
    ...(primary ? { primaryPath: primary } : {}),
    ...(store.proposal ? { proposal: { at: store.proposal.at, model: store.proposal.model, narrative: store.proposal.narrative ?? null, refused: store.proposal.refused } } : {}),
  });
}
