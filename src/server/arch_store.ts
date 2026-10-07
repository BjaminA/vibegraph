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
//   baseline    2026-10-05 — WHAT the map held when it was ratified: the
//               clusters, the deployment units and the plan revision. The
//               drift check (arch_drift.ts) measures against it.
//   ratified    WHEN a proposal was last ratified, and from which model.
//               It is the flag `proposalGate` reads: once a person has
//               decided the groups, nothing spawns another proposal unless
//               a person forces it (2026-09-28). Reject leaves it unset, so
//               a rejected draft can be asked for again.
//
// Validated at the boundary; a mangled entry is dropped, never half-loaded.

import { factLabel } from "../shared/arch_fact_label.ts";
import { stampHierarchy } from "../shared/arch_hierarchy.ts";
import { describeRule, resolveMembers, validateRule, type GroupRule } from "../shared/arch_rules.ts";
import { stampWriter } from "./writer_stamp.ts";
import * as fs from "fs";
import * as path from "path";
import type { ArchGroupRecord, ArchModelRecord } from "../shared/protocol.ts";

import { validScopes } from "./node_scope.ts";
import type { NodeScopeRecord } from "../shared/node_io.ts";

export const ARCH_STORE_FILE = path.join(".vibegraph", "architecture.json");
export const GROUP_KINDS = ["host", "region", "subnet", "trust", "network", "process", "account", "zone"] as const;

/** `match` (2026-10-05) — rules a box joins the group by (src/shared/
 *  arch_rules.ts), so code added later lands in its group with no model;
 *  `exclude` — boxes the rules must not bring in; `planned` — the plan item
 *  the group was drawn for ("processes:api"), which may have no code yet. */
export interface StatedGroup {
  id: string; kind: string; label: string; wraps: string[]; parent?: string; note?: string; match?: GroupRule[]; exclude?: string[]; planned?: string;
  /** 2026-10-06 (M12) — the label is REBUILT from the members' facts on every derive (shared/arch_fact_label.ts) */
  labelFrom?: "facts";
}
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
  /** 2026-10-05 — an UPDATE of ratified groups after drift: a group with an
   *  existing id EXTENDS it (members and rules added), never replaces it. */
  mode?: "update" | "replace";
}

/** What the map held when the groups were ratified (the drift baseline). */
export interface ArchBaseline { at: string; clusters: string[]; ungrouped?: string[]; deploy: string[]; planRevision?: number; planned?: string[] }

export interface ArchStore {
  version: "1";
  groups: StatedGroup[];
  names: Record<string, string>;
  primaryPath?: string[];
  notes?: string[];
  proposal?: ArchProposal;
  ratified?: { at: string; model: string };
  baseline?: ArchBaseline;
  /** 2026-10-06 — boxes scoped by a model (node_scope.ts): proposed, then a
   *  person's ratify. Independent of the groups' proposal and gate. */
  scopes?: Record<string, NodeScopeRecord>;
}

const ID = /^[A-Za-z][\w.:-]{0,79}$/;

function validGroup(g: unknown): g is StatedGroup {
  if (!g || typeof g !== "object") return false;
  const x = g as Record<string, unknown>;
  return typeof x.id === "string" && ID.test(x.id)
    && typeof x.kind === "string" && (GROUP_KINDS as readonly string[]).includes(x.kind)
    && typeof x.label === "string" && x.label.trim().length > 0 && x.label.length <= 80
    && Array.isArray(x.wraps) && x.wraps.every((w) => typeof w === "string")
    && (x.parent === undefined || typeof x.parent === "string")
    && (x.match === undefined || (Array.isArray(x.match) && x.match.every((r) => !!validateRule(r).rule)))
    && (x.exclude === undefined || (Array.isArray(x.exclude) && x.exclude.every((w) => typeof w === "string")))
    && (x.planned === undefined || typeof x.planned === "string")
    && (x.labelFrom === undefined || x.labelFrom === "facts");
}

function validBaseline(b: unknown): b is ArchBaseline {
  if (!b || typeof b !== "object") return false;
  const x = b as Record<string, unknown>;
  const strs = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");
  return typeof x.at === "string" && strs(x.clusters) && strs(x.deploy) && (x.ungrouped === undefined || strs(x.ungrouped))
    && (x.planRevision === undefined || typeof x.planRevision === "number") && (x.planned === undefined || strs(x.planned));
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
    const rt = raw.ratified as Record<string, unknown> | undefined;
    if (rt && typeof rt === "object" && typeof rt.at === "string" && typeof rt.model === "string") {
      store.ratified = { at: rt.at, model: rt.model };
    }
    if (validBaseline(raw.baseline)) store.baseline = raw.baseline;
    const scopes = validScopes(raw.scopes);
    if (Object.keys(scopes).length) store.scopes = scopes;
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
        ...(pr.mode === "update" || pr.mode === "replace" ? { mode: pr.mode as "update" | "replace" } : {}),
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
  stampWriter(root, "architecture.json");
}

