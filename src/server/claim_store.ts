// CLAIMS — rung 3 of the run-time ladder, in session (2026-10-08). When the
// map cannot see what the code decides at run time (a facts gap), the Claude
// already working on that code can say what it found, citing the lines — and
// a PERSON decides. Zero tokens: no model is called to make a claim, the one
// in the session proposes it while doing its task.
//
//   propose   anyone (an agent too): checked the way a Brief claim is — the
//             subject is a box, the object a zone or declared family, every
//             cited line exists in a file the subject's threads reach, and the
//             map must not contradict it — then stored PROPOSED · inferred with
//             a hash of each cited line (and its neighbours)
//   agree     a person only (the CLI refuses it under Claude Code, the inbox
//   reject    is a person's): a ratified claim joins the map as inferred ·
//             ratified; a rejected one is kept, so it is not proposed again
//   STALE     a cited line changed since: said, never silently trusted
//   confirmed a later derived (rung 1) or observed (rung 4) operation says the
//             same thing: the claim is marked confirmed
//
// `.vibegraph/claims.json`.

import * as fs from "fs";
import * as path from "path";
import type { ArchModelRecord } from "../shared/protocol.ts";
import { CLAIM_VERBS, type ClaimVerb } from "../shared/brief_types.ts";
import type { BriefFacts } from "./brief_facts.ts";
import { hash16 } from "./brief_facts.ts";
import { checkClaim, zonesOf } from "./brief_checks.ts";
import { modelSource } from "./model_source.ts";

export const CLAIMS_FILE = path.join(".vibegraph", "claims.json");

export interface StoredClaim {
  id: string;
  subject: string;
  verb: ClaimVerb;
  object: string;
  partition?: string[];
  not?: boolean;
  cites: string[];
  /** cited line → hash of it and its neighbours; and the line as it was */
  hashes: Record<string, string>;
  basis: Record<string, string>;
  why?: string;
  by: "agent" | "person";
  at: string;
  status: "proposed" | "ratified" | "rejected";
  decided?: { at: string; by: string };
  /** what the map said when it was proposed */
  verdict?: string;
}
export interface ClaimRecord { version: "1"; claims: StoredClaim[] }

export function loadClaims(root: string): ClaimRecord {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, CLAIMS_FILE), "utf-8"));
    if (raw?.version === "1" && Array.isArray(raw.claims)) return raw as ClaimRecord;
  } catch { /* none yet */ }
  return { version: "1", claims: [] };
}

function saveClaims(root: string, rec: ClaimRecord): void {
  const p = path.join(root, CLAIMS_FILE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(rec, null, 2) + "\n", "utf-8");
  fs.renameSync(`${p}.tmp`, p);
}

const windowOf = (lines: string[], line: number) => lines.slice(Math.max(0, line - 2), line + 1).join("\n");

/** The files the subject's threads reach (its own entry files included). */
function filesOfBox(model: ArchModelRecord, box: string): Set<string> | null {
  const node = model.nodes.find((n) => n.id === box);
  const threads = modelSource(model)?.threads;
  if (!node || !threads) return null;
  const eps = new Set([...(node.threads ?? []), ...(node.entryPoints ?? [])]);
  const out = new Set<string>([...eps].map((e) => e.split(":")[0]));
  for (const t of threads) if (t.entryPointId && eps.has(t.entryPointId)) for (const f of t.filesReached ?? []) out.add(f);
  return out;
}

export interface ProposeInput { subject: string; verb: string; object: string; partition?: string[]; not?: boolean; cites: string[]; why?: string; by: "agent" | "person" }

