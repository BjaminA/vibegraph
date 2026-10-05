// The Rules panel's server side (2026-10-05, GUI brief M5). `rules-get` →
// every stated rule with its LIVE verdict (src/server/constraint_report.ts,
// the function `vibegraph-knowledge check` prints from), the threads it
// routes to, and how many reviews wait for a person. `rules-op` → the
// person steps the CLI already has, through the same functions:
//   accept / reject  a proposal      (constraint accept|reject <id> <pN>)
//   ratify           an agent's rule (constraints ratify <id>)
//   remove           a rule          (constraints remove <id>)
// The viewer is the person's own machine, so these are person steps; the
// history names the person (src/server/person.ts). An agent never reaches
// them: MCP has no tool for them, and the CLI refuses them from Claude Code.

import * as fs from "node:fs";
import * as path from "node:path";
import { loadConstraints, removeConstraintAndDemote, type Constraint } from "./constraint_store.ts";
import { decideConstraintProposal, ratifyConstraint } from "./constraint_edit.ts";
import { checkStatedRules, ruleVerdict, type RuleCheckRow, type RuleVerdict } from "./constraint_report.ts";

export interface RuleRow {
  constraint: Constraint;
  /** the worst verdict over its clauses; null when it has no checkable half */
  verdict: RuleVerdict | null;
  checks: RuleCheckRow[];
  /** the threads (entry point ids) it routes to */
  threads: string[];
  /** a person's step waits on it: agent-stated, or proposals open */
  awaiting: boolean;
}

export interface RulesReply {
  rules: RuleRow[];
  pending: number;
  summary: { checked: number; violated: number; unverifiable: number; pass: number };
  person: string;
  error?: string;
  message?: string;
}

const ID = /^[A-Za-z0-9_.-]{1,64}$/;

/** Reviews waiting for a person: each agent- or orchestrator-stated rule, and each open proposal. */
export function pendingReviews(list: readonly Constraint[]): number {
  return list.reduce((n, c) => n + (c.source === "human" ? 0 : 1) + (c.proposals?.length ?? 0), 0);
}

let memo: { stack: unknown; threads: unknown; text: string; value: Omit<RulesReply, "person"> } | null = null;

/** The live state. Checks cost one facts build per routed thread, so the
 *  result is kept until the stack index, the threads or the rules file change. */
export function rulesState(root: string, env: { files: Record<string, unknown>; threads: any[]; entryPoints?: unknown[] }, stack: unknown, person: string): RulesReply {
  let text = "";
  try { text = fs.readFileSync(path.join(root, ".vibegraph", "constraints.json"), "utf-8"); } catch { /* none stated */ }
  if (memo && memo.stack === stack && memo.threads === env.threads && memo.text === text) return { ...memo.value, person };
  const list = text ? loadConstraints(root) : [];
  const report = checkStatedRules({ envelope: env, root, constraints: list, stack });
  const rules = list.map((c): RuleRow => {
    const checks = report.results.filter((r) => r.id === c.id);
    return { constraint: c, verdict: ruleVerdict(checks), checks, threads: report.routed[c.id] ?? [], awaiting: c.source !== "human" || !!c.proposals?.length };
  });
  const value = { rules, pending: pendingReviews(list), summary: report.summary };
  memo = { stack, threads: env.threads, text, value };
  return { ...value, person };
}

/** A person's step from the panel. Returns what to say, and whether the file changed. */
export function handleRulesOp(root: string, msg: unknown, who: string): { changed: boolean; error?: string; message?: string } {
  const p = (msg as { payload?: Record<string, unknown> })?.payload ?? {};
  const op = p.op, id = p.id, pid = p.pid;
  if (typeof id !== "string" || !ID.test(id)) return { changed: false, error: "a rule id is required" };
  if (op === "accept" || op === "reject") {
    if (typeof pid !== "string" || !ID.test(pid)) return { changed: false, error: "a proposal id is required" };
    const r = decideConstraintProposal(root, id, pid, op === "accept", { who });
    return r.error ? { changed: false, error: r.error } : { changed: true, message: op === "accept" ? `accepted ${pid}: ${id} changed` : `rejected ${pid}; ${id} unchanged` };
  }
  if (op === "ratify") {
    const r = ratifyConstraint(root, id, { who });
    return r.error ? { changed: false, error: r.error } : { changed: true, message: `${id} is now human-stated (was ${r.was}-stated)` };
  }
  if (op === "remove") {
    const r = removeConstraintAndDemote(root, id);
    if (!r.removed) return { changed: false, error: `no constraint ${id}` };
    return { changed: true, message: `removed ${id}${r.demoted.length ? ` — the plan's ${r.demoted.join(", ")} became planned rules again` : ""}` };
  }
  return { changed: false, error: `unknown rules op ${String(op)} — accept, reject, ratify or remove` };
}
