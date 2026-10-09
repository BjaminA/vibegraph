// THE BRIEF'S CHECKS (2026-10-08, the Brief review's B8–B12). Zero tokens.
// One place each rule lives: drafting (brief_validate.ts) REFUSES a line an
// error names; the review sheet (brief_review.ts) shows the same errors and
// warnings on any brief, including one ratified before these checks existed.
//
//   B8   a METHOD line cites where its mechanism is applied ([enforce]) or runs
//        ([use]); one resting only on tests, declarations or docs is refused —
//        a test shows a mechanism works, it is never the mechanism
//   B9   a data claim ("X writes Z") is checked against who the code and the
//        plan show writing, reading and watching each zone, and how the zone is
//        partitioned; contradicted refuses the line, unverifiable fades it
//   B10  a line about a process states its PRIMARY operation, never a secondary
//        one as its main job; every process's primary is stated or omitted
//   B11  an absolute word (only, never, no, none, nothing, without, all,
//        every, always) needs a stated rule that says it, or a `not` claim the
//        map can check
//   B12  every rule a person stated, and every salient mechanism, is covered
//        by a line or named in `omitted`; every note is answered

import type { BriefFacts } from "./brief_facts.ts";
import { openGaps, type BoxOp, type DataOp } from "./brief_data.ts";
import type { BriefBody, BriefClaim, BriefLine, BriefPart, ClaimVerb, EvidenceRole } from "../shared/brief_types.ts";
import { familyMatches } from "./call_args.ts";
import { covers } from "./data_topology.ts";

const OP_VERB: Record<DataOp, string> = { write: "writes", read: "reads", watch: "watches", attempt: "attempts" };
const VERB_OPS: Record<ClaimVerb, DataOp[]> ={ writes: ["write"], creates: ["write"], owns: ["write"], watches: ["watch"], reads: ["read", "watch"] };
export const ABSOLUTE_WORDS = ["only", "never", "no", "none", "nothing", "without", "all", "every", "always"];
/** method words that claim a mechanism holds: they want [enforce] evidence */
const MECHANISM_WORDS = new Set(["enforces", "partitions", "certifies", "validates", "isolates"]);
const DATA_VERBS = /\b(writes?|reads?|watch(es)?|owns?|belongs? to|reacts? to|creates?)\b/i;

const short = (z: string) => z.replace(/^zone:/, "");

/** The zones a claim's object names: a zone id, a zone's short name, or a family it holds. */
export function zonesOf(object: string, facts: Pick<BriefFacts, "data">): string[] {
  const zones = [...facts.data.zones.values()];
  if (object === "*") return zones.map((z) => z.id);
  if (facts.data.zones.has(object)) return [object];
  return zones.filter((z) => z.label === object || z.id.endsWith(`/${object}`) || z.holds.some((h) => h === object || familyMatches(h, object) || covers(h, object) || covers(object, h))).map((z) => z.id);
}

const opsBy = (facts: Pick<BriefFacts, "data">, box: string, zones: string[], ops: DataOp[]) =>
  facts.data.ops.filter((o) => o.box === box && zones.includes(o.zone) && ops.includes(o.op));