/** Check and store a claim. Refused claims are not stored; the reasons say why. */
export function proposeClaim(root: string, model: ArchModelRecord, facts: BriefFacts, readLines: (f: string) => string[] | null, input: ProposeInput, now: Date = new Date()): { ok: boolean; claim?: StoredClaim; reasons: string[]; note?: string } {
  const reasons: string[] = [];
  const verb = input.verb.trim().toLowerCase() as ClaimVerb;
  if (!CLAIM_VERBS.includes(verb)) reasons.push(`the verb "${input.verb}" is not one of ${CLAIM_VERBS.join(", ")}`);
  let subject = input.subject.trim();
  if (!facts.boxes.has(subject)) {
    const byLabel = [...facts.labels].filter(([, l]) => l.toLowerCase() === subject.toLowerCase()).map(([id]) => id);
    if (byLabel.length === 1) subject = byLabel[0];
    else reasons.push(`${subject} is not a box on the map (use a box id: \`vibegraph-knowledge architecture\` lists them)`);
  }
  const object = input.object.trim();
  if (object !== "*" && !zonesOf(object, facts).length) reasons.push(`${object} names no zone or declared family the facts know`);
  if (!input.cites.length) reasons.push("a claim cites at least one line it rests on (--cite file:line)");
  const reach = facts.boxes.has(subject) ? filesOfBox(model, subject) : null;
  const hashes: Record<string, string> = {}, basis: Record<string, string> = {};
  for (const c of input.cites) {
    const m = /^(.+):(\d+)$/.exec(c.trim());
    if (!m) { reasons.push(`${c} is not file:line`); continue; }
    const lines = readLines(m[1]);
    const n = Number(m[2]);
    if (!lines) { reasons.push(`${m[1]} is not a file in the project`); continue; }
    if (n < 1 || n > lines.length) { reasons.push(`${c} does not exist (${m[1]} has ${lines.length} lines)`); continue; }
    if (reach && !reach.has(m[1])) { reasons.push(`${c} is not on a path the code shows from ${subject} (no thread of it reaches ${m[1]})`); continue; }
    hashes[c] = hash16(windowOf(lines, n));
    basis[c] = lines[n - 1].trim().slice(0, 160);
  }
  const rec = loadClaims(root);
  const same = rec.claims.find((k) => k.subject === subject && k.verb === verb && k.object === object && !!k.not === !!input.not && k.status !== "rejected");
  if (same) reasons.push(`already claimed as ${same.id} (${same.status})`);
  if (!reasons.length) {
    const checked = checkClaim({ subject, verb, object, ...(input.partition?.length ? { partition: input.partition } : {}), ...(input.not ? { not: true } : {}) }, facts);
    if (checked.verdict === "contradicted") reasons.push(`the map contradicts it: ${checked.why}`);
    if (!reasons.length) {
      const id = `k${rec.claims.reduce((mx, k) => Math.max(mx, Number(k.id.slice(1)) || 0), 0) + 1}`;
      const claim: StoredClaim = {
        id, subject, verb, object, ...(input.partition?.length ? { partition: input.partition } : {}), ...(input.not ? { not: true } : {}),
        cites: Object.keys(hashes), hashes, basis, ...(input.why ? { why: input.why.slice(0, 400) } : {}),
        by: input.by, at: now.toISOString(), status: "proposed", verdict: checked.verdict,
      };
      rec.claims.push(claim);
      saveClaims(root, rec);
      const note = checked.verdict === "supported" ? "the code already shows this — stored, marked confirmed" : checked.verdict === "declared" ? "the plan declares it and the code does not show it: this closes a facts gap once a person agrees" : undefined;
      return { ok: true, claim, reasons: [], ...(note ? { note } : {}) };
    }
  }
  return { ok: false, reasons };
}

/** A person's decision on a proposed claim. */
export function decideClaim(root: string, id: string, decision: "agree" | "reject", who: string, now: Date = new Date()): { ok: boolean; detail: string } {
  const rec = loadClaims(root);
  const k = rec.claims.find((x) => x.id === id);
  if (!k) return { ok: false, detail: `no claim ${id}` };
  if (k.status !== "proposed") return { ok: false, detail: `${id} is already ${k.status}` };
  k.status = decision === "agree" ? "ratified" : "rejected";
  k.decided = { at: now.toISOString(), by: who };
  saveClaims(root, rec);
  return { ok: true, detail: `${id} ${k.status}: ${k.subject} ${k.not ? "never " : ""}${k.verb} ${k.object}` };
}

/** Each cited line that changed since the claim was made (STALE), with what it was. */
export function claimChanges(k: StoredClaim, readLines: (f: string) => string[] | null): string[] {
  const out: string[] = [];
  for (const c of k.cites) {
    const m = /^(.+):(\d+)$/.exec(c);
    const lines = m ? readLines(m[1]) : null;
    if (!m || !lines) { out.push(`${c} can no longer be read`); continue; }
    if (hash16(windowOf(lines, Number(m[2]))) !== k.hashes[c]) out.push(`${c} changed (was: "${k.basis[c] ?? ""}")`);
  }
  return out;
}

/** Ratified claims whose cited lines still hold: what the map may show as inferred · ratified. */
export function liveClaims(root: string, readLines: (f: string) => string[] | null): StoredClaim[] {
  return loadClaims(root).claims.filter((k) => k.status === "ratified" && !k.not && !claimChanges(k, readLines).length);
}

/** The map edges ratified claims add where the code shows no such edge:
 *  `evidence: "inferred"`, stated by the person who agreed. */
export function claimEdges(root: string, model: ArchModelRecord, readLines: (f: string) => string[] | null): ArchModelRecord["edges"] {
  const out: ArchModelRecord["edges"] = [];
  const ids = new Set(model.nodes.map((n) => n.id));
  const op = (v: ClaimVerb) => (v === "watches" ? "watch" : v === "reads" ? "read" : "write");
  for (const k of liveClaims(root, readLines)) {
    if (!ids.has(k.subject)) continue;
    const zones = model.nodes.filter((n) => n.zoneOf && (n.id === k.object || n.label === k.object || n.id.endsWith(`/${k.object}`) || n.zoneOf.holds.includes(k.object))).map((n) => n.id);
    for (const z of zones) {
      if (model.edges.some((e) => e.from === k.subject && e.to === z && e.protocol === op(k.verb))) continue;
      out.push({
        id: `${k.subject}->${z}:claim:${k.id}`, from: k.subject, to: z, kind: "uses", protocol: op(k.verb),
        protocolBasis: `inferred · ratified — claim ${k.id}, agreed by ${k.decided?.by ?? "a person"}; it rests on ${k.cites.join(", ")}`,
        count: k.cites.length, threads: [], confidence: "called", source: "stated", evidence: "inferred",
        refs: k.cites.map((c) => ({ file: c.split(":")[0], text: `${c}: ${k.basis[c] ?? ""}` })),
      });
    }
  }
  return out;
}

export const claimLabel =(k: Pick<StoredClaim, "id" | "subject" | "verb" | "object" | "not">, labels?: Map<string, string>) =>
  `${k.id}: ${labels?.get(k.subject) ?? k.subject} ${k.not ? "never " : ""}${k.verb} ${k.object}`;
