// THE DATA FACTS A BRIEF IS CHECKED AGAINST (2026-10-08, the Brief review's
// B9 / B10). Zero tokens. A brief line that says "X writes Z" or "Y watches W"
// re-states something VibeGraph already knows, so it can be checked:
//
//   ops        who writes / reads / watches which zone — DERIVED from the map's
//              zone edges, and DECLARED by the plan's flows (a feed over a
//              declared family is invisible to static analysis: the plan says
//              it, and the review shows it as declared, not derived)
//   zones      each zone's store, families, the PARTITION keys its family
//              names (`request_{Role}__{Person}` = one partition per role and
//              person) and who the declared topology grants write
//   processes  each process box's PRIMARY operations (what the plan's flows
//              give it, else what it does most) apart from its secondary ones
//   verify     boxes and files that only TEST a mechanism (test files, probes,
//              live checks, examples): evidence that it works, never what it is

import type { ArchModelRecord } from "../shared/protocol.ts";
import type { Plan } from "../shared/plan_types.ts";
import type { Topology } from "../shared/topology_types.ts";
import { isTestFile } from "../shared/path_match.ts";

export type DataOp = "write" | "read" | "watch" | "attempt";
const OPS: DataOp[] = ["write", "read", "watch", "attempt"];
/** `verify`: the operation is a test's or a probe's (every place it is made is
 *  a test, probe or demo file, or a refused attempt) — evidence that a rule
 *  holds, never one of the process's jobs, never a second writer. */
export interface BoxOp { box: string; zone: string; op: DataOp; source: "derived" | "declared" | "inferred" | "observed"; count: number; cite: string; verify?: boolean;
  /** a declared operation whose process the plan places by folder only */
  located?: boolean;
  /** declared by the project's topology (a feed), not by the plan */
  feed?: boolean;
  /** every box of the planned process this step belongs to, when it has
   *  several: the PROCESS does the step, so any one of them answers it */
  group?: string[] }

/** An edge made only by tests, probes or refused attempts. */
export const verifyEdge = (e: { protocol?: string; from: string; refs?: Array<{ file?: string }> }, verifyBoxes: Set<string>): boolean =>
  e.protocol === "attempt" || verifyBoxes.has(e.from) || (!!e.refs?.length && e.refs.every((r) => !!r.file && isVerifyFile(r.file)));
export interface ZoneFacts { id: string; label: string; store: string; holds: string[]; holes: string[]; grantedWrite: string[] }
export interface ProcessFacts { box: string; label: string; primary: BoxOp[]; secondary: BoxOp[]; why: string }
export interface BriefData { ops: BoxOp[]; zones: Map<string, ZoneFacts>; processes: ProcessFacts[]; verifyBoxes: Set<string>;
  /** planned processes whose folder holds several boxes: charged to none */
  ambiguous: Array<{ process: string; boxes: string[] }>;
  /** declared feeds whose `via` functions the code no longer defines */
  staleFeeds: Array<{ cite: string; process: string; why: string }> }

/** A topology feed, resolved (topology_feeds.ts). */
export interface FeedDecl { index: number; process: string; boxes: string[]; op: "watch" | "read" | "write"; family: string; stale?: string; cite: string }

/** A file that tests, probes or demonstrates rather than runs the system. */
const VERIFY_NAME = /(^|[-_.])(probe|smoke|live-?check|check|e2e|spec|fixture|example|demo)s?([-_.]|$)/i;
export const isVerifyFile = (file: string): boolean => isTestFile(file) || VERIFY_NAME.test(file.split("/").pop() ?? "");

const fileOf = (ep: string) => ep.split(":")[0];
const holesOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/** How a planned process found its box (2026-10-08, the run-time review):
 *  ANCHORED by its named entry points (only those boxes, whatever its folder
 *  holds), LOCATED by its folder (one box — a weaker match, said as such), or
 *  AMBIGUOUS (its folder holds several boxes: none is picked, it is said). */
export interface PlanBoxMatch { boxes: string[]; how: "anchored" | "located" | "ambiguous" }