/** An update proposal over the stated groups: a proposed group with an
 *  existing id EXTENDS it (its members, rules and exclusions are added; the
 *  stated label, kind and parent stand); a new id is a new group. */
export function mergeUpdate(stated: readonly StatedGroup[], proposed: readonly ProposedGroup[]): { groups: Array<StatedGroup & { evidence?: string[] }>; touched: Set<string> } {
  const groups: Array<StatedGroup & { evidence?: string[] }> = stated.map((g) => ({ ...g }));
  const touched = new Set<string>();
  for (const p of proposed) {
    const g = groups.find((x) => x.id === p.id);
    touched.add(p.id);
    if (!g) { groups.push({ ...p }); continue; }
    const union = <T>(a: T[] | undefined, b: T[] | undefined, key: (t: T) => string) => {
      const out = [...(a ?? [])];
      for (const t of b ?? []) if (!out.some((o) => key(o) === key(t))) out.push(t);
      return out.length ? out : undefined;
    };
    g.wraps = union(g.wraps, p.wraps, (w) => w) ?? [];
    const match = union(g.match, p.match, (r) => JSON.stringify(r));
    if (match) g.match = match;
    const exclude = union(g.exclude, p.exclude, (w) => w);
    if (exclude) g.exclude = exclude;
    g.evidence = p.evidence;
  }
  return { groups, touched };
}

/** Ratify: the proposal's items become stated (evidence kept as a note).
 *  A proposed group with an id the stated half already has replaces it —
 *  or, in an UPDATE proposal, extends it. `baseline` — what the map holds
 *  now, recorded so later drift is measured from this decision. */
export function ratifyProposal(store: ArchStore, opts: { baseline?: ArchBaseline } = {}): ArchStore {
  const p = store.proposal;
  if (!p) return store;
  const noteOf = (evidence: string[]) => `ratified from ${p.model} (${p.at})${evidence.length ? `; evidence: ${evidence.join(", ")}` : "; INFERRED — no evidence cited"}`;
  let groups: StatedGroup[];
  if (p.mode === "update") {
    const merged = mergeUpdate(store.groups, p.groups);
    groups = merged.groups.map(({ evidence, ...g }) => (merged.touched.has(g.id) ? { ...g, note: `${g.note ? `${g.note}; ` : ""}updated: ${noteOf(evidence ?? [])}` } : g));
  } else if (p.mode === "replace") {
    // M12: a regroup from facts REPLACES the groups it was formed against
    groups = p.groups.map(({ evidence, ...g }) => ({ ...g, note: noteOf(evidence) }));
  } else {
    groups = store.groups.filter((g) => !p.groups.some((x) => x.id === g.id));
    for (const g of p.groups) {
      const { evidence, ...rest } = g;
      groups.push({ ...rest, note: noteOf(evidence) });
    }
  }
  const names = { ...store.names };
  for (const [id, n] of Object.entries(p.names)) names[id] = n.label;
  const out: ArchStore = { ...store, groups, names };
  if (p.primaryPath?.entryPoints.length) out.primaryPath = p.primaryPath.entryPoints;
  if (p.narrative) out.notes = [...(store.notes ?? []), p.narrative];
  out.ratified = { at: new Date().toISOString(), model: p.model };
  if (opts.baseline) out.baseline = opts.baseline;
  delete out.proposal;
  return out;
}

export function rejectProposal(store: ArchStore): ArchStore {
  const out = { ...store };
  delete out.proposal;
  return out;
}

/** When the groups were settled by a person, or null. A store written
 *  before the flag existed still says so: ratification has always stamped
 *  each group it made stated with a `ratified from <model> (<at>)` note. */
export function ratifiedAt(store: ArchStore): { at: string; model: string } | null {
  if (store.ratified) return store.ratified;
  for (const g of store.groups) {
    const m = /^ratified from (.+?) \(([^)]*)\)/.exec(g.note ?? "");
    if (m) return { at: m[2], model: m[1] };
  }
  return null;
}

/**
 * May a NEW proposal be drafted (a model spawned)? The one gate every
 * caller asks — the GUI's button, the WS handler, MCP and the CLI.
 *   * a pending proposal → only a Modify (it revises that draft);
 *   * groups already ratified → refused, unless a person forces it.
 * A Modify never spawns past a ratified store either: there is nothing
 * pending to revise.
 */
export function proposalGate(
  store: ArchStore, opts: { modify?: boolean; force?: boolean; update?: { drifted: boolean } } = {},
): { allowed: true } | { allowed: false; reason: string } {
  if (opts.modify) {
    return store.proposal ? { allowed: true } : { allowed: false, reason: "there is no pending proposal to modify" };
  }
  if (store.proposal) return { allowed: false, reason: "a proposal is already pending: ratify, modify or reject it first" };
  // 2026-10-05 — an UPDATE extends ratified groups for what changed since;
  // it needs ratified groups to extend and a map that moved from them.
  if (opts.update) {
    if (!ratifiedAt(store)) return { allowed: false, reason: "nothing is ratified yet to update — propose the groups first" };
    return opts.update.drifted ? { allowed: true } : { allowed: false, reason: "nothing changed since the groups were ratified" };
  }
  const r = ratifiedAt(store);
  if (r && !opts.force) {
    return {
      allowed: false,
      reason: `the groups were already ratified (from ${r.model}${r.at ? `, ${r.at}` : ""}); edit .vibegraph/architecture.json, or re-propose with --force from the CLI`,
    };
  }
  return { allowed: true };
}

