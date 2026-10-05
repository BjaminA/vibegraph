// Every stated rule's checkable half, evaluated over one envelope (2026-10-05,
// moved out of scripts/cli/check.mjs). ONE function for `vibegraph-knowledge
// check`, the hooks and the GUI's Rules panel, so a verdict on screen is the
// verdict the command prints — the brief's acceptance test 2.
//
// THREE verdicts, never two (M-GRAMMAR): `unverifiable` is not a pass. The
// three M-GRAMMAR verbs run once over the whole project; a Run 1 verb runs
// per thread the rule routes to and the verdicts are joined (violated on any
// thread is violated); a `files`-scoped verb reads the files the rule is
// stated for; a stack policy's own forbid / replace-with is derived.

import { buildStackIndex } from "./stack.ts";
import { buildQualityFacts } from "./quality/facts.ts";
import { newRegistry, isRun1Check, describeRun1Check } from "./quality/verbs/index.ts";
import { checkConstraint, describeCheck, isConstraintCheck } from "./constraint_grammar.ts";
import { routeConstraints, statedScopeFiles, type Constraint } from "./constraint_store.ts";
import { derivedPolicyClauses, checkPolicyClause, describePolicyClause } from "./policy_check.ts";

export type RuleVerdict = "pass" | "violated" | "unverifiable";
const VERDICT_RANK: Record<RuleVerdict, number> = { violated: 2, unverifiable: 1, pass: 0 };

export interface RuleCheckRow {
  id: string; kind: string; source: string; rule: string; described: string;
  verdict: RuleVerdict; reason: string; offenders: string[]; notFollowed: string[];
  /** a Run 1 verb: each routed thread's own verdict */
  threads: Array<{ entryPointId: string | null; verdict: RuleVerdict; reason: string; offenders: string[]; notFollowed: string[] }>;
  gates?: boolean;
}

export interface RuleCheckReport {
  results: RuleCheckRow[];
  /** rules with no checkable half: prose only */
  unchecked: string[];
  summary: { checked: number; violated: number; unverifiable: number; pass: number };
  /** each rule id → the threads it routes to */
  routed: Record<string, string[]>;
}

interface EnvelopeLike { files: Record<string, unknown>; threads: Array<{ entryPointId?: string | null; filesReached?: string[]; seed: { file: string } }> }

function joinVerdicts(per: RuleCheckRow["threads"]): Pick<RuleCheckRow, "verdict" | "reason" | "offenders" | "notFollowed"> {
  const worst = per.reduce<RuleVerdict>((w, p) => (VERDICT_RANK[p.verdict] > VERDICT_RANK[w] ? p.verdict : w), "pass");
  const lead = per.find((p) => p.verdict === worst)!;
  const offenders = [...new Set(per.flatMap((p) => p.offenders ?? []))].sort();
  const notFollowed = [...new Set(per.flatMap((p) => p.notFollowed ?? []))];
  const n = per.filter((p) => p.verdict === worst).length;
  const reason = per.length > 1 ? `${lead.reason} (${worst} on ${n} of ${per.length} routed thread${per.length === 1 ? "" : "s"})` : lead.reason;
  return { verdict: worst, reason, offenders, notFollowed };
}

const offenderText = (o: unknown): string =>
  typeof o === "string" ? o : `${(o as { file?: string }).file ?? ""}:${(o as { node?: string }).node ?? ""}`;

