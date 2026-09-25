// M-CRYSTAL.3 — `check`: every stated constraint's checkable half, verified
// against the tree from the command line. A verifier, not a gate: the
// server decides who may REJECT from calibration standings; this reports
// everything and lets the person, or the hook that ran it, decide.
//
// THREE verdicts, never two (M-GRAMMAR). `unverifiable` is not a pass: an
// unknown target, a missing guard, a dynamic call that could BE the target
// all say so, with the reason. A checker that silently passes what it
// could not check is worse than the prose it replaces, because it looks
// like proof. Exit 0 = every clause passed; 1 = something is violated;
// 2 = nothing violated but something could not be verified.
//
// The same functions the server's pre-checks call, over the same facts
// builder (src/server/quality/facts.ts builds the grammar's four fields
// exactly as the server does): the three M-GRAMMAR verbs run once over the
// whole project; a Run 1 verb runs per thread the constraint routes to,
// which is the unit those verbs are written against (a loop is a thread's
// loop), and the verdicts are joined — violated on any thread is violated.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { loadEnvelope, gitDelta } from "../quality_check.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { buildQualityFacts } from "../../src/server/quality/facts.ts";
import { newRegistry, isRun1Check, describeRun1Check } from "../../src/server/quality/verbs/index.ts";
import { checkConstraint, describeCheck, isConstraintCheck } from "../../src/server/constraint_grammar.ts";
import { loadConstraints, routeConstraints } from "../../src/server/constraint_store.ts";

const VERDICT_RANK = { violated: 2, unverifiable: 1, pass: 0 };

/** The working tree's changes against HEAD as a run delta — what a hook
 *  after an edit has (nothing is committed yet), and what `co-changes`
 *  needs. `git status --porcelain` with untracked files listed one by one. */
export function workingTreeDelta(cwd) {
  const out = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
  const entries = [];
  for (const line of out.split("\n")) {
    if (line.trim() === "") continue;
    const xy = line.slice(0, 2);
    let file = line.slice(3);
    if (file.includes(" -> ")) file = file.split(" -> ").pop();
    if (file.startsWith('"') && file.endsWith('"')) file = file.slice(1, -1);
    const change = xy === "??" || xy.includes("A") ? "added" : xy.includes("D") ? "removed" : "changed";
    entries.push({ packetId: "working-tree", file, nodeId: null, change });
  }
  return { entries, complete: true };
}

function joinVerdicts(per) {
  const worst = per.reduce((w, p) => (VERDICT_RANK[p.verdict] > VERDICT_RANK[w] ? p.verdict : w), "pass");
  const lead = per.find((p) => p.verdict === worst);
  const offenders = [...new Set(per.flatMap((p) => p.offenders ?? []))].sort();
  const notFollowed = [...new Set(per.flatMap((p) => p.notFollowed ?? []))];
  const n = per.filter((p) => p.verdict === worst).length;
  const reason = per.length > 1 ? `${lead.reason} (${worst} on ${n} of ${per.length} routed thread${per.length === 1 ? "" : "s"})` : lead.reason;
  return { verdict: worst, reason, offenders, notFollowed };
}

/**
 * @returns {{ root, commit, constraints, unchecked: string[], results: Array, summary, exitCode, parseErrors }}
 *   `results` has one row per (constraint, clause): id / rule / described /
 *   verdict / reason / offenders (`file:node`) / notFollowed / threads.
 */