export function planProcessMatches(plan: Plan | null | undefined, model: ArchModelRecord): Map<string, PlanBoxMatch> {
  const out = new Map<string, PlanBoxMatch>();
  const clusters = model.nodes.filter((n) => n.kind === "cluster");
  for (const pr of plan?.processes ?? []) {
    if (pr.status === "dropped") continue;
    const named = new Set(pr.entryPoints ?? []);
    if (named.size) {
      const boxes = clusters.filter((n) => (n.entryPoints ?? []).some((ep) => named.has(ep) || named.has(fileOf(ep)))).map((n) => n.id);
      if (boxes.length) out.set(pr.id, { boxes, how: "anchored" });
      continue;
    }
    const at = pr.at ? pr.at.replace(/^\.\//, "") : null;
    if (!at) continue;
    const boxes = clusters.filter((n) => (n.entryPoints ?? []).some((ep) => {
      const f = fileOf(ep);
      return at.endsWith("/") ? f.startsWith(at) : f === at || f.startsWith(`${at}/`);
    })).map((n) => n.id);
    if (boxes.length) out.set(pr.id, { boxes, how: boxes.length === 1 ? "located" : "ambiguous" });
  }
  return out;
}

/** The boxes a planned process's operations are charged to: anchored or
 *  located ones; never an ambiguous match. */
export function planProcessBoxes(plan: Plan | null | undefined, model: ArchModelRecord): Map<string, string[]> {
  return new Map([...planProcessMatches(plan, model)].filter(([, m]) => m.how !== "ambiguous").map(([id, m]) => [id, m.boxes]));
}

/** A person-ratified claim whose cited lines still hold (claim_store.ts). */
export interface RatifiedClaim { id: string; subject: string; verb: string; object: string }

export function briefData(model: ArchModelRecord, opts: { plan?: Plan | null; topology?: Topology | null; claims?: RatifiedClaim[]; feeds?: FeedDecl[] } = {}): BriefData {
  const verifyBoxes = new Set(model.nodes.filter((n) => n.kind === "cluster" && (n.entryPoints ?? []).length > 0 && (n.entryPoints ?? []).every((ep) => isVerifyFile(fileOf(ep)))).map((n) => n.id));
  const ops: BoxOp[] = [];
  for (const e of model.edges) {
    // an edge the map knows another way (a ratified claim, a declared feed, a
    // recorded run) is not read from the code: it comes in below, with its kind
    if (!e.to.startsWith("zone:") || !OPS.includes(e.protocol as DataOp)) continue;
    if (e.evidence === "observed") { ops.push({ box: e.from, zone: e.to, op: e.protocol as DataOp, source: "observed", count: e.count ?? 1, cite: e.id }); continue; }
    if (e.evidence) continue;
    const verify = verifyEdge(e, verifyBoxes);
    ops.push({ box: e.from, zone: e.to, op: e.protocol as DataOp, source: "derived", count: e.count ?? 1, cite: e.id, ...(verify ? { verify } : {}) });
  }
  const matches = planProcessMatches(opts.plan, model);
  const byProcess = planProcessBoxes(opts.plan, model);
  for (const f of opts.plan?.flows ?? []) {
    if (f.status === "dropped") continue;
    for (const st of f.steps) {
      const located = matches.get(st.process)?.how === "located";
      const boxes = byProcess.get(st.process) ?? [];
      for (const box of boxes) {
        const zone = `zone:${st.zone}`;
        if (!ops.some((o) => o.box === box && o.zone === zone && o.op === st.op && o.source === "declared")) ops.push({ box, zone, op: st.op, source: "declared", count: 1, cite: `plan:flows:${f.id}`, ...(located ? { located } : {}), ...(boxes.length > 1 ? { group: boxes } : {}) });
      }
    }
  }
  const ambiguous = [...matches].filter(([, m]) => m.how === "ambiguous").map(([process, m]) => ({ process, boxes: m.boxes }));
  const t = opts.topology;
  const zones = new Map<string, ZoneFacts>();
  const addZone = (id: string, label: string, store: string, holds: string[]) => {
    const families = (t?.families ?? []).filter((f) => holds.includes(f.id) || (f.zone && f.zone === label));
    const holes = [...new Set([...holds.flatMap(holesOf), ...families.flatMap((f) => holesOf(f.pattern ?? ""))])];
    const topoZone = (t?.zones ?? []).find((z) => z.id === label || `${z.store}/${z.id}` === id.slice("zone:".length));
    const grantedWrite = topoZone ? (t?.grants ?? []).filter((g) => g.zone === topoZone.id && g.access === "write").map((g) => g.who) : [];
    zones.set(id, { id, label, store, holds, holes, grantedWrite: [...new Set(grantedWrite)] });
  };
  for (const n of model.nodes) if (n.zoneOf) addZone(n.id, n.label, n.zoneOf.store, n.zoneOf.holds);
  // what a person agreed the code does at run time: inferred, not derived
  const VERB_OP: Record<string, DataOp> = { writes: "write", creates: "write", owns: "write", watches: "watch", reads: "read" };
  for (const k of opts.claims ?? []) {
    const op = VERB_OP[k.verb];
    if (!op) continue;
    for (const z of model.nodes.filter((n) => n.zoneOf && (n.id === k.object || n.label === k.object || n.id.endsWith(`/${k.object}`) || n.zoneOf.holds.includes(k.object)))) {
      if (!ops.some((o) => o.box === k.subject && o.zone === z.id && o.op === op && o.source === "derived")) ops.push({ box: k.subject, zone: z.id, op, source: "inferred", count: 1, cite: `claim:${k.id}` });
    }
  }
  // what the project's topology declares a process reaches at run time
  const staleFeeds: BriefData["staleFeeds"] = [];
  for (const f of opts.feeds ?? []) {
    if (f.stale) { staleFeeds.push({ cite: f.cite, process: f.process, why: f.stale }); continue; }
    for (const z of model.nodes.filter((n) => n.zoneOf && (n.id === f.family || n.label === f.family || n.id.endsWith(`/${f.family}`) || n.zoneOf.holds.includes(f.family)))) {
      for (const box of f.boxes) if (!ops.some((o) => o.box === box && o.zone === z.id && o.op === f.op && o.source === "derived")) ops.push({ box, zone: z.id, op: f.op, source: "declared", count: 1, cite: f.cite, feed: true });
    }
  }
  // a step one box of a process answers is the process's: its other boxes are
  // not missing it (a gateway's server writes requests; its ingest script need not)
  const kept = ops.filter((o) => !(o.source === "declared" && !o.feed && o.group && ops.some((d) => answersOp(d, o) && d.box !== o.box && o.group!.includes(d.box))));
  ops.length = 0;
  ops.push(...kept);
  // a zone the plan's flows name that the code does not reach is still a zone
  for (const st of opts.plan?.stores ?? []) for (const z of st.zones ?? []) {
    const id = `zone:${st.id}/${z.id}`;
    if (!zones.has(id)) addZone(id, z.id, st.id, z.holds);
  }
  const labels = new Map(model.nodes.map((n) => [n.id, n.label]));
  // a process's MAIN job, from the plan's flows: the step that starts its part
  // in each flow (what it reacts to, or what it first does) — not every step
  // it takes; the rest are secondary. At most two.
  const starts = new Map<string, Map<string, number>>();
  for (const f of opts.plan?.flows ?? []) {
    if (f.status === "dropped") continue;
    const seen = new Set<string>();
    for (const st of f.steps) {
      if (seen.has(st.process)) continue;
      seen.add(st.process);
      for (const box of byProcess.get(st.process) ?? []) {
        const m = starts.get(box) ?? new Map<string, number>();
        const k = `zone:${st.zone}|${st.op}`;
        m.set(k, (m.get(k) ?? 0) + 1);
        starts.set(box, m);
      }
    }
  }
  const mostlyVerify = (box: string) => {
    const eps = model.nodes.find((n) => n.id === box)?.entryPoints ?? [];
    return eps.length > 0 && eps.filter((ep) => isVerifyFile(fileOf(ep))).length * 2 > eps.length;
  };
  const processes: ProcessFacts[] = [];
  for (const box of [...new Set(ops.map((o) => o.box))]) {
    if (verifyBoxes.has(box) || mostlyVerify(box)) continue;
    // one entry per zone and operation: the code's when it shows it, else the plan's
    const mine: BoxOp[] = [];
    for (const o of ops.filter((x) => x.box === box && x.op !== "attempt" && !x.verify)) {
      const i = mine.findIndex((m) => m.zone === o.zone && m.op === o.op);
      if (i < 0) mine.push(o); else if (mine[i].source === "declared" && o.source === "derived") mine[i] = o;
    }
    let primary: BoxOp[], why: string;
    const s = starts.get(box);
    const keys = s?.size ? [...s].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k) : [];
    if (mine.some((o) => keys.includes(`${o.zone}|${o.op}`))) {
      primary = mine.filter((o) => keys.includes(`${o.zone}|${o.op}`));
      why = "where its part starts in the plan's flows";
    } else {
      const rank = (o: BoxOp) => o.count * 10 + (o.op === "write" ? 3 : o.op === "watch" ? 2 : 1);
      const top = Math.max(0, ...mine.map(rank));
      primary = mine.filter((o) => rank(o) === top).slice(0, 2);
      why = "what it does most";
    }
    if (!primary.length) continue;
    processes.push({ box, label: labels.get(box) ?? box, primary, secondary: mine.filter((o) => !primary.includes(o)), why });
  }
  return { ops, zones, processes, verifyBoxes, ambiguous, staleFeeds };
}