export function checkStatedRules(opts: {
  envelope: EnvelopeLike; root: string; constraints: Constraint[];
  commit?: string; runDelta?: unknown; stack?: unknown;
}): RuleCheckReport {
  const { envelope: env, root, constraints, commit, runDelta } = opts;
  const stack = (opts.stack ?? buildStackIndex(env as never, root)) as { byThread: Record<string, unknown[]> };
  const registry = newRegistry();
  const base = { envelope: env as never, root, commit: commit ?? "working-tree", stack: stack as never, runDelta: (runDelta ?? null) as never };
  const projectFacts = buildQualityFacts(base);
  const threadFacts = new Map<string, ReturnType<typeof buildQualityFacts>>();
  const factsFor = (ep: string) => {
    if (!threadFacts.has(ep)) threadFacts.set(ep, buildQualityFacts({ ...base, entryPointId: ep }));
    return threadFacts.get(ep)!;
  };
  const threads = env.threads.filter((t) => t.entryPointId).map((t) => ({
    entryPointId: t.entryPointId as string,
    filesReached: t.filesReached ?? [t.seed.file],
    stack: (stack.byThread[t.entryPointId as string] ?? []) as never,
  }));

  const clausesOf = (c: Constraint) => [...(c.checks ?? []), ...(c.check ? [c.check] : [])] as unknown[];
  const results: RuleCheckRow[] = [];
  const unchecked: string[] = [];
  const routed: Record<string, string[]> = {};
  for (const c of constraints) {
    routed[c.id] = threads.filter((t) => routeConstraints([c], t as never).length > 0).map((t) => t.entryPointId);
    const clauses = clausesOf(c);
    const policyClauses = derivedPolicyClauses(c as never, env.files as never);
    for (const pc of policyClauses) {
      const r = checkPolicyClause(projectFacts, pc);
      results.push({
        id: c.id, kind: c.kind, source: c.source, rule: "stack-policy", threads: [], described: describePolicyClause(pc),
        verdict: r.verdict, reason: r.reason, offenders: r.offenders.map(offenderText), notFollowed: [],
        // A stated policy is a person's decision, and the work-run stack
        // pre-check already rejects on it — so it gates here too.
        gates: true,
      });
    }
    if (!clauses.length) { if (!policyClauses.length) unchecked.push(c.id); continue; }
    for (const clause of clauses) {
      const row = { id: c.id, kind: c.kind, source: c.source, rule: String((clause as { rule?: string })?.rule ?? "?"), threads: [] as RuleCheckRow["threads"] };
      if (isConstraintCheck(clause)) {
        const r = checkConstraint(projectFacts, clause);
        results.push({ ...row, described: describeCheck(clause), verdict: r.verdict, reason: r.reason, offenders: r.offenders.map(offenderText), notFollowed: [] });
      } else if (isRun1Check(clause) && (clause as { scope?: string }).scope === "files") {
        const scopeFiles = statedScopeFiles(c, Object.keys(env.files));
        const r = registry.run(scopeFiles.length ? buildQualityFacts({ ...base, scopeFiles }) : projectFacts, clause);
        results.push({ ...row, described: describeRun1Check(clause), verdict: r.verdict, reason: r.reason, offenders: (r.offenders ?? []).map(offenderText), notFollowed: [...((r as { notFollowed?: string[] }).notFollowed ?? [])] });
      } else if (isRun1Check(clause)) {
        const eps = routed[c.id].length ? routed[c.id] : [null];
        const per = eps.map((ep) => {
          const r = registry.run(ep ? factsFor(ep) : projectFacts, clause);
          return { entryPointId: ep, verdict: r.verdict as RuleVerdict, reason: r.reason, offenders: (r.offenders ?? []).map(offenderText), notFollowed: [...((r as { notFollowed?: string[] }).notFollowed ?? [])] };
        });
        results.push({ ...row, described: describeRun1Check(clause), ...joinVerdicts(per), threads: per });
      } else {
        results.push({ ...row, described: "malformed check", verdict: "unverifiable", reason: "the check's shape matches no verb; refused at the boundary, never coerced", offenders: [], notFollowed: [] });
      }
    }
  }
  const summary = { checked: results.length, violated: 0, unverifiable: 0, pass: 0 };
  for (const r of results) summary[r.verdict] += 1;
  return { results, unchecked, summary, routed };
}

/** A rule's one verdict over all its clauses: the worst, or null when it has none. */
export function ruleVerdict(rows: readonly RuleCheckRow[]): RuleVerdict | null {
  if (!rows.length) return null;
  return rows.reduce<RuleVerdict>((w, r) => (VERDICT_RANK[r.verdict] > VERDICT_RANK[w] ? r.verdict : w), "pass");
}