/** The model the view draws: derived facts + stated groups/names + the
 *  pending proposal, every element keeping its source. Groups that wrap no
 *  node the model has are dropped (the code moved; the statement did not). */
export function applyArchStore(model: ArchModelRecord, store: ArchStore): ArchModelRecord {
  const ids = new Set(model.nodes.map((n) => n.id));
  const groups: ArchGroupRecord[] = [];
  const groupIds = new Set<string>();
  // 2026-10-05 — the groups as they will be once decided: an UPDATE proposal
  // previews its extensions on the stated groups; members come from what a
  // group names plus what its rules claim (src/shared/arch_rules.ts).
  const update = store.proposal?.mode === "update" ? mergeUpdate(store.groups, store.proposal.groups) : null;
  // a REPLACE proposal previews the map as it will be: the stated groups give way
  const statedNow: Array<StatedGroup & { evidence?: string[] }> = update ? update.groups.filter((g) => !update.touched.has(g.id)) : store.proposal?.mode === "replace" ? [] : store.groups;
  const proposedNow: Array<StatedGroup & { evidence?: string[] }> = update ? update.groups.filter((g) => update.touched.has(g.id)) : (store.proposal?.groups ?? []);
  const effective = resolveMembers([...statedNow, ...proposedNow.filter((g) => !statedNow.some((s) => s.id === g.id))], model);
  // A statement about a box the code no longer yields is SAID, never dropped
  // in silence: the code moved (or the derivation was corrected) under a
  // person's decision, and they should see it (2026-09-25).
  const staleNotes: string[] = [];
  const add = (g: StatedGroup, source: "stated" | "proposed", evidence?: string[]) => {
    const named = g.wraps.filter((w) => ids.has(w) || [...store.groups, ...(store.proposal?.groups ?? [])].some((x) => x.id === w));
    const gone = g.wraps.filter((w) => !named.includes(w));
    const eff = effective.get(g.id);
    const wraps = eff ? eff.members : named;
    // A group anchored to a planned item, or carried by rules, that matches
    // nothing YET is waiting for its code — said, not drawn.
    if (!wraps.length && (g.planned || g.match?.length) && !gone.length && !groupIds.has(g.id)) {
      staleNotes.push(`The ${source} group "${g.label}" has no code yet${g.planned ? ` (planned: ${g.planned})` : ""}; it is drawn when ${g.match?.length ? `a box matches ${g.match.map(describeRule).join(" or ")}` : "its code exists"}.`);
      return;
    }
    if (gone.length && !groupIds.has(g.id)) {
      staleNotes.push(wraps.length
        ? `The ${source} group "${g.label}" names ${gone.join(", ")}, which the code no longer yields; it is drawn without ${gone.length === 1 ? "it" : "them"}.`
        : `The ${source} group "${g.label}" is not drawn: nothing it wraps (${gone.join(", ")}) exists in the code any more. Restate it, or remove it from .vibegraph/architecture.json.`);
    }
    if (!wraps.length || groupIds.has(g.id)) return;
    groupIds.add(g.id);
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    const label = g.labelFrom === "facts" ? factLabel(wraps.map((w) => byId.get(w)).filter((n): n is ArchModelRecord["nodes"][number] => !!n)) : g.label;
    groups.push({
      id: g.id, kind: g.kind, label, wraps, ...(g.parent ? { parent: g.parent } : {}), source, ...(evidence ? { evidence } : {}),
      ...(eff?.byRule.length ? { byRule: eff.byRule } : {}), ...(g.match?.length ? { rules: g.match.map(describeRule) } : {}),
    });
  };
  for (const g of statedNow) add(g, "stated");
  for (const g of proposedNow) add(g, "proposed", g.evidence);
  for (const g of groups) if (g.parent && !groupIds.has(g.parent)) delete g.parent;
  // A group may name a group that is not drawn (a planned one still waiting
  // for its code): the drawn group keeps what is drawn.
  for (const g of groups) g.wraps = g.wraps.filter((w) => ids.has(w) || groupIds.has(w));

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
    ...(store.proposal ? { proposal: { at: store.proposal.at, model: store.proposal.model, narrative: store.proposal.narrative ?? null, refused: store.proposal.refused, ...(store.proposal.mode ? { mode: store.proposal.mode } : {}) } } : {}),
    ...(ratifiedAt(store) ? { ratified: ratifiedAt(store)! } : {}),
  });
}
