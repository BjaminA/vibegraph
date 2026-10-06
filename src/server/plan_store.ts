// THE PLAN's store (2026-09-30): validate, load, save, and the two views the
// older greenfield flow still speaks.
//
// `.vibegraph/plan.json` REPLACES `.vibegraph/system-plan.json`. A plan's
// processes and boundaries are exactly what a SystemPlan's subsystems and
// edges were, so the greenfield flow keeps its own shape through two pure
// functions: `toSystemPlan` (what it reads) and `mergeSystemPlan` (what its
// acceptance writes, onto whatever else the plan already holds). A project
// that only has the old file is read from it and converted on the next save;
// the old file is removed then, so there is never a second source of truth.
//
// Validation is hand-rolled at the boundary (the file, WS payloads and MCP
// args are all untrusted) and enforces the CAPS: a plan that outgrows them is
// refused with the reason, never trimmed, because the size limit is what keeps
// a plan about its objective.

import { validateDecisions } from "./plan_decisions.ts";
import * as fs from "fs";
import * as path from "path";
import type {
  Plan, PlanProcess, PlanBoundary, PlanTool, PlanThread, PlanPolicy, PlanQuestion, PlanSection, PlanStore,
} from "../shared/plan_types.ts";
import { PLAN_CAPS, PLAN_OPTIONAL_SECTIONS, PLAN_SECTIONS, planItemId } from "../shared/plan_types.ts";
import { validateArchRefs, validateAssumptions, validateFlow, validateModule, validatePrincipal, validateStore } from "./plan_store_items.ts";
import { STACK_ROLES } from "../shared/stack_taxonomy.ts";
import { words } from "./plan_thread_match.ts";
import type { SystemPlan, SubsystemKind } from "../shared/protocol";

export const PLAN_FILE = path.join(".vibegraph", "plan.json");
export const LEGACY_PLAN_FILE = path.join(".vibegraph", "system-plan.json");

export const PROCESS_KINDS: readonly SubsystemKind[] = ["frontend", "backend", "db", "cache", "external_http", "library"];
const STATUSES = ["proposed", "agreed", "dropped"];
const POLICY_STATUSES = [...STATUSES, "promoted"];

const str = (x: unknown) => typeof x === "string";
const line = (x: unknown, max: number = PLAN_CAPS.line) => typeof x === "string" && x.trim().length > 0 && x.length <= max;
const ID_RE = /^[\w .:/<>{}\-]{1,80}$/;

export function emptyPlan(objective: string): Plan {
  return { version: "1", revision: 0, objective, processes: [], boundaries: [], stack: [], threads: [], policies: [], open: [], changelog: [] };
}