/** The plan's steps the code does not show and no ratified claim answers —
 *  the FACTS GAPS (a watch counts as a read). Anchored ones first. */
export function openGaps(data: BriefData): BoxOp[] {
  const seen = new Set<string>();
  return data.ops.filter((o) => o.source === "declared" && !o.feed && !data.ops.some((d) => d.box === o.box && answersOp(d, o)))
    // a process with several boxes misses a step once, not once per box
    .filter((o) => { const k = `${(o.group ?? [o.box]).join(",")}|${o.zone}|${o.op}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => Number(!!a.located) - Number(!!b.located));
}

/** Does `d` answer the declared step `o` (zone and operation; a watch counts
 *  as a read)? A plan step is answered by the code, a recorded run, a ratified
 *  claim, or the project's topology declaring it (a feed). */
function answersOp(d: BoxOp, o: BoxOp): boolean {
  const known = d.source === "derived" || d.source === "observed" || d.source === "inferred" || !!d.feed;
  return known && d.zone === o.zone && (d.op === o.op || (o.op === "read" && d.op === "watch"));
}

/** One zone's facts as the line the prompt prints: partition keys in words. */
export function zoneLine(z: ZoneFacts, data: BriefData, labels: Map<string, string>): string {
  const name = (b: string) => labels.get(b) ?? b;
  const who = (op: DataOp) => {
    const list = data.ops.filter((o) => o.zone === z.id && o.op === op && !o.verify);
    const derived = new Set(list.filter((o) => o.source === "derived").map((o) => o.box));
    const said = [...derived].map(name);
    // a declared operation the code does not show is said once, and as such
    for (const o of list.filter((x) => x.source === "observed" && !derived.has(x.box))) said.push(`${name(o.box)} (observed in a recorded run, not seen in the code)`);
    for (const o of list.filter((x) => x.source === "inferred" && !derived.has(x.box))) said.push(`${name(o.box)} (inferred · ratified, ${o.cite})`);
    const inferred = new Set(list.filter((x) => x.source === "inferred").map((x) => x.box));
    const declared = new Map<string, boolean>();
    for (const o of list.filter((x) => x.source === "declared" && !derived.has(x.box) && !inferred.has(x.box))) declared.set(o.box, (declared.get(o.box) ?? false) || !!o.feed);
    for (const [b, feed] of declared) said.push(`${name(b)} (declared by ${feed ? "the project's topology" : "the plan"}, not seen in the code)`);
    return said.length ? `${op}s by ${said.join(", ")}` : "";
  };
  const tested = [...new Set(data.ops.filter((o) => o.zone === z.id && (o.verify || o.op === "attempt")).map((o) => `${name(o.box)} ${o.op === "attempt" ? "attempts" : o.op}`))];
  const part = z.holes.length ? `PARTITIONED: one partition per ${z.holes.join(" and ")} — a claim about this zone names whose partition (partition: [${z.holes.map((h) => `"${h}"`).join(", ")}])` : "one zone";
  return [`holds ${z.holds.join(", ")}`, part, z.grantedWrite.length ? `write granted to ${z.grantedWrite.join(", ")}` : "", who("write"), who("watch"), who("read"), tested.length ? `tested by ${tested.join(", ")} [verify]` : ""].filter(Boolean).join("; ");
}
