// `constraints draft` (2026-10-19, PLAN-M-RULES M2): rules proposed from the
// architecture — the ONE token-spending step for rules, said so in the usage.
// The dossier and the prompt are src/server/rule_draft.ts, the gate
// src/server/rule_draft_gate.ts; the Rules panel's button calls the same two.
// --dry-run spawns nothing (the dossier's size and what it holds);
// --reply <file> uses a saved model reply instead of spawning; the spawn is
// the classify command's (read-only tools, write tools and Bash denied).
// Survivors are stored AGENT-STATED for a person to ratify, wherever this runs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvelope } from "../quality_check.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { loadConstraints, statedRules } from "../../src/server/constraint_store.ts";
import { checkStatedRules } from "../../src/server/constraint_report.ts";
import { buildRuleDossier, buildRuleDraftPrompt, MAX_DRAFT_RULES, pendingReview, pendingReviewRefusal } from "../../src/server/rule_draft.ts";
import { applyRuleDraft, formatRuleDraftReport, gateRuleDraft } from "../../src/server/rule_draft_gate.ts";
import { claimFactsFromEnvelope } from "../../src/server/rule_claims.ts";
import { spawnClassifier } from "./classify.mjs";
import { cliPath } from "./winpath.mjs";

/** One candidate's check against the code: the `check` loop, for a rule not yet stored. */
export function checkerFor(envelope, root, stack) {
  return (input) => checkStatedRules({ envelope, root, stack, constraints: [{ ...input, id: "draft", source: "agent", createdAt: "" }] }).results
    .map((r) => ({ verdict: r.verdict, reason: r.reason, offenders: r.offenders }));
}

export function gateContext(envelope, root, stack, model) {
  return {
    existing: statedRules(loadConstraints(root)),
    files: new Set(Object.keys(envelope.files)),
    entryPoints: new Set((envelope.entryPoints ?? []).map((e) => e.id)),
    tools: new Set(stack.tools.map((t) => t.tool)),
    checkOne: checkerFor(envelope, root, stack),
    claims: claimFactsFromEnvelope(envelope, stack),
    funnels: stack.tools.filter((t) => t.origin === "project"), stack,
    model,
  };
}

/** @returns {{ lines: string[], messages: string[], exitCode: number }} */
export function runRuleDraft({ root, values, pipeline, env = process.env }) {
  const absRoot = resolve(cliPath(root ?? "."));
  const waiting = pendingReview(absRoot);
  if (waiting >= MAX_DRAFT_RULES && !values.force && !values["dry-run"]) return { lines: [], messages: [`refused: ${pendingReviewRefusal(waiting)} (or pass --force)`], exitCode: 2 };
  const { envelope } = loadEnvelope(absRoot, undefined, pipeline ?? {}, { cache: true });
  const stack = buildStackIndex(envelope, absRoot);
  const dossier = buildRuleDossier(absRoot, envelope, stack);
  const prompt = buildRuleDraftPrompt(dossier);
  const lines = [];
  const counts = Object.entries(dossier.items.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }), {})).map(([k, n]) => `${n} ${k}`).join(", ");
  lines.push(`the model is shown ${dossier.items.length} facts (${counts || "none"}), ${dossier.stated.length} stated rule(s) not to restate, and the scope vocabulary — ~${Math.ceil(prompt.length / 4)} tokens`);
  if (values.prompt) lines.push("--- prompt ---", prompt, "--- end prompt ---");
  if (values["dry-run"]) return { lines: [...lines, "dry run — nothing spawned, nothing written"], messages: [], exitCode: 0 };
  let reply, model;
  if (values.reply) { reply = readFileSync(resolve(values.reply), "utf-8"); model = `saved reply ${values.reply}`; }
  else {
    const r = spawnClassifier({ prompt, model: values.model, cwd: absRoot, env });
    if (!r.ok) return { lines, messages: [r.error], exitCode: 3 };
    reply = r.text; model = r.model;
  }
  const gated = gateRuleDraft(reply, dossier, gateContext(envelope, absRoot, stack, model));
  if (gated.error) return { lines, messages: [gated.error], exitCode: 3 };
  const stored = applyRuleDraft(absRoot, gated);
  lines.push(formatRuleDraftReport(gated, stored).trimEnd());
  return { lines, messages: [], exitCode: 0 };
}