/** What the facts say about one claim. */
export function checkClaim(c: BriefClaim, facts: Pick<BriefFacts, "data" | "boxes" | "labels">): BriefClaim {
  const say = (verdict: NonNullable<BriefClaim["verdict"]>, why: string): BriefClaim => ({ ...c, verdict, why });
  const name = (b: string) => facts.labels.get(b) ?? b;
  if (!facts.boxes.has(c.subject)) return say("unverifiable", `${c.subject} is not a box on the map`);
  const zones = zonesOf(c.object, facts);
  if (!zones.length) return say("unverifiable", `no zone the facts know holds ${c.object}`);
  const ops = VERB_OPS[c.verb];
  const mine = opsBy(facts, c.subject, zones, ops);
  if (c.not) {
    const hit = mine[0];
    return hit
      ? say("contradicted", `${hit.source === "declared" ? "the plan declares" : "the code shows"} ${name(c.subject)} ${hit.op} ${short(hit.zone)} (${hit.cite})`)
      : say("supported", `no ${c.verb === "reads" ? "read" : ops[0]} by ${name(c.subject)} on ${c.object === "*" ? "any zone" : c.object} in the code or the plan, across every thread it reaches`);
  }
  for (const z of zones) {
    const zf = facts.data.zones.get(z)!;
    if (c.partition?.length && zf.holes.length && c.partition.some((p) => !zf.holes.includes(p))) return say("contradicted", `${short(z)} is partitioned by ${zf.holes.join(" and ")}, not ${c.partition.join(", ")}`);
    if (c.verb === "owns") {
      if (zf.holes.length && !c.partition?.length) return say("contradicted", `${short(z)} is one partition per ${zf.holes.join(" and ")}: it has no single owner — say whose partition (partition: [${zf.holes.map((h) => `"${h}"`).join(", ")}])`);
      // a probe's write is evidence the rule holds, not a second owner; but
      // for a claim of ABSENCE (above) any write counts — writing is writing
      const others = facts.data.ops.filter((o) => o.zone === z && o.op === "write" && o.box !== c.subject && !o.verify);
      if (others.length) return say("contradicted", `${short(z)} is also written by ${[...new Set(others.map((o) => name(o.box)))].join(", ")} (${others[0].cite})`);
    }
  }
  const derived = mine.find((o) => o.source === "derived");
  if (derived) return say("supported", `${derived.cite}`);
  const observed = mine.find((o) => o.source === "observed");
  if (observed) return say("supported", `observed in a recorded run (${observed.cite}) — a run proves the path it took`);
  const inferred = mine.find((o) => o.source === "inferred");
  if (inferred) return say("inferred", `a person ratified ${inferred.cite.replace("claim:", "claim ")}, citing the lines it rests on; the code alone does not show it`);
  const declared = mine.find((o) => o.source === "declared");
  if (declared) return say("declared", `${declared.feed ? "the project's topology" : "the plan"} declares it (${declared.cite}); the code shows no such call — a feed or router the static reading cannot follow`);
  return say("unverifiable", `neither the code nor the plan shows ${name(c.subject)} ${ops[0]} ${zones.map(short).join(" / ")}`);
}

export interface Coverage {
  rules: string[];
  salient: string[];
  /** process box → its primary operations, when no line states them */
  primary: Map<string, BoxOp[]>;
  notes: number[];
  gaps: string[];
  /** the first `explainable` gaps are open facts gaps, in `claim gaps` order */
  explainable: number;
}

const mentioned = (omitted: string[], ...needles: string[]) => omitted.some((o) => needles.some((n) => n && new RegExp(`(^|[^\\w])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w])`, "i").test(o)));

/** What the brief as a whole leaves uncovered (B10, B12, notes) and the facts gaps. */
export function briefCoverage(spec: BriefBody["spec"], facts: BriefFacts, omitted: string[] = []): Coverage {
  const lines = [...spec.function, ...spec.method, ...spec.feature];
  const cited = new Set(lines.flatMap((l) => l.cites));
  const rules = facts.rules.filter((r) => r.human && !cited.has(`rule:${r.id}`) && !mentioned(omitted, r.id, `rule:${r.id}`)).map((r) => r.id);
  const salient = facts.salient.filter((s) => {
    if ([...cited].some((c) => c.startsWith(`${s.file}:`))) return false;
    if ([...cited].some((c) => c.startsWith("rule:") && (facts.code.get(c)?.names ?? []).some((n) => n.endsWith(`(${s.file})`)))) return false;
    return !mentioned(omitted, s.file, s.file.split("/").pop() ?? "");
  }).map((s) => s.file);
  const primary = new Map<string, BoxOp[]>();
  // a zone's name as prose says it ("requests" → "request")
  const stem = (zone: string) => (facts.data.zones.get(zone)?.label ?? short(zone).split("/").pop() ?? "").toLowerCase().replace(/s$/, "");
  for (const p of facts.data.processes) {
    const stated = lines.some((l) => (l.claims ?? []).some((c) => !c.not && c.subject === p.box && c.verdict !== "contradicted"
      && p.primary.some((o) => VERB_OPS[c.verb].includes(o.op) && zonesOf(c.object, facts).includes(o.zone))))
      // a line written without claims: it names the box and the zone of its main job
      || lines.some((l) => !(l.claims ?? []).length && (l.boxes ?? []).includes(p.box) && p.primary.some((o) => { const s = stem(o.zone); return s.length > 2 && l.text.toLowerCase().includes(s); }));
    if (!stated && !mentioned(omitted, p.box, p.label)) primary.set(p.box, p.primary);
  }
  const notes = facts.notes.map((_, i) => i + 1).filter((n) => !cited.has(`note:${n}`) && !mentioned(omitted, `note:${n}`));
  // a step whose process the plan only LOCATES by folder is the weaker gap:
  // listed after the anchored ones, and said as such
  // a gap a ratified claim answers is closed (the claim says it, not the code)
  const open = openGaps(facts.data);
  const gaps = open.map((o) => `${o.cite} says ${facts.labels.get(o.box) ?? o.box} ${OP_VERB[o.op]} ${short(o.zone)}; the code shows no such call (a feed or router the static reading cannot follow)${o.located ? " — the plan places this process by its folder only; anchor it with entryPoints if this is the wrong box" : ""}`);
  for (const s of facts.data.staleFeeds ?? []) gaps.push(`${s.cite} (a feed the project declares for ${s.process}) is STALE: ${s.why} — regenerate the topology, or fix the declaration`);
  for (const a of facts.data.ambiguous) gaps.push(`plan:processes:${a.process} is ambiguous: its folder holds ${a.boxes.length} boxes (${a.boxes.map((b) => facts.labels.get(b) ?? b).join("; ")}), so none is charged its planned steps — anchor it with entryPoints`);
  return { rules, salient, primary, notes, gaps, explainable: open.length };
}

