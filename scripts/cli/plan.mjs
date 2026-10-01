// `plan …` (2026-09-30): the hypothetical project — a planned architecture,
// primary threads, stack, data boundaries and rules, kept in
// .vibegraph/plan.json apart from the real layer (src/server/plan_*.ts).
// Zero tokens. Whoever runs this command is a PERSON: items they add may be
// agreed, and only this command (or the Plan panel) agrees or promotes. An
// agent proposes through MCP (vibegraph_plan_edit), or here with `--as agent`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "./pipeline.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { loadPlan, savePlan, demoteOrphanedPromotions } from "../../src/server/plan_store.ts";
import { loadConstraints } from "../../src/server/constraint_store.ts";
import { applyPlanOps, parsePlanOp } from "../../src/server/plan_ops.ts";
import { formatPlanMd } from "../../src/server/plan_render.ts";
import { reconcilePlan } from "../../src/server/plan_reconcile.ts";
import { promotePolicy } from "../../src/server/plan_promote.ts";
import { PLAN_SECTIONS } from "../../src/shared/plan_types.ts";
import { isAgentRun } from "./actor.mjs";

export const PLAN_USAGE = `plan init "<objective>" | show | check | edit '<op>' | agree|drop <section> <id> | promote <rule id> | close|reopen
                                  [--root <dir>] [--json] [--as agent]   the HYPOTHETICAL project (.vibegraph/plan.json): objective,
                                  processes, stack, data boundaries, primary threads, planned rules, open questions; zero tokens
                                  (except \`plan draft --from <docs>\`, which SPENDS TOKENS: items drafted from documents, each quoted).
                                  \`check\` compares it with the code (realised / drifted / not built); planned rules are advice
                                  until \`promote\` copies one into constraints.json`;

const HELP = `usage: vibegraph-knowledge ${PLAN_USAGE}

  init "<objective>"          start a plan (one line: what it is for)
  draft --from <url|file> …   SPENDS TOKENS: a model drafts items from the documents and every ratified software
                              spec; a quote not in them drops the item; all land proposed (--dry-run, --reply)
  show [--json]               the plan, objective first
  check [--json]              the plan against the code: each item realised / drifted / not built
  edit '<op>' | --file <f>    apply one op (JSON) or a JSON array of them; sections: ${PLAN_SECTIONS.join(", ")}
                                {"op":"add","section":"threads","item":{"id":"POST /readings","entry":"route","serves":"…","primary":["validate","b1:insert"]}}
                                {"op":"update","section":"processes","id":"api","fields":{"at":"api/"}}
                                {"op":"update","section":"threads","id":"provision-tenant","fields":{"entryPoint":"bin/provision.ts"}}
                                {"op":"rename","section":"threads","from":"old id","to":"new id"}   (references follow)
                                {"op":"set-objective","text":"…"}
  agree <section> <id>        a person agrees to a proposed item
  drop <section> <id>         drop an item (kept for the record); drop an open question to close it
  promote <rule id>           copy a planned rule into .vibegraph/constraints.json (human-stated), where it is checked and may gate
  close | reopen              stop / resume sending the plan to hooked sessions
  --as agent                  record the edit as a model's proposal (what MCP does)`;

export function runPlan(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { root: { type: "string" }, json: { type: "boolean" }, file: { type: "string" }, as: { type: "string" } } });
  } catch (e) { return { exitCode: 2, text: `${e.message}\n\n${HELP}\n` }; }
  const [sub, ...rest] = parsed.positionals;
  const root = resolve(parsed.values.root ?? ".");
  // Claude Code running this is a model, whatever it asks for (actor.mjs).
  const by = parsed.values.as === "agent" || isAgentRun() ? "agent" : "human";
  const done = (text, exitCode = 0) => ({ exitCode, text: text.endsWith("\n") ? text : `${text}\n` });
  const apply = (ops) => {
    const r = applyPlanOps(loadPlan(root), ops, by);
    if (r.error) return done(`refused: ${r.error}`, 1);
    const saved = savePlan(root, r.plan);
    if (saved.error) return done(`refused: ${saved.error}`, 1);
    return done(`plan rev ${r.plan.revision}: ${r.changes.join("; ")}${by === "agent" ? " (as a proposal)" : ""}`);
  };

  if (!sub || sub === "help" || sub === "--help") return done(HELP, sub ? 0 : 2);
  if (sub === "init") {
    if (!rest[0]) return done("plan init needs the objective, in one line", 2);
    if (loadPlan(root)) return done("a plan already exists — `plan show`, or change its objective with set-objective", 1);
    return apply([{ op: "set-objective", text: rest[0] }]);
  }
  // A rule promoted into a constraint that has since gone is demoted first.
  const demoted = demoteOrphanedPromotions(root, new Set(loadConstraints(root).map((c) => c.id)));
  const plan = loadPlan(root);
  if (!plan) return done("no plan yet — start one: vibegraph-knowledge plan init \"<objective>\"", 1);
  if (demoted.length) process.stderr.write(`note: ${demoted.join(", ")} had been promoted into constraint(s) that no longer exist — planned rules again (agreed)
`);
  if (sub === "show") return done(parsed.values.json ? JSON.stringify(plan, null, 2) : formatPlanMd(plan));
  if (sub === "check") {
    const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
    const rec = reconcilePlan(plan, envelope, buildStackIndex(envelope, root), root);
    return done(parsed.values.json ? JSON.stringify(rec, null, 2) : formatPlanMd(plan, rec));
  }
  if (sub === "edit") {
    let raw;
    try { raw = JSON.parse(parsed.values.file ? readFileSync(parsed.values.file, "utf-8") : rest[0] ?? ""); }
    catch (e) { return done(`edit needs an op as JSON (or --file): ${e.message}`, 2); }
    const ops = [];
    for (const x of Array.isArray(raw) ? raw : [raw]) {
      const p = parsePlanOp(x);
      if (!p.ok) return done(`refused: ${p.error}`, 2);
      ops.push(p.op);
    }
    return apply(ops);
  }
  if (sub === "agree" || sub === "drop") {
    const [section, id] = rest;
    if (!PLAN_SECTIONS.includes(section) || !id) return done(`${sub} needs a section (${PLAN_SECTIONS.join("|")}) and an id`, 2);
    return apply([{ op: sub, section, id }]);
  }
  if (sub === "close" || sub === "reopen") return apply([{ op: sub }]);
  if (sub === "promote") {
    if (by === "agent") return done("refused: only a person promotes a planned rule into constraints.json", 1);
    const r = promotePolicy(root, plan, rest[0]);
    return r.error ? done(`refused: ${r.error}`, 1) : done(r.message);
  }
  return done(`unknown plan subcommand: ${sub}\n\n${HELP}`, 2);
}
