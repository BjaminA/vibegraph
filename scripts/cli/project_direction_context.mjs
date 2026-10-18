// The project's own direction in the plain-Claude path (2026-10-16;
// src/server/project_direction.ts has the store and the census). Like the
// generic direction (direction.mjs) and under the same hooks mode:
//   headlines     an AGREED rule reaches the session once, with the first
//                 routed thread whose files it is about;
//   after an edit an agreed rule that carries a check is checked AS ADVICE
//                 (never a block): a violation this session did not start
//                 with brings the rule and its why, once per rule;
//   off           nothing.
// And the CLI: `direction project [census | agree <id> | drop <id>] [<root>]`.

import { resolve } from "node:path";
import { loadDirection, saveDirection, census, mergeCensus, decideRule, rulesFor, ruleLine } from "../../src/server/project_direction.ts";
import { checkStatedRules } from "../../src/server/constraint_report.ts";
import { readSkillsConfig } from "../../src/server/generic_skills.ts";
import { buildStackIndex } from "../../src/server/stack.ts";
import { buildCrossingIndex } from "../../src/server/crossings.ts";
import { archModelForEnvelope } from "../../src/server/arch_envelope.ts";
import { loadPlan } from "../../src/server/plan_store.ts";
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "./pipeline.mjs";
import { cliPath } from "./winpath.mjs";

const modeOf = (absRoot) => { try { return readSkillsConfig(absRoot).config.hooks ?? "headlines"; } catch { return "headlines"; } };

/** For one prompt: `(ep) => block | null` — each agreed rule once per session. */
export function projectDirectionForPrompt(absRoot, env, state) {
  if (modeOf(absRoot) !== "headlines") return () => null;
  const d = loadDirection(absRoot);
  if (!d.rules.some((r) => r.status === "agreed")) return () => null;
  // read per call: a thread held back for room restores state.direction to a copy
  const sent = () => ((state.direction ??= { skills: [], rules: [] }).project ??= []);
  return (ep) => {
    const t = (env.threads ?? []).find((x) => x.entryPointId === ep);
    const now = rulesFor(d, t?.filesReached ?? []).filter((r) => !sent().includes(r.id));
    if (!now.length) return null;
    for (const r of now) sent().push(r.id);
    return `## This project's direction (agreed by a person — advice, never a gate; each rule's why: \`vibegraph-knowledge direction project\`)\n${now.map(ruleLine).join("\n")}`;
  };
}

/** The agreed rules with a check, and what each finds violated now. */
function violations(absRoot, loaded) {
  const rules = loadDirection(absRoot).rules.filter((r) => r.status === "agreed" && r.check);
  if (!rules.length) return { rules, keys: [] };
  try {
    const report = checkStatedRules({
      envelope: loaded.envelope, root: absRoot, stack: buildStackIndex(loaded.envelope, absRoot),
      constraints: rules.map((r) => ({ id: r.id, kind: "invariant", text: r.text, scope: { all: true }, source: "human", check: r.check })),
    });
    return { rules, keys: report.results.filter((row) => row.verdict === "violated").flatMap((row) => (row.offenders.length ? row.offenders : ["-"]).map((o) => `${row.id}|${o}`)) };
  } catch { return { rules, keys: [] }; }
}

/** At the session's start (bookkeeping, not context): what was already so. */
export function projectDirectionBaseline(absRoot, loaded, state) {
  if (!state.directionBase && modeOf(absRoot) !== "off") state.directionBase = violations(absRoot, loaded).keys;
}

/** After an edit: the agreed rules with a check, checked as advice. */
export function projectDirectionAfterEdit(absRoot, loaded, state) {
  if (modeOf(absRoot) === "off") return null;
  const { rules, keys } = violations(absRoot, loaded);
  if (!rules.length) return null;
  if (!state.directionBase) { state.directionBase = keys; return null; } // hooks installed mid-session
  const base = new Set(state.directionBase);
  const told = (state.direction ??= { skills: [], rules: [] }).projectWhy ??= [];
  const fresh = keys.filter((k) => !base.has(k));
  const ids = [...new Set(fresh.map((k) => k.split("|")[0]))].filter((id) => !told.includes(id));
  if (!ids.length) return null;
  told.push(...ids);
  const lines = ids.map((id) => {
    const r = rules.find((x) => x.id === id);
    const at = fresh.filter((k) => k.startsWith(`${id}|`)).map((k) => k.slice(id.length + 1)).filter((o) => o !== "-").slice(0, 3);
    return `- ${id}: ${r.text} — why: ${r.why}${at.length ? `\n  now: ${at.join("; ")}` : ""}`;
  });
  return `This edit goes against the project's agreed direction (advice, not a block — a rule that must block is a stated rule):\n${lines.join("\n")}`;
}

export const PROJECT_DIRECTION_USAGE = `direction project [<root>]                the project's own direction: proposed and agreed rules, each with its why
  direction project census [<root>]       zero tokens: read the rules the code already follows (funnels, guarded writes, agreed plan principles) — PROPOSED
  direction project agree|drop <id> [<root>]   a person's step`;

export function runProjectDirection(args) {
  const [sub, b, c] = args;
  const rootOf = (r) => resolve(cliPath(r ?? "."));
  if (sub === "agree" || sub === "drop") {
    const root = rootOf(c);
    const d = loadDirection(root);
    const err = decideRule(d, b ?? "", sub, "human");
    if (err) return { exitCode: 1, text: `${err}\n` };
    saveDirection(root, d);
    return { exitCode: 0, text: `${sub === "agree" ? "agreed" : "dropped"} ${b}\n` };
  }
  if (sub === "census") {
    const root = rootOf(b);
    const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
    const stack = buildStackIndex(envelope, root);
    const model = archModelForEnvelope(envelope, stack, buildCrossingIndex(envelope), root, undefined, { applyStore: false });
    const found = census({ stack, model, files: envelope.files, plan: loadPlan(root) });
    const m = mergeCensus(loadDirection(root), found);
    saveDirection(root, m.direction);
    return { exitCode: 0, text: `${found.length} rule(s) the code follows; ${m.added} new, proposed${m.changed ? `; ${m.changed} agreed rule(s) whose facts moved` : ""}\n${listText(m.direction)}` };
  }
  return { exitCode: 0, text: listText(loadDirection(rootOf(sub))) };
}

function listText(d) {
  if (!d.rules.length) return "no project direction yet — `direction project census` reads it from the code (zero tokens)\n";
  return d.rules.map((r) => `[${r.status}] ${r.id}: ${r.text}${r.changed ? " (facts moved since agreed)" : ""}${r.missing ? " (no longer found in the code)" : ""}\n  why: ${r.why}\n  from: ${r.basis}${r.check ? ` · checked as advice: ${r.check.rule}` : ""}`).join("\n") + "\n";
}