/** One line's errors (drafting refuses it) and warnings (the review shows them). */
/** `structured`: the brief writes data claims (a draft is asked to); a brief
 *  written before claims existed gets one note on the sheet instead of the
 *  same warning on every line. */
export function checkLine(part: BriefPart, line: BriefLine, facts: BriefFacts, opts: { absolutes?: string[]; coverage?: Coverage; structured?: boolean } = {}): { errors: string[]; warnings: string[]; claims: BriefClaim[] } {
  const errors: string[] = [], warnings: string[] = [];
  const claims = (line.claims ?? []).map((c) => checkClaim(c, facts));
  const label = (c: BriefClaim) => `"${facts.labels.get(c.subject) ?? c.subject}${c.not ? " never" : ""} ${c.verb} ${c.object}"`;
  for (const c of claims) {
    if (c.verdict === "contradicted") errors.push(`claim ${label(c)} is contradicted: ${c.why}`);
    else if (c.verdict === "unverifiable") warnings.push(`claim ${label(c)} is unverifiable: ${c.why}`);
    else if (c.verdict === "declared") warnings.push(`claim ${label(c)} rests on the plan only: ${c.why}`);
    else if (c.verdict === "inferred") warnings.push(`claim ${label(c)} rests on a ratified inferred claim: ${c.why}`);
  }
  const roles = new Set<EvidenceRole>(line.cites.map((c) => facts.roles.get(c) ?? "use"));
  if (!line.cites.length) warnings.push("no citation — INFERRED");
  // B8
  if (part === "method" && !roles.has("enforce") && !roles.has("use")) {
    errors.push(`rests only on ${line.cites.length ? [...roles].join(" / ") : "no"} evidence — a method line cites where its mechanism is applied ([enforce]) or runs ([use]); a test shows it works, it is not the mechanism`);
  } else if (line.words.some((w) => MECHANISM_WORDS.has(w)) && !roles.has("enforce") && [...facts.roles.values()].includes("enforce")) {
    warnings.push(roles.has("verify")
      ? `names its mechanism through a test or probe ([verify]) — cite where the rule is applied ([enforce])`
      : `"${line.words.find((w) => MECHANISM_WORDS.has(w))}" with no [enforce] citation — where is the rule applied?`);
  }
  // B11
  const words = [...ABSOLUTE_WORDS, ...(opts.absolutes ?? [])];
  const abs = words.find((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(line.text));
  if (abs) {
    const ruleSays = line.cites.some((c) => c.startsWith("rule:") && facts.rules.some((r) => `rule:${r.id}` === c && r.human && words.some((w) => new RegExp(`\\b${w}\\b`, "i").test(r.text))));
    const absence = claims.some((c) => c.not && c.verdict === "supported");
    if (!ruleSays && !absence) errors.push(`the absolute word "${abs}" needs a stated rule that says it (cite it), or a "not" claim the map can check`);
  }
  // B9 — prose about data with nothing the map can check
  if (opts.structured !== false && !claims.length && DATA_VERBS.test(line.text)) warnings.push("says who writes, reads or watches what with no structured claim — not checked against the map");
  // B10 — a line that names a secondary job as the process's work (the brief
  // as a whole leaving a main job out is on the sheet, once per process)
  const cov = opts.coverage;
  if (cov) {
    for (const box of new Set(claims.filter((c) => !c.not).map((c) => c.subject))) {
      const missing = cov.primary.get(box);
      if (!missing) continue;
      const prim = missing.map((o) => `${o.op} ${short(o.zone)}${o.source === "declared" ? " (declared by the plan)" : ""}`).join(", ");
      warnings.push(`presents a secondary operation of ${facts.labels.get(box) ?? box} as its main job — its primary is ${prim}, stated by no line`);
    }
  }
  return { errors, warnings, claims };
}
