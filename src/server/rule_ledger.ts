// THE RULE-COVERAGE LEDGER (2026-10-22, the root-cause handoff RC5: "selection
// with no accounting"). Every rule-shaped sentence of a tier-one source (a rule
// section of CLAUDE.md or AGENTS.md, rule_sources.ts) leaves with an outcome a
// person can see, instead of disappearing behind a ranking or a cap:
//
//   stated        a ratified rule cites it (cN)
//   proposed      a rule waiting for a person cites it (cN)
//   merged        a stated rule already says it (cM)
//   next-round    the next draft is shown it (inside the round's cap)
//   queued        a later draft is shown it: the round's cap is reached, and
//                 the rest wait in order instead of being dropped
//   out-of-reach  it names nothing VibeGraph parsed, so nothing can check it
//
// The draft's dossier offers the sentences no rule covers yet, in tier order
// (rule_draft.ts), so each round reaches the next ones.

import { findDuplicate, type Constraint } from "./constraint_store.ts";
import type { HarvestReport, RuleCandidate } from "./rule_harvest.ts";

/** The harvest sentences a draft round is shown (rule_draft.ts). */
export const ROUND_SIZE = 25;

export type LedgerOutcome = "stated" | "proposed" | "merged" | "next-round" | "queued" | "out-of-reach";
export interface RuleLedgerEntry { file: string; line: number; quote: string; outcome: LedgerOutcome; rule?: string; why: string; alsoIn?: string[] }
export interface RuleLedger { entries: RuleLedgerEntry[]; counts: Record<LedgerOutcome, number> }

const normQ = (s: string) => s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();

/** The rule that already covers a sentence: one that cites it, or one that says it. */
export function coveringRule(c: Pick<RuleCandidate, "file" | "line" | "quote">, constraints: readonly Constraint[]): { rule: Constraint; how: "cite" | "text" } | null {
  const cited = constraints.find((r) => r.cite?.file === c.file && r.cite?.line === c.line);
  if (cited) return { rule: cited, how: "cite" };
  const same = findDuplicate(constraints as Constraint[], c.quote);
  return same ? { rule: same, how: "text" } : null;
}

/** The sentences a draft round is shown: the ones no rule covers yet, in the harvest's (tier) order. */
export function roundCandidates(h: Pick<HarvestReport, "candidates">, constraints: readonly Constraint[]): RuleCandidate[] {
  return h.candidates.filter((c) => !coveringRule(c, constraints)).slice(0, ROUND_SIZE);
}

export function buildRuleLedger(h: HarvestReport, constraints: readonly Constraint[]): RuleLedger {
  const entries: RuleLedgerEntry[] = [];
  const next = new Set(roundCandidates(h, constraints).map((c) => `${c.file}:${c.line}`));
  const elsewhere = (q: string, file: string, line: number) => h.candidates.filter((x) => x.tier !== 1 && normQ(x.quote) === normQ(q) && !(x.file === file && x.line === line)).map((x) => `${x.file}:${x.line}`);
  for (const c of h.candidates.filter((x) => x.tier === 1)) {
    const base = { file: c.file, line: c.line, quote: c.quote };
    const also = elsewhere(c.quote, c.file, c.line);
    const extra = also.length ? { alsoIn: also } : {};
    const cov = coveringRule(c, constraints);
    if (cov) {
      const id = cov.rule.id;
      if (cov.how === "text") entries.push({ ...base, ...extra, outcome: "merged", rule: id, why: `${id} already says it` });
      else if (cov.rule.source === "human") entries.push({ ...base, ...extra, outcome: "stated", rule: id, why: `ratified as ${id}` });
      else entries.push({ ...base, ...extra, outcome: "proposed", rule: id, why: `proposed as ${id}, waiting for a person` });
    } else if (next.has(`${c.file}:${c.line}`)) entries.push({ ...base, ...extra, outcome: "next-round", why: "shown to the next draft (`constraints draft`)" });
    else entries.push({ ...base, ...extra, outcome: "queued", why: `queued: a draft is shown ${ROUND_SIZE} sentences a round, and a later round reaches it` });
  }
  for (const u of h.unanchored) entries.push({ file: u.file, line: u.line, quote: u.quote, outcome: "out-of-reach", why: "it names no file, folder, function, tool or variable VibeGraph parsed, so nothing can check it; state it by hand if it holds" });
  entries.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const counts = { stated: 0, proposed: 0, merged: 0, "next-round": 0, queued: 0, "out-of-reach": 0 } as Record<LedgerOutcome, number>;
  for (const e of entries) counts[e.outcome] += 1;
  return { entries, counts };
}

const WORDS: Record<LedgerOutcome, string> = { stated: "ratified", proposed: "proposed", merged: "merged", "next-round": "for the next draft", queued: "queued", "out-of-reach": "out of reach" };

/** "5 sentences: 2 ratified, 1 proposed, 1 out of reach, 1 queued" */
export function ledgerSummary(l: RuleLedger): string {
  const parts = (Object.keys(WORDS) as LedgerOutcome[]).filter((k) => l.counts[k]).map((k) => `${l.counts[k]} ${WORDS[k]}`);
  return `${l.entries.length} rule sentence${l.entries.length === 1 ? "" : "s"} in CLAUDE.md / AGENTS.md rule sections${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

export function formatRuleLedger(l: RuleLedger): string {
  const L = [`# Rules the project writes down, and what became of each`, "", `${ledgerSummary(l)}.`, ""];
  for (const e of l.entries) {
    L.push(`- ${e.file}:${e.line}: ${e.why}`, `  "${e.quote.slice(0, 200)}"${e.alsoIn?.length ? ` (also written in ${e.alsoIn.join(", ")})` : ""}`);
  }
  return L.join("\n") + "\n";
}