/** null when valid, else the reason (surfaced verbatim — a refusal says why). */
export function validatePlan(x: unknown): string | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return "plan must be an object";
  const p = x as Record<string, unknown>;
  if (p.version !== "1") return `unknown plan version: ${String(p.version)}`;
  if (!Number.isInteger(p.revision) || (p.revision as number) < 0) return "revision must be a non-negative integer";
  if (!line(p.objective, PLAN_CAPS.objective)) return `objective must be one line of at most ${PLAN_CAPS.objective} characters — the plan exists to serve it`;
  if (p.description !== undefined && !(str(p.description) && (p.description as string).length <= PLAN_CAPS.description)) return `description must be text of at most ${PLAN_CAPS.description} characters`;
  for (const k of ["closed", "drafted"]) if (p[k] !== undefined && typeof p[k] !== "boolean") return `${k} must be a boolean`;
  if (p.ratifiedAt !== undefined && !str(p.ratifiedAt)) return "ratifiedAt must be a string";
  for (const s of PLAN_SECTIONS) {
    if (p[s] === undefined && PLAN_OPTIONAL_SECTIONS.includes(s)) continue;
    if (!Array.isArray(p[s])) return `${s} must be an array`;
  }
  if (!Array.isArray(p.changelog)) return "changelog must be an array";
  const badDecisions = validateDecisions(p.decisions);
  if (badDecisions) return badDecisions;
  if (p.resolved !== undefined) {
    if (!Array.isArray(p.resolved)) return "resolved must be an array";
    if (p.resolved.length > PLAN_CAPS.resolved) return `resolved keeps at most ${PLAN_CAPS.resolved} questions`;
    const openIds = new Set(((p.open ?? []) as Array<{ id: string }>).map((q) => q.id));
    for (const [i, r] of (p.resolved as any[]).entries()) {
      if (!r || typeof r !== "object" || !str(r.id) || !line(r.text, PLAN_CAPS.question)) return `resolved[${i}]: a question with an id and its text`;
      if (r.state !== "closed" && r.state !== "dropped") return `resolved[${i}]: state is closed or dropped`;
      if (!Number.isInteger(r.rev) || !str(r.at) || (r.by !== "human" && r.by !== "agent")) return `resolved[${i}]: rev, at and by say when and who`;
      if (r.note !== undefined && !line(r.note, PLAN_CAPS.note)) return `resolved[${i}]: note is one line of at most ${PLAN_CAPS.note} characters`;
      if (openIds.has(r.id)) return `resolved[${i}]: ${r.id} is open too`;
    }
  }

  for (const s of PLAN_SECTIONS) {
    const items = (p[s] ?? []) as unknown[];
    const cap = PLAN_CAPS[s];
    // Dropped items stay for the record but do not count against the cap.
    const live = items.filter((i: any) => i?.status !== "dropped").length;
    if (live > cap) return `${s}: ${live} items, over the cap of ${cap} — a plan this size has stopped being about its objective; drop or merge some. ${capCandidates(s, items)}`;
    const ids = new Set<string>();
    for (const [i, raw] of items.entries()) {
      const err = validateItem(s, raw);
      if (err) return `${s}[${i}]: ${err}`;
      const id = planItemId(s, raw);
      if (ids.has(id)) return `${s}[${i}]: duplicate id "${id}"`;
      ids.add(id);
    }
  }
  // A boundary's ends may name something that already exists in the code (a
  // plan on top of a real project connects to it), so they are not required
  // to be planned; the rendering says which ends the plan does not hold.
  const procs = new Set((p.processes as PlanProcess[]).map((x) => x.id));
  for (const t of p.threads as PlanThread[]) {
    if (t.process && !procs.has(t.process)) return `threads ${t.id}: process "${t.process}" is not planned`;
  }
  // `about` places a rule or a question on the map: it must name something
  // the plan holds, or it would be drawn nowhere.
  const known = new Set([
    ...procs, ...(p.threads as PlanThread[]).map((x) => x.id),
    ...(p.boundaries as PlanBoundary[]).map((x) => x.id), ...(p.stack as PlanTool[]).map((x) => x.tool),
    ...((p.stores ?? []) as PlanStore[]).flatMap((s) => [s.id, ...(s.zones ?? []).map((z) => `${s.id}/${z.id}`)]),
    ...((p.modules ?? []) as Array<{ id: string }>).map((m) => m.id),
  ]);
  for (const [s, items] of [["policies", p.policies], ["open", p.open]] as const) {
    for (const it of items as Array<{ id: string; about?: string }>) {
      if (it.about !== undefined && !known.has(it.about)) return `${s} ${it.id}: about "${it.about}" names no planned process, thread, boundary, tool, store, zone (store/zone) or module`;
    }
  }
  return validateArchRefs(p as unknown as Plan);
}

/** 2026-10-01 — a cap refusal names what to drop or merge, not only "no":
 *  the PROPOSED items first (nobody agreed to them yet), then the pairs whose
 *  words overlap most (a word-match guess that two items say one thing). */
export function capCandidates(section: PlanSection, items: unknown[]): string {
  const live = (items as any[]).filter((i) => i?.status !== "dropped");
  const label = (i: any) => planItemId(section, i);
  const gist = (i: any) => String(i.text ?? i.serves ?? i.label ?? i.why ?? "").slice(0, 60);
  const proposed = live.filter((i) => i.status === "proposed").slice(0, 5);
  const ws = live.map((i) => new Set(words(`${label(i)} ${gist(i)} ${(i.primary ?? []).join(" ")}`)));
  // A word most items use says nothing about two of them: shared words are
  // weighed by how rare they are across the section (idf).
  const df = new Map<string, number>();
  for (const s of ws) for (const w of s) df.set(w, (df.get(w) ?? 0) + 1);
  const weight = (w: string) => Math.log((live.length + 1) / (df.get(w) ?? 1));
  const pairs: Array<{ a: any; b: any; shared: string[]; score: number }> = [];
  for (let x = 0; x < live.length; x++) for (let y = x + 1; y < live.length; y++) {
    const shared = [...ws[x]].filter((w) => ws[y].has(w)).sort((p, q) => weight(q) - weight(p));
    const score = shared.reduce((k, w) => k + weight(w), 0);
    if (shared.length >= 2 && score > 1) pairs.push({ a: live[x], b: live[y], shared, score });
  }
  pairs.sort((p, q) => q.score - p.score);
  const parts = [
    proposed.length ? `drop a proposed one: ${proposed.map((i) => `${label(i)}${gist(i) ? ` ("${gist(i)}")` : ""}`).join(", ")}` : "",
    pairs.length ? `or merge: ${pairs.slice(0, 3).map((p) => `${label(p.a)} + ${label(p.b)} (both about ${p.shared.slice(0, 3).join(", ")})`).join("; ")}` : "",
  ].filter(Boolean);
  return parts.length ? `Candidates — ${parts.join("; ")}.` : "Every item is agreed and none overlaps: drop the one that serves the objective least.";
}

