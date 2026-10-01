// The plan's ARCHITECTURE sections (2026-10-01): stores and the zones inside
// them — validated here so plan_store.ts stays the generic half. Every check
// returns null or the reason, said verbatim to whoever sent the item.

import { MODULE_KINDS, PLAN_CAPS, PRINCIPAL_KINDS, STORE_KINDS } from "../shared/plan_types.ts";
import type { Plan, PlanStore } from "../shared/plan_types.ts";

const str = (x: unknown) => typeof x === "string";
const line = (x: unknown, max: number = PLAN_CAPS.line) => typeof x === "string" && x.trim().length > 0 && x.length <= max;
const names = (x: unknown, max: number, len = 120) => Array.isArray(x) && x.length <= max && x.every((v) => line(v, len));
const ZONE_RE = /^[\w .:\-{}*]{1,60}$/;

export function validateStore(o: Record<string, any>): string | null {
  if (!STORE_KINDS.includes(o.kind)) return `kind must be one of ${STORE_KINDS.join("|")}`;
  if (o.label !== undefined && !line(o.label, 80)) return "label must be a short name";
  if (o.serves !== undefined && o.serves !== null && !line(o.serves)) return "serves must be one line";
  if (!names(o.reachedThrough, 6) || !o.reachedThrough.length) {
    return "reachedThrough must list 1–6 names the code reaches it through: tools (an SDK, a data library), a project funnel (`lib.store`) or a project folder (`packages/store-client/`)";
  }
  if (o.access !== undefined) {
    if (!o.access || typeof o.access !== "object" || Array.isArray(o.access)) return "access must be {write?, read?, watch?}: the client functions that touch the store";
    for (const [k, v] of Object.entries(o.access)) {
      if (!["write", "read", "watch"].includes(k)) return `access.${k}: only write, read and watch`;
      if (!names(v, 8, 120)) return `access.${k} must list up to 8 function names (\`writeDoc\`, \`Store.put\`)`;
    }
  }
  if (o.zones !== undefined) {
    if (!Array.isArray(o.zones) || o.zones.length > PLAN_CAPS.zones) return `zones must be a list of at most ${PLAN_CAPS.zones}`;
    const seen = new Set<string>();
    for (const [i, z] of (o.zones as any[]).entries()) {
      const err = validateZone(z);
      if (err) return `zones[${i}]: ${err}`;
      if (seen.has(z.id)) return `zones[${i}]: duplicate zone "${z.id}"`;
      seen.add(z.id);
    }
  }
  return null;
}

function validateZone(z: any): string | null {
  if (!z || typeof z !== "object" || Array.isArray(z)) return "must be an object";
  if (!str(z.id) || !ZONE_RE.test(z.id)) return "id must be a short name";
  if (z.label !== undefined && !line(z.label, 80)) return "label must be a short name";
  if (!names(z.holds, 12, 80) || !z.holds.length) return "holds must list 1–12 document families or key patterns that live in it";
  for (const k of ["writers", "readers"]) if (z[k] !== undefined && !names(z[k], 12, 80)) return `${k} must list up to 12 principal ids`;
  if (z.routedBy !== undefined && !line(z.routedBy, 120)) return "routedBy must be a literal the code names, or `router: <function>`";
  return null;
}

export function validatePrincipal(o: Record<string, any>): string | null {
  if (!PRINCIPAL_KINDS.includes(o.kind)) return `kind must be one of ${PRINCIPAL_KINDS.join("|")}`;
  if (o.label !== undefined && !line(o.label, 80)) return "label must be a short name";
  return null;
}

export function validateFlow(o: Record<string, any>): string | null {
  if (o.serves !== undefined && !line(o.serves)) return "serves must be one line";
  if (!Array.isArray(o.steps) || o.steps.length < 2) return "steps must list at least two steps (a write and the read or watch that reacts to it)";
  if (o.steps.length > PLAN_CAPS.flowSteps) return `steps: ${o.steps.length}, over the cap of ${PLAN_CAPS.flowSteps}`;
  for (const [i, st] of (o.steps as any[]).entries()) {
    if (!st || typeof st !== "object") return `steps[${i}] must be an object`;
    if (!line(st.process, 80)) return `steps[${i}].process must be a planned process id`;
    if (!["write", "read", "watch"].includes(st.op)) return `steps[${i}].op must be write | read | watch`;
    if (!line(st.zone, 120) || !String(st.zone).includes("/")) return `steps[${i}].zone must be "store/zone"`;
    if (st.family !== undefined && !line(st.family, 80)) return `steps[${i}].family must be a document family`;
  }
  return null;
}

export function validateModule(o: Record<string, any>): string | null {
  if (!MODULE_KINDS.includes(o.kind)) return `kind must be one of ${MODULE_KINDS.join("|")}`;
  if (!line(o.at, 120)) return "at must be the folder its code lives in";
  if (o.label !== undefined && !line(o.label, 80)) return "label must be a short name";
  return null;
}

