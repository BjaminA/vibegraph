// COORDINATION THROUGH A STORE (2026-10-01). Processes that talk only through
// shared documents — A writes a request, B watches it and writes a verdict A
// watches — have no edge between them in the code: no call, no HTTP hop. The
// flow that defines the system was invisible. Two halves:
//
//   derived   an INDIRECT HOP is a write to a family (or zone) in one process
//             and a watch/read of the same family in another, both found as
//             access sites of the same store
//   planned   a `flows` item: ordered steps "process writes|reads|watches
//             store/zone (family)"; `plan check` says which steps the code has
//
// Only literal zones and families join: a computed one never makes a hop.

import type { IndirectHop, Plan, PlanFinding, PlanFlowStep } from "../shared/plan_types.ts";
import { familyMatches, siteZone, type AccessSite } from "./store_access.ts";

export const FLOW_LIMITS = [
  "an indirect hop joins a write and a watch/read of the SAME literal family (or zone) of one store in two different processes; it says the documents meet, not that one triggered the other, and the order of a flow's steps is not checked",
];

const at = (s: AccessSite) => `${s.file}:${s.line} ${s.fn}`;
const VERB = { write: "writes", read: "reads", watch: "watches" } as const;
export const stepText = (st: PlanFlowStep) => `${st.process} ${VERB[st.op]} ${st.zone}${st.family ? ` (${st.family})` : ""}`;

export function indirectHops(plan: Plan, sitesByStore: Map<string, AccessSite[]>, procOf: Map<string, string>): IndirectHop[] {
  const hops = new Map<string, IndirectHop>();
  for (const st of (plan.stores ?? []).filter((x) => x.status !== "dropped")) {
    const sites = (sitesByStore.get(st.id) ?? []).filter((s) => procOf.has(s.file));
    const writes = sites.filter((s) => s.op === "write");
    const reads = sites.filter((s) => s.op !== "write");
    for (const w of writes) for (const r of reads) {
      const a = procOf.get(w.file)!, b = procOf.get(r.file)!;
      if (a === b) continue;
      const wz = siteZone(st, w), rz = siteZone(st, r);
      const sameFamily = !!w.family && w.family === r.family;
      const sameZone = !!wz && wz === rz;
      if (!sameFamily && !sameZone) continue;
      const key = `${a}\u0000${b}\u0000${st.id}\u0000${wz ?? ""}\u0000${w.family ?? ""}`;
      if (!hops.has(key)) hops.set(key, { from: a, to: b, store: st.id, ...(wz ? { zone: wz } : {}), ...(sameFamily ? { family: w.family } : {}), write: at(w), read: at(r) });
    }
  }
  return [...hops.values()];
}

/** Does the code have this step: an access in the step's process, with a
 *  matching op (a planned `read` is met by a read or a watch), on its zone
 *  and family? */
function stepSite(plan: Plan, step: PlanFlowStep, sitesByStore: Map<string, AccessSite[]>, procOf: Map<string, string>): AccessSite | undefined {
  const [sid, zid] = step.zone.split("/");
  const store = (plan.stores ?? []).find((x) => x.id === sid);
  if (!store) return undefined;
  return (sitesByStore.get(sid) ?? []).find((s) =>
    procOf.get(s.file) === step.process
    && (step.op === s.op || (step.op === "read" && s.op === "watch"))
    && siteZone(store, s) === zid
    && (!step.family || (s.family !== undefined && familyMatches(step.family, s.family))));
}

export function flowFindings(plan: Plan, sitesByStore: Map<string, AccessSite[]>, procOf: Map<string, string>): PlanFinding[] {
  const out: PlanFinding[] = [];
  for (const f of (plan.flows ?? []).filter((x) => x.status !== "dropped")) {
    const steps = f.steps.map((st) => {
      const s = stepSite(plan, st, sitesByStore, procOf);
      return { step: stepText(st), found: !!s, ...(s ? { at: at(s) } : {}) };
    });
    const missing = steps.filter((s) => !s.found).map((s) => s.step);
    const detail = steps.map((s) => `${s.found ? "✓" : "✗"} ${s.step}${s.at ? ` (${s.at})` : ""}`).join("; ");
    out.push({
      section: "flows", id: f.id, steps,
      verdict: !missing.length ? "realised" : missing.length === steps.length ? "not-built" : "drifted",
      detail: missing.length ? `${missing.length} of ${steps.length} step(s) not in the code: ${detail}` : `every step found: ${detail}`,
      ...(missing.length ? { missing } : {}),
    });
  }
  return out;
}