export function validateItem(section: PlanSection, raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "must be an object";
  const o = raw as Record<string, any>;
  const assumed = validateAssumptions(o, section === "open");
  if (assumed) return assumed;
  // 2026-10-01 — the agreed version an agent's change replaced (plan review's diff).
  if (o.agreedAs !== undefined && (!o.agreedAs || typeof o.agreedAs !== "object" || Array.isArray(o.agreedAs) || (o.agreedAs as any).agreedAs !== undefined)) return "agreedAs must be the agreed version of the item";
  if ((section === "open" || section === "policies") && o.about !== undefined && !line(o.about, 80)) return "about must name a planned item (a process, thread, boundary or tool id)";
  if (section === "open") {
    if (!str(o.id) || !ID_RE.test(o.id)) return "id must be a short name";
    // A question may carry its answer as it is found ("ANSWERED (date): …").
    return line(o.text, PLAN_CAPS.question) ? null : `text must be at most ${PLAN_CAPS.question} characters`;
  }
  const statuses = section === "policies" ? POLICY_STATUSES : STATUSES;
  if (o.groundedIn !== undefined && o.groundedIn !== null && !(str(o.groundedIn) && o.groundedIn.length <= 400)) return "groundedIn must be a quote (≤ 400) or null";
  if (section === "policies" && o.source !== undefined && !line(o.source, 80)) return "source must be short (e.g. synapse s1)";
  if (!statuses.includes(o.status)) return `status must be one of ${statuses.join("|")}`;
  const id = planItemId(section, o);
  if (!ID_RE.test(id)) return `${section === "stack" ? "tool" : "id"} must be a short name (letters, digits, space . : / - _ < > { })`;
  switch (section) {
    case "processes":
      if (!PROCESS_KINDS.includes(o.kind)) return `kind must be one of ${PROCESS_KINDS.join("|")}`;
      if (!line(o.label, 80)) return "label must be a short name";
      if (o.serves !== null && !line(o.serves)) return "serves must say, in one line, which part of the objective this is for";
      if (o.at !== undefined && !line(o.at, 120)) return "at must be a path prefix";
      if (o.runsAs !== undefined && !line(o.runsAs, 80)) return "runsAs must be a principal id";
      if (o.entryPoints !== undefined && !(Array.isArray(o.entryPoints) && o.entryPoints.length <= 8 && o.entryPoints.every((x: unknown) => line(x, 200)))) return "entryPoints must list up to 8 files or entry-point ids it starts from";
      if (o.uses !== undefined && !(Array.isArray(o.uses) && o.uses.length <= 12 && o.uses.every((x: unknown) => line(x, 80)))) return "uses must list up to 12 module ids";
      if (o.groundedIn !== undefined && o.groundedIn !== null && !str(o.groundedIn)) return "groundedIn must be a quote or null";
      return null;
    case "stores":
      return validateStore(o);
    case "principals":
      return validatePrincipal(o);
    case "flows":
      return validateFlow(o);
    case "modules":
      return validateModule(o);
    case "boundaries":
      if (!str(o.from) || !str(o.to)) return "from and to are required";
      if (o.zone !== undefined && !line(o.zone, 60)) return "zone must be a zone id of the store it targets";
      if (o.protocol !== undefined && !line(o.protocol, 40)) return "protocol must be a short name";
      if (o.carries !== undefined && !(Array.isArray(o.carries) && o.carries.length <= 16 && o.carries.every((k: unknown) => line(k, 60)))) return "carries must be up to 16 key names";
      if (o.groundedIn !== undefined && o.groundedIn !== null && !str(o.groundedIn)) return "groundedIn must be a quote or null";
      return null;
    case "stack":
      if (!STACK_ROLES.includes(o.role)) return `role must be one of ${STACK_ROLES.join("|")}`;
      if (o.why !== undefined && !line(o.why)) return "why must be one line";
      if (o.via !== undefined && !(Array.isArray(o.via) && o.via.length <= 6 && o.via.every((v: unknown) => line(v, 80)))) return "via must be up to 6 client-library names (the tool is reached through them)";
      return null;
    case "threads":
      if (!line(o.entry, 40)) return "entry must say what kind of entry point it is (route, cli, script, page, tool, test…)";
      if (!line(o.serves)) return "serves must say, in one line, which part of the objective this is for";
      if (!Array.isArray(o.primary) || o.primary.length === 0) return "primary must list its steps";
      if (o.primary.length > PLAN_CAPS.primarySteps) return `primary: ${o.primary.length} steps, over the cap of ${PLAN_CAPS.primarySteps} — primary steps only (what leaves the project, and the path to it)`;
      if (!o.primary.every((x: unknown) => line(x, 80))) return "each primary step must be a short name";
      if (o.process !== undefined && !str(o.process)) return "process must be a process id";
      if (o.entryPoint !== undefined && !line(o.entryPoint, 200)) return "entryPoint must be an entry-point id (file:name) or a file path";
      return null;
    case "policies":
      if (!line(o.text, 240)) return "text must be one sentence";
      if (!line(o.why, 240)) return "why is required — a rule without its reason gets worked around";
      if (o.check !== undefined && (!o.check || typeof o.check !== "object" || typeof o.check.rule !== "string")) return "check must be a constraint-grammar clause ({rule, …})";
      if (o.files !== undefined && !(Array.isArray(o.files) && o.files.every((f: unknown) => line(f, 120)))) return "files must be path prefixes";
      if (o.status === "promoted" && !str(o.constraintId)) return "a promoted policy names its constraint id";
      return null;
  }
  return null;
}