/** `assumes` and `evidence` — on any item; a question carries evidence only. */
export function validateAssumptions(o: Record<string, any>, question: boolean): string | null {
  if (o.assumes !== undefined) {
    if (question) return "a question does not assume another — record its evidence";
    if (!names(o.assumes, 6, 40)) return "assumes must list up to 6 open-question ids (q1, q2…)";
  }
  if (o.evidence !== undefined) {
    if (!Array.isArray(o.evidence) || o.evidence.length > 6) return "evidence must be a list of at most 6 runs";
    for (const [i, e] of (o.evidence as any[]).entries()) {
      if (!e || typeof e !== "object") return `evidence[${i}] must be an object`;
      if (!line(e.command, 240)) return `evidence[${i}].command must be the command that was (or will be) run`;
      if (!line(e.expect, PLAN_CAPS.line)) return `evidence[${i}].expect must say, in one line, what it should show`;
      if (!str(e.at) || !/^\d{4}-\d{2}-\d{2}/.test(e.at)) return `evidence[${i}].at must be a date (YYYY-MM-DD…)`;
      if (e.result !== undefined && e.result !== "confirmed" && e.result !== "refuted") return `evidence[${i}].result must be confirmed | refuted (absent = not run yet)`;
      if (e.note !== undefined && !line(e.note, PLAN_CAPS.line)) return `evidence[${i}].note must be one line`;
    }
  }
  return null;
}

/** The zone a boundary or flow names, if its store has it. */
export function zoneOf(plan: Plan, storeId: string, zoneId: string) {
  return (plan.stores ?? []).find((s) => s.id === storeId)?.zones?.find((z) => z.id === zoneId);
}

/** Cross-references the architecture sections make (run after every item is
 *  valid on its own): a boundary's `zone` must belong to its store. */
export function validateArchRefs(p: Plan): string | null {
  const stores = new Map<string, PlanStore>((p.stores ?? []).map((s) => [s.id, s]));
  const procs = new Set(p.processes.map((x) => x.id));
  for (const s of stores.keys()) if (procs.has(s)) return `stores ${s}: a process has the same id — a store is not a process (convert it: plan edit '{"op":"to-store","id":"${s}"}')`;
  // Identities: whatever names a principal must name a planned one.
  const principals = new Set((p.principals ?? []).map((x) => x.id));
  for (const pr of p.processes) {
    if (pr.runsAs !== undefined && !principals.has(pr.runsAs)) return `processes ${pr.id}: runsAs "${pr.runsAs}" is not a planned principal`;
  }
  for (const st of stores.values()) for (const z of st.zones ?? []) for (const k of ["writers", "readers"] as const) {
    for (const who of z[k] ?? []) if (!principals.has(who)) return `stores ${st.id}/${z.id}: ${k} names "${who}", which is not a planned principal (add it to principals)`;
  }
  // An assumption is an open question the plan holds.
  const questions = new Set(p.open.map((q) => q.id));
  for (const section of ["processes", "boundaries", "stack", "threads", "policies", "stores", "principals", "flows", "modules"] as const) {
    for (const it of ((p as any)[section] ?? []) as Array<{ id?: string; tool?: string; assumes?: string[] }>) {
      for (const q of it.assumes ?? []) if (!questions.has(q)) return `${section} ${it.id ?? it.tool}: assumes "${q}", which is not an open question of the plan`;
    }
  }
  // A process uses planned modules.
  const modules = new Set((p.modules ?? []).map((m) => m.id));
  for (const pr of p.processes) for (const u of pr.uses ?? []) if (!modules.has(u)) return `processes ${pr.id}: uses "${u}", which is not a planned module`;
  // A flow's steps name planned processes and zones.
  for (const f of p.flows ?? []) for (const [i, st] of f.steps.entries()) {
    if (!procs.has(st.process)) return `flows ${f.id}: steps[${i}] names process "${st.process}", which is not planned`;
    const [sid, zid] = st.zone.split("/");
    if (!stores.get(sid)?.zones?.some((z) => z.id === zid)) return `flows ${f.id}: steps[${i}] names zone "${st.zone}", which no planned store has`;
  }
  for (const b of p.boundaries) {
    if (b.zone === undefined) continue;
    const st = stores.get(b.to);
    if (!st) return `boundaries ${b.id}: zone "${b.zone}" is given, but ${b.to} is not a planned store`;
    if (!st.zones?.some((z) => z.id === b.zone)) return `boundaries ${b.id}: store ${b.to} has no zone "${b.zone}" (it has: ${(st.zones ?? []).map((z) => z.id).join(", ") || "none"})`;
  }
  return null;
}
