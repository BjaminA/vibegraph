// B13 — THE REVIEW SHEET (2026-10-08). Zero tokens. A brief that READS well
// can still describe the core loosely, and a person skimming it cannot tell —
// so before Ratify the card, the CLI and the inbox show what the checks see:
// each line's warnings (and, on a brief written before a check existed, what
// that check would now refuse), each line's citations grouped by role, the
// stated rules and salient mechanisms no line covers, the processes whose main
// job no line states, the notes left unanswered and where the plan declares
// something the code does not show. Ratify then names what it accepts:
// "ratify 15 lines, 2 with warnings".

import type { BriefFacts } from "./brief_facts.ts";
import { briefCoverage, checkLine, type Coverage } from "./brief_checks.ts";
import { EVIDENCE_ROLES, type BriefBody, type BriefClaim, type BriefPart, type EvidenceRole } from "../shared/brief_types.ts";

export interface ReviewLine {
  part: BriefPart;
  index: number;
  text: string;
  warnings: string[];
  claims: BriefClaim[];
  byRole: Partial<Record<EvidenceRole, string[]>>;
}

export interface BriefReview {
  lines: ReviewLine[];
  counts: { lines: number; withWarnings: number; inferred: number; testOnly: number; contradicted: number; unverifiable: number; absolutes: number; proseOnly: number };
  uncovered: { rules: string[]; salient: string[]; primary: string[]; notes: string[] };
  gaps: string[];
  /** the first `explainable` gaps can be explained (`claim explain <n>`, the card's Explain) */
  explainable: number;
  /** "15 lines, 2 with warnings; 1 stated rule not covered" */
  summary: string;
  /** what the Ratify button says */
  ratifyLabel: string;
  /** 2026-10-21 — what the claims were checked against, so a thin map shows:
   *  "checked against 56 store operations on the map: 53 read from the code, 3 declared by the project's topology" */
  basis: string;
}

/** What the data claims were checked against, by where each operation came from. */
export function reviewBasis(facts: Pick<BriefFacts, "data" | "incomplete">): string {
  const ops = facts.data.ops;
  const n = (pred: (o: (typeof ops)[number]) => boolean) => ops.filter(pred).length;
  const parts: Array<[number, string]> = [
    [n((o) => o.source === "derived"), "read from the code"],
    [n((o) => o.source === "observed"), "seen in a recorded run"],
    [n((o) => o.source === "inferred"), "from ratified claims"],
    [n((o) => o.source === "declared" && !!o.feed), "declared by the project's topology"],
    [n((o) => o.source === "declared" && !o.feed), "declared by the plan only"],
  ];
  const said = parts.filter(([k]) => k > 0).map(([k, what]) => `${k} ${what}`);
  const base = `checked against ${ops.length} store operation${ops.length === 1 ? "" : "s"} on the map${said.length ? `: ${said.join(", ")}` : ""}`;
  return facts.incomplete?.length
    ? `${base}. The map is INCOMPLETE (${facts.incomplete.join("; ")}): a claim it cannot see may read as resting on the plan only`
    : base;
}