export function runConstraintChecks({ root, envelope: envelopePath, pipeline, git, uncommitted, commit }) {
  const { absRoot, envelope: env, parseErrors } = loadEnvelope(root, envelopePath, pipeline ?? {});
  const constraints = existsSync(join(absRoot, ".vibegraph", "constraints.json")) ? loadConstraints(absRoot) : [];
  const stack = buildStackIndex(env, absRoot);
  const registry = newRegistry();
  let runDelta = null;
  let deltaNote = null;
  if (uncommitted) {
    try { runDelta = workingTreeDelta(absRoot); deltaNote = `delta: the working tree's ${runDelta.entries.length} uncommitted change(s) against HEAD`; }
    catch { deltaNote = "delta: --uncommitted asked for the working tree's changes, but this is not a git repository, so co-changes cannot be verified"; }
  } else if (git) {
    runDelta = gitDelta(git, absRoot);
    deltaNote = `delta: ${runDelta.entries.length} file change(s) in ${git}`;
  }
  const base = { envelope: env, root: absRoot, commit, stack, runDelta };
  const projectFacts = buildQualityFacts(base);
  const threadFacts = new Map();
  const factsFor = (ep) => {
    if (!threadFacts.has(ep)) threadFacts.set(ep, buildQualityFacts({ ...base, entryPointId: ep }));
    return threadFacts.get(ep);
  };
  const threads = env.threads.filter((t) => t.entryPointId).map((t) => ({
    entryPointId: t.entryPointId,
    filesReached: t.filesReached ?? [t.seed.file],
    stack: stack.byThread[t.entryPointId] ?? [],
  }));

  const clausesOf = (c) => [...(c.checks ?? []), ...(c.check ? [c.check] : [])];
  const results = [];
  const unchecked = [];
  for (const c of constraints) {
    const clauses = clausesOf(c);
    if (!clauses.length) { unchecked.push(c.id); continue; }
    const routed = threads.filter((t) => routeConstraints([c], t).length > 0).map((t) => t.entryPointId);
    for (const clause of clauses) {
      const row = { id: c.id, kind: c.kind, source: c.source, rule: clause?.rule ?? "?", threads: [] };
      if (isConstraintCheck(clause)) {
        const r = checkConstraint(projectFacts, clause);
        results.push({ ...row, described: describeCheck(clause), verdict: r.verdict, reason: r.reason, offenders: [...r.offenders], notFollowed: [] });
      } else if (isRun1Check(clause)) {
        const eps = routed.length ? routed : [null];
        const per = eps.map((ep) => {
          const r = registry.run(ep ? factsFor(ep) : projectFacts, clause);
          return { entryPointId: ep, verdict: r.verdict, reason: r.reason, offenders: [...(r.offenders ?? [])], notFollowed: [...(r.notFollowed ?? [])] };
        });
        results.push({ ...row, described: describeRun1Check(clause), ...joinVerdicts(per), threads: per });
      } else {
        results.push({ ...row, described: "malformed check", verdict: "unverifiable", reason: "the check's shape matches no verb; refused at the boundary, never coerced", offenders: [], notFollowed: [] });
      }
    }
  }
  const summary = { checked: results.length, violated: 0, unverifiable: 0, pass: 0 };
  for (const r of results) summary[r.verdict] += 1;
  const exitCode = summary.violated ? 1 : summary.unverifiable ? 2 : 0;
  return { root: absRoot, commit, constraints: constraints.length, unchecked, results, summary, exitCode, parseErrors, deltaNote };
}

export function formatCheckReport(r) {
  const lines = [];
  if (!r.constraints) {
    lines.push("no stated constraints in .vibegraph/constraints.json — nothing to check (a constraint states a rule the code cannot reveal; its checkable half is what this verifies)");
    return lines.join("\n") + "\n";
  }
  for (const row of r.results) {
    lines.push(`[${row.id}] ${row.rule} — ${row.described} → ${row.verdict === "pass" ? "pass" : row.verdict.toUpperCase()}`);
    for (const o of row.offenders) lines.push(`     offender: ${o}`);
    lines.push(`     ${row.reason}`);
    if (row.verdict === "pass" && row.notFollowed.length) lines.push(`     not followed: ${row.notFollowed.join("; ")}`);
    if (row.verdict === "unverifiable") lines.push("     (unverifiable is NOT a pass: the code did not let the checker decide)");
  }
  if (r.deltaNote) lines.push(r.deltaNote);
  if (r.unchecked.length) lines.push(`${r.unchecked.length} constraint${r.unchecked.length === 1 ? " has" : "s have"} no checkable half (prose only, a reader's job): ${r.unchecked.join(", ")}`);
  if (Object.keys(r.parseErrors ?? {}).length) lines.push(`parse errors — those files carry no IR and were not checked: ${Object.keys(r.parseErrors).join(", ")}`);
  lines.push(`${r.summary.checked} checked: ${r.summary.violated} violated, ${r.summary.unverifiable} unverifiable, ${r.summary.pass} pass → exit ${r.exitCode}`);
  return lines.join("\n") + "\n";
}
