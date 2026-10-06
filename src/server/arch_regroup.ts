// RE-FORMING GROUPS FROM FACTS (2026-10-06, direction review M12). Ratified
// groups were a model's sentences: when the code grew three runtime processes
// no group held, the labels still named "3 of 17 identities" and a port the
// members did not use. A regroup reads only facts — the identity the code runs
// each process as (arch_identity.ts), the port it listens on, its package —
// and proposes groups whose LABELS are rebuilt from their members on every
// derive (`labelFrom: "facts"`, shared/arch_fact_label.ts), so a label can no
// longer outlive what it describes. Zero tokens.
//
//   identity   processes the code runs as the same identity (and port) form
//              a group: "runs as $GATEWAY_USER · port 8080"
//   package    the rest, by package root: "package tools"
//
// It is a PROPOSAL in replace mode: ratifying it replaces the groups it was
// formed against (arch_store.ts). Gated like any proposal — a pending one is
// never replaced — and, over ratified groups, allowed only when they drifted
// from the code (arch_drift.ts) or a person forces it. A model may NAME the
// groups afterwards (opt-in, `architecture --propose`), never re-form them.

import type { ArchModelRecord, ArchNodeRecord } from "../shared/protocol.ts";
import { factLabel, identityOf, rootOf } from "../shared/arch_fact_label.ts";
import { ratifiedAt, type ArchStore, type ProposedGroup } from "./arch_store.ts";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";

export function regroupFromFacts(derived: ArchModelRecord, store: ArchStore, opts: { force?: boolean; drifted?: boolean; now?: Date } = {}):
  { store?: ArchStore; groups: ProposedGroup[]; error?: string; lines: string[] } {
  if (store.proposal) return { groups: [], error: "a proposal is already pending: ratify, modify or reject it first", lines: [] };
  const r = ratifiedAt(store);
  if (r && !opts.force && !opts.drifted) return { groups: [], error: `the ratified groups (from ${r.model}) still match the code — nothing to regroup (a person may --force it)`, lines: [] };
  const clusters = derived.nodes.filter((n) => n.kind === "cluster");
  if (!clusters.length) return { groups: [], error: "the map has no processes to group", lines: [] };
  const buckets = new Map<string, { kind: string; members: ArchNodeRecord[] }>();
  for (const c of clusters) {
    const who = identityOf(c);
    const key = who ? `id:${who}|${c.runtime?.port ?? ""}` : `pkg:${rootOf(c)}`;
    const b = buckets.get(key) ?? { kind: who ? "account" : "process", members: [] };
    b.members.push(c);
    buckets.set(key, b);
  }
  const groups: ProposedGroup[] = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, b]) => ({
    id: `facts-${slug(key)}`, kind: b.kind, label: factLabel(b.members), labelFrom: "facts" as const,
    wraps: b.members.map((m) => m.id).sort(),
    evidence: [...new Set(b.members.flatMap((m) => [
      ...(m.identity?.slice(0, 1).map((i) => i.evidence) ?? []),
      ...(m.runtime?.port ? [`${m.label} listens on ${m.runtime.port}`] : []),
      ...(identityOf(m) ? [] : [`${m.label} is in package ${rootOf(m)} and the code shows no identity for it`]),
    ]))].slice(0, 8),
  }));
  const replaced = store.groups.length;
  const next: ArchStore = {
    ...store,
    proposal: {
      at: (opts.now ?? new Date()).toISOString(), model: "facts (zero tokens)", groups, names: {}, refused: [], mode: "replace",
      narrative: `Re-formed from facts, no model: ${groups.length} group(s) by the identity the code runs each process as, then its package; labels rebuilt from the members on every derive.${replaced ? ` Ratifying replaces the ${replaced} group(s) stated before.` : ""}`,
    },
  };
  const lines = [
    `regrouped from facts, PENDING in .vibegraph/architecture.json — no model, no tokens${replaced ? ` (ratifying replaces ${replaced} stated group(s))` : ""}:`,
    ...groups.map((g) => `  ${g.label}  [${g.wraps.length}: ${g.wraps.map((w) => clusters.find((c) => c.id === w)?.label ?? w).slice(0, 6).join(", ")}${g.wraps.length > 6 ? ", …" : ""}]`),
    "decide it: --ratify makes it stated (the inbox too), --reject drops it",
  ];
  return { store: next, groups, lines };
}