export function reviewBrief(spec: BriefBody["spec"], facts: BriefFacts, opts: { omitted?: string[]; absolutes?: string[]; /** the draft's scheme: 2+ was asked for claims */ scheme?: number } = {}): BriefReview {
  const coverage: Coverage = briefCoverage(spec, facts, opts.omitted ?? []);
  const lines: ReviewLine[] = [];
  const counts = { lines: 0, withWarnings: 0, inferred: 0, testOnly: 0, contradicted: 0, unverifiable: 0, absolutes: 0, proseOnly: 0 };
  // written before data claims existed: one note, not a warning on every line
  const structured = [...spec.function, ...spec.method, ...spec.feature].some((l) => l.claims?.length);
  for (const part of ["function", "method", "feature"] as BriefPart[]) {
    spec[part].forEach((l, index) => {
      const r = checkLine(part, l, facts, { absolutes: opts.absolutes, coverage, structured });
      // 2026-10-12 — a true, cited line that says who reads or writes in prose
      // only is counted once on the sheet, not a warning on every such line
      const prose = r.warnings.some((w) => w.includes("no structured claim"));
      if (prose) counts.proseOnly++;
      const warnings = [...r.errors.map((e) => `would be refused now: ${e}`), ...r.warnings.filter((w) => !w.includes("no structured claim"))];
      const byRole: ReviewLine["byRole"] = {};
      for (const c of l.cites) (byRole[facts.roles.get(c) ?? "use"] ??= []).push(c);
      counts.lines++;
      if (warnings.length) counts.withWarnings++;
      if (!l.cites.length) counts.inferred++;
      if (r.errors.some((e) => e.startsWith("rests only on"))) counts.testOnly++;
      if (r.claims.some((c) => c.verdict === "contradicted")) counts.contradicted++;
      if (r.claims.some((c) => c.verdict === "unverifiable")) counts.unverifiable++;
      if (r.errors.some((e) => e.startsWith("the absolute word"))) counts.absolutes++;
      lines.push({ part, index, text: l.text, warnings, claims: r.claims, byRole: Object.fromEntries(EVIDENCE_ROLES.filter((k) => byRole[k]).map((k) => [k, byRole[k]!])) });
    });
  }
  const uncovered = {
    rules: coverage.rules,
    salient: coverage.salient,
    primary: [...coverage.primary].map(([box, ops]) => `${facts.labels.get(box) ?? box}: ${ops.map((o) => `${o.op} ${o.zone.replace(/^zone:/, "")}`).join(", ")}`),
    notes: coverage.notes.map((n) => `note:${n} — ${facts.notes[n - 1]}`),
  };
  const bits = [
    `${counts.lines} line${counts.lines === 1 ? "" : "s"}, ${counts.withWarnings} with warnings`,
    // a draft from before claims existed, or a current one whose model stated
    // none (2026-10-20, live run: a minutes-old draft was told it was old)
    !structured && counts.lines ? ((opts.scheme ?? 0) >= 2 ? "no line states a data claim (who reads or writes what): the data in its lines is prose only, not checked against the map" : "its data claims are prose only (written before claims were checked — Brief again to check them)") : "",
    structured && counts.proseOnly ? `${counts.proseOnly} line${counts.proseOnly === 1 ? " says" : "s say"} who reads or writes in prose only — not checked against the map` : "",
    uncovered.rules.length ? `${uncovered.rules.length} stated rule${uncovered.rules.length === 1 ? "" : "s"} not covered` : "",
    uncovered.salient.length ? `${uncovered.salient.length} core mechanism${uncovered.salient.length === 1 ? "" : "s"} not covered` : "",
    uncovered.primary.length ? `${uncovered.primary.length} process${uncovered.primary.length === 1 ? " without its" : "es without their"} main job stated` : "",
    uncovered.notes.length ? `${uncovered.notes.length} note${uncovered.notes.length === 1 ? "" : "s"} unanswered` : "",
  ].filter(Boolean);
  return {
    lines, counts, uncovered, gaps: coverage.gaps, explainable: coverage.explainable, summary: bits.join("; "),
    ratifyLabel: `Ratify ${counts.lines} line${counts.lines === 1 ? "" : "s"}${counts.withWarnings ? `, ${counts.withWarnings} with warnings` : ""}`,
    basis: reviewBasis(facts),
  };
}

/** The sheet as text (the CLI's `show`, the inbox's detail lines). */
export function reviewText(r: BriefReview, max = 40): string[] {
  const out = [`review: ${r.summary}`, ...(r.basis ? [`  ${r.basis}`] : [])];
  for (const l of r.lines) for (const w of l.warnings) out.push(`  ${l.part}[${l.index}] ${w}`);
  for (const id of r.uncovered.rules) out.push(`  stated rule ${id} — no line covers it`);
  for (const f of r.uncovered.salient) out.push(`  core mechanism ${f} — no line covers it`);
  for (const p of r.uncovered.primary) out.push(`  main job not stated — ${p}`);
  for (const n of r.uncovered.notes) out.push(`  unanswered ${n}`);
  for (const g of r.gaps.slice(0, 6)) out.push(`  facts gap: ${g}`);
  return out.slice(0, max);
}