// ── read / write ──────────────────────────────────────────────────────────

/** The plan, or null. An invalid file is IGNORED with a warning, never
 *  half-loaded. Only an old system-plan.json → converted in memory. */
export function loadPlan(root: string): Plan | null {
  const read = (rel: string) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf-8")); } catch (e: any) {
      if (e?.code !== "ENOENT") console.warn(`  [plan] ${rel} is not valid JSON — ignoring: ${e.message}`);
      return undefined;
    }
  };
  const raw = read(PLAN_FILE);
  if (raw !== undefined) {
    const err = validatePlan(raw);
    if (err) { console.warn(`  [plan] ${PLAN_FILE} failed validation — ignoring: ${err}`); return null; }
    return raw as Plan;
  }
  const legacy = read(LEGACY_PLAN_FILE);
  if (legacy === undefined) return null;
  const conv = fromSystemPlan(legacy as SystemPlan, null);
  return validatePlan(conv) ? null : conv;
}

/** The mtime the server keys its reload on: whichever file is the plan. */
export function planMtime(root: string): number {
  for (const rel of [PLAN_FILE, LEGACY_PLAN_FILE]) {
    try { return fs.statSync(path.join(root, rel)).mtimeMs; } catch { /* next */ }
  }
  return 0;
}

export function savePlan(root: string, plan: Plan): { path?: string; error?: string } {
  const err = validatePlan(plan);
  if (err) return { error: err };
  const file = path.join(root, PLAN_FILE);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // An empty optional section is left out, so a plan that uses none of
    // them is byte-for-byte what it was before they existed.
    const out: Record<string, unknown> = { ...plan };
    for (const s of PLAN_OPTIONAL_SECTIONS) if (!(out[s] as unknown[] | undefined)?.length) delete out[s];
    if (!(out.resolved as unknown[] | undefined)?.length) delete out.resolved;
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(out, null, 2) + "\n", "utf-8");
    fs.renameSync(`${file}.tmp`, file);
    // The converted legacy file is now a second, stale copy: remove it.
    fs.rmSync(path.join(root, LEGACY_PLAN_FILE), { force: true });
  } catch (e: any) {
    return { error: `could not save the plan: ${e.message}` };
  }
  return { path: file };
}

/** 2026-10-01 — a planned rule PROMOTED into a constraint that no longer
 *  exists (removed with `constraint remove`, or by hand) is a planned rule
 *  again: back to `agreed`, its `constraintId` gone, the changelog saying why.
 *  Never left reading "promoted as c2" with no c2. Returns the ids demoted. */
export function demoteOrphanedPromotions(root: string, constraintIds: ReadonlySet<string>, now: Date = new Date()): string[] {
  const plan = loadPlan(root);
  if (!plan) return [];
  const orphans = plan.policies.filter((p) => p.status === "promoted" && (!p.constraintId || !constraintIds.has(p.constraintId)));
  if (!orphans.length) return [];
  const next: Plan = structuredClone(plan);
  next.revision += 1;
  const at = now.toISOString();
  for (const o of orphans) {
    const p = next.policies.find((x) => x.id === o.id)!;
    next.changelog.push({ rev: next.revision, at, by: "human", change: `${p.constraintId ?? "its constraint"} is gone from constraints.json — ${p.id} is a planned rule again (agreed), no longer enforced` });
    p.status = "agreed";
    delete p.constraintId;
  }
  next.changelog = next.changelog.slice(-PLAN_CAPS.changelog);
  return savePlan(root, next).error ? [] : orphans.map((o) => o.id);
}

