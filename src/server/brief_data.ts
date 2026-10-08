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
export interface BoxOp { box: string; zone: string; op: DataOp; source: "derived" | "declared"; count: number; cite: string; verify?: boolean }

/** An edge made only by tests, probes or refused attempts. */
export const verifyEdge = (e: { protocol?: string; from: string; refs?: Array<{ file?: string }> }, verifyBoxes: Set<string>): boolean =>
  e.protocol === "attempt" || verifyBoxes.has(e.from) || (!!e.refs?.length && e.refs.every((r) => !!r.file && isVerifyFile(r.file)));
export interface ZoneFacts { id: string; label: string; store: string; holds: string[]; holes: string[]; grantedWrite: string[] }
export interface ProcessFacts { box: string; label: string; primary: BoxOp[]; secondary: BoxOp[]; why: string }
export interface BriefData { ops: BoxOp[]; zones: Map<string, ZoneFacts>; processes: ProcessFacts[]; verifyBoxes: Set<string> }

/** A file that tests, probes or demonstrates rather than runs the system. */
const VERIFY_NAME = /(^|[-_.])(probe|smoke|live-?check|check|e2e|spec|fixture|example|demo)s?([-_.]|$)/i;
export const isVerifyFile = (file: string): boolean => isTestFile(file) || VERIFY_NAME.test(file.split("/").pop() ?? "");

const fileOf = (ep: string) => ep.split(":")[0];
const holesOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/** The map boxes a planned process runs as: a box any of whose entry points
 *  sits under the process's `at`, or is one of its named entry points. */
export function planProcessBoxes(plan: Plan | null | undefined, model: ArchModelRecord): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const pr of plan?.processes ?? []) {
    if (pr.status === "dropped") continue;
    const at = pr.at ? pr.at.replace(/^\.\//, "") : null;
    const named = new Set((pr.entryPoints ?? []).map(fileOf));
    const boxes = model.nodes.filter((n) => n.kind === "cluster" && (n.entryPoints ?? []).some((ep) => {
      const f = fileOf(ep);
      return named.has(f) || named.has(ep) || (at ? (at.endsWith("/") ? f.startsWith(at) : f === at || f.startsWith(`${at}/`)) : false);
    })).map((n) => n.id);
    if (boxes.length) out.set(pr.id, boxes);
  }
  return out;
}

export function briefData(model: ArchModelRecord, opts: { plan?: Plan | null; topology?: Topology | null } = {}): BriefData {
  const verifyBoxes = new Set(model.nodes.filter((n) => n.kind === "cluster" && (n.entryPoints ?? []).length > 0 && (n.entryPoints ?? []).every((ep) => isVerifyFile(fileOf(ep)))).map((n) => n.id));
  const ops: BoxOp[] = [];
  for (const e of model.edges) {
    if (!e.to.startsWith("zone:") || !OPS.includes(e.protocol as DataOp)) continue;
    const verify = verifyEdge(e, verifyBoxes);
    ops.push({ box: e.from, zone: e.to, op: e.protocol as DataOp, source: "derived", count: e.count ?? 1, cite: e.id, ...(verify ? { verify } : {}) });
  }
  const byProcess = planProcessBoxes(opts.plan, model);
  for (const f of opts.plan?.flows ?? []) {
    if (f.status === "dropped") continue;
    for (const st of f.steps) {
      for (const box of byProcess.get(st.process) ?? []) {
        const zone = `zone:${st.zone}`;
        if (!ops.some((o) => o.box === box && o.zone === zone && o.op === st.op && o.source === "declared")) ops.push({ box, zone, op: st.op, source: "declared", count: 1, cite: `plan:flows:${f.id}` });
      }
    }
  }
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
    if (s?.size) {
      const keys = [...s].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
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
  return { ops, zones, processes, verifyBoxes };
}

/** One zone's facts as the line the prompt prints: partition keys in words. */
export function zoneLine(z: ZoneFacts, data: BriefData, labels: Map<string, string>): string {
  const name = (b: string) => labels.get(b) ?? b;
  const who = (op: DataOp) => {
    const list = data.ops.filter((o) => o.zone === z.id && o.op === op && !o.verify);
    const derived = new Set(list.filter((o) => o.source === "derived").map((o) => o.box));
    const said = [...derived].map(name);
    // a declared operation the code does not show is said once, and as such
    for (const b of new Set(list.filter((o) => o.source === "declared" && !derived.has(o.box)).map((o) => o.box))) said.push(`${name(b)} (declared by the plan, not seen in the code)`);
    return said.length ? `${op}s by ${said.join(", ")}` : "";
  };
  const tested = [...new Set(data.ops.filter((o) => o.zone === z.id && (o.verify || o.op === "attempt")).map((o) => `${name(o.box)} ${o.op === "attempt" ? "attempts" : o.op}`))];
  const part = z.holes.length ? `PARTITIONED: one partition per ${z.holes.join(" and ")} — a claim about this zone names whose partition (partition: [${z.holes.map((h) => `"${h}"`).join(", ")}])` : "one zone";
  return [`holds ${z.holds.join(", ")}`, part, z.grantedWrite.length ? `write granted to ${z.grantedWrite.join(", ")}` : "", who("write"), who("watch"), who("read"), tested.length ? `tested by ${tested.join(", ")} [verify]` : ""].filter(Boolean).join("; ");
}
