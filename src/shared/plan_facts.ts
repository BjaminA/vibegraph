// A plan item as STRUCTURE (2026-10-05, GUI brief M4): the chip it is, up to
// three labelled bullets of chips joined by short verbs, and the numbers
// the folded verdict summarises. `plan check` attaches this to every finding
// (`facts`, `numbers`) beside the prose `detail`, so the panel renders
// structure and the CLI's JSON carries it too.
//
// Every chip's kind comes from where the fact sits in the plan — a process's
// `at` is a path, its `runsAs` an identity, a zone named in a store's
// `zones` is a zone — never from what the words look like.

import type { Plan, PlanFinding, PlanSection } from "./plan_types.ts";
import { kindOfPath, type ChipRef, type ItemFact } from "./kinds.ts";

const pathChip = (p: string): ChipRef => ({ kind: kindOfPath(p), id: p });
const zoneChip = (store: string, zone: string): ChipRef => ({ kind: "zone", id: `${store}/${zone}` });

/** The zones a principal may write / read, as "store/zone" chips. */
function zonesOf(plan: Plan, who: string | undefined, access: "writers" | "readers"): ChipRef[] {
  if (!who) return [];
  const out: ChipRef[] = [];
  for (const st of plan.stores ?? []) for (const z of st.zones ?? []) if ((z[access] ?? []).includes(who)) out.push(zoneChip(st.id, z.id));
  return out;
}

/** The kind of a boundary's or flow's end: a process, a store, or a tool. */
function endChip(plan: Plan, id: string): ChipRef {
  if (plan.processes.some((p) => p.id === id)) return { kind: "process", id };
  if ((plan.stores ?? []).some((s) => s.id === id)) return { kind: "store", id };
  if ((plan.modules ?? []).some((m) => m.id === id)) return { kind: "module", id };
  return { kind: "module", id };
}

const join = (verb: string, chips: ChipRef[]): Array<ChipRef | string> => (chips.length ? [verb, ...chips] : []);

export interface PlanItemView { chip: ChipRef; name?: string; facts: ItemFact[]; numbers: Record<string, number> }

export function planItemFacts(plan: Plan, section: PlanSection, it: any, finding?: PlanFinding): PlanItemView {
  const numbers: Record<string, number> = {};
  const files = /(\d+) file\(s\)/.exec(finding?.detail ?? "");
  if (files) numbers.files = Number(files[1]);
  if (finding?.entryPoints?.length) numbers["entry points"] = finding.entryPoints.length;
  if (finding?.missing?.length) numbers.missing = finding.missing.length;
  switch (section) {
    case "processes": {
      const starts = (it.entryPoints ?? []).filter((e: string) => !e.includes(":")).map(pathChip);
      return {
        chip: { kind: "process", id: it.id, ...(finding?.entryPoints?.length ? { at: finding.entryPoints[0] } : {}) } ,
        name: it.label && it.label !== it.id ? it.label : undefined,
        numbers,
        facts: [
          { label: "does", text: it.serves ?? undefined },
          { label: "where", parts: [...(it.at ? [pathChip(it.at)] : []), ...join("starts", starts), ...join("uses", (it.uses ?? []).map((u: string) => ({ kind: "module", id: u } as ChipRef)))] },
          { label: "runs as", parts: [...(it.runsAs ? [{ kind: "identity", id: it.runsAs } as ChipRef] : []), ...join("writes", zonesOf(plan, it.runsAs, "writers")), ...join("reads", zonesOf(plan, it.runsAs, "readers"))] },
        ],
      };
    }
    case "modules":
      return { chip: { kind: "module", id: it.id }, name: it.label, numbers, facts: [
        { label: "does", text: it.serves ?? it.kind },
        { label: "where", parts: it.at ? [pathChip(it.at)] : [] },
      ] };
    case "stores":
      return { chip: { kind: "store", id: it.id }, name: it.label, numbers, facts: [
        { label: "does", text: it.serves ?? it.kind },
        { label: "holds", parts: (it.zones ?? []).map((z: any) => zoneChip(it.id, z.id)) },
        { label: "uses", parts: (it.reachedThrough ?? []).map((r: string) => (r.endsWith("/") ? pathChip(r) : { kind: "module", id: r } as ChipRef)) },
      ] };
    case "principals":
      return { chip: { kind: "identity", id: it.id }, name: it.label, numbers, facts: [
        { label: "does", text: it.kind },
        { label: "runs as", parts: [...join("writes", zonesOf(plan, it.id, "writers")), ...join("reads", zonesOf(plan, it.id, "readers"))] },
      ] };
    case "stack":
      return { chip: { kind: "module", id: it.tool }, numbers, facts: [
        { label: "does", text: [it.role, it.why].filter(Boolean).join(" · ") },
        { label: "uses", parts: (it.via ?? []).map((v: string) => ({ kind: "module", id: v } as ChipRef)) },
      ] };
    case "boundaries":
      return { chip: { kind: "external", id: it.id }, numbers, facts: [
        { label: "where", parts: [endChip(plan, it.from), "→", ...(it.zone ? [zoneChip(it.to, it.zone)] : [endChip(plan, it.to)])] },
        { label: "speaks", text: it.protocol },
        { label: "carries", parts: (it.carries ?? []).map((k: string) => ({ kind: "json", id: k } as ChipRef)) },
      ] };
    case "threads":
      return { chip: { kind: "process", id: it.id, ...(finding?.entryPointId ? { at: finding.entryPointId } : {}) }, numbers, facts: [
        { label: "does", text: it.serves },
        { label: "where", parts: [...(it.entryPoint ? [pathChip(it.entryPoint.split(":")[0])] : []), ...join("in", it.process || finding?.process ? [{ kind: "process", id: it.process ?? finding!.process! } as ChipRef] : [])] },
        // `b1:insert` names the boundary the step crosses (plan_types), not a function.
        { label: "steps", parts: it.primary.flatMap((s: string, i: number) => [...(i ? ["→"] : []), { kind: /^[^:\s]+:/.test(s) ? "external" : "function", id: s } as ChipRef]) },
      ] };
    case "flows":
      return { chip: { kind: "external", id: it.id }, numbers, facts: [
        { label: "does", text: it.serves ?? undefined },
        { label: "steps", parts: (it.steps ?? []).flatMap((s: any, i: number) => [...(i ? ["→"] : []), { kind: "process", id: s.process } as ChipRef, s.op, { kind: "zone", id: s.zone } as ChipRef]) },
      ] };
    case "policies":
      return { chip: { kind: "rule", id: it.id }, numbers, facts: [
        { label: "rule", text: it.text },
        { label: "why", text: it.why },
        { label: "scope", parts: it.files?.length ? it.files.map(pathChip) : it.about ? [endChip(plan, it.about)] : ["the whole project"] },
      ] };
    case "open":
      return { chip: { kind: "question", id: it.id }, numbers, facts: [{ label: "asks", text: it.text }] };
  }
  return { chip: { kind: "path", id: String(it.id) }, numbers, facts: [] };
}