// ── the greenfield flow's view ───────────────────────────────────────────

/** What the older greenfield flow reads: AGREED processes as subsystems, and
 *  agreed process→process boundaries as edges (a boundary to a TOOL is not a
 *  subsystem edge). Agreed only: that flow reads a plan as an architecture a
 *  person approved (it offers the roadmap next), and a proposal is not that.
 *  Null when nothing is agreed. */
export function toSystemPlan(plan: Plan | null): SystemPlan | null {
  if (!plan) return null;
  const procs = plan.processes.filter((p) => p.status === "agreed");
  if (!procs.length) return null;
  const ids = new Set(procs.map((p) => p.id));
  return {
    version: "1",
    description: plan.description ?? plan.objective,
    subsystems: procs.map((p) => ({ id: p.id, kind: p.kind, label: p.label, groundedIn: p.groundedIn ?? null })),
    edges: plan.boundaries.filter((b) => b.status === "agreed" && ids.has(b.from) && ids.has(b.to))
      .map((b) => ({ from: b.from, to: b.to, groundedIn: b.groundedIn ?? null })),
    drafted: plan.drafted ?? false,
    ...(plan.ratifiedAt ? { ratifiedAt: plan.ratifiedAt } : {}),
  };
}

/** A person ACCEPTED a greenfield architecture: fold it into the plan. The
 *  subsystems become agreed processes (a process it no longer lists is
 *  dropped, not deleted), its edges agreed boundaries; everything else the
 *  plan holds (threads, stack, rules, questions) is kept. */
export function fromSystemPlan(sp: SystemPlan, prior: Plan | null, now: Date = new Date()): Plan {
  const firstLine = (t: string) => {
    const s = t.trim().split(/(?<=[.!?])\s|\n/)[0] ?? t;
    return s.length > PLAN_CAPS.objective ? `${s.slice(0, PLAN_CAPS.objective - 1)}…` : s;
  };
  const base = prior ?? emptyPlan(firstLine(sp.description ?? "") || "the planned system");
  const byId = new Map(base.processes.map((p) => [p.id, p]));
  const kept = new Set<string>();
  const processes: PlanProcess[] = [];
  for (const s of sp.subsystems ?? []) {
    kept.add(s.id);
    const was = byId.get(s.id);
    processes.push({ ...(was ?? { serves: null }), id: s.id, kind: s.kind, label: s.label, groundedIn: s.groundedIn, status: "agreed" });
  }
  for (const p of base.processes) if (!kept.has(p.id)) processes.push({ ...p, status: "dropped" });
  const edgeKey = (from: string, to: string) => `${from}→${to}`;
  const oldEdges = new Map(base.boundaries.map((b) => [edgeKey(b.from, b.to), b]));
  const boundaries: PlanBoundary[] = base.boundaries.filter((b) => !kept.has(b.from) || !kept.has(b.to));
  let n = base.boundaries.length;
  for (const e of sp.edges ?? []) {
    const was = oldEdges.get(edgeKey(e.from, e.to));
    boundaries.push({ ...(was ?? { id: `b${++n}` }), from: e.from, to: e.to, groundedIn: e.groundedIn, status: "agreed" });
    oldEdges.delete(edgeKey(e.from, e.to));
  }
  // An edge between kept processes the accepted architecture no longer lists
  // is dropped, not deleted: the record keeps what was planned.
  for (const b of oldEdges.values()) if (kept.has(b.from) && kept.has(b.to)) boundaries.push({ ...b, status: "dropped" });
  // A boundary into a process that is now dropped goes with it.
  const gone = new Set(processes.filter((p) => p.status === "dropped").map((p) => p.id));
  for (const [i, b] of boundaries.entries()) if (b.status !== "dropped" && (gone.has(b.from) || gone.has(b.to))) boundaries[i] = { ...b, status: "dropped" };
  const next: Plan = {
    ...base,
    description: sp.description,
    drafted: sp.drafted,
    ratifiedAt: sp.ratifiedAt ?? now.toISOString(),
    processes, boundaries,
  };
  return next;
}

export type { Plan, PlanProcess, PlanBoundary, PlanTool, PlanThread, PlanPolicy, PlanQuestion };
