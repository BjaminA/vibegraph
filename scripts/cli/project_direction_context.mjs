// The project's own direction in the plain-Claude path (2026-10-16;
// src/server/project_direction.ts has the store and the census). Like the
// generic direction (direction.mjs), two switches per AGREED rule
// (2026-10-20; ruleDelivery in project_direction_wire.ts):
//   up front      it reaches the session once, with the first routed thread
//                 whose files it is about;
//   when broken   one that carries a check is checked after every edit AS
//                 ADVICE (never a block): a violation this session did not
//                 start with brings the rule and its why, once per rule.
// And the CLI: `direction project [census | agree <id> | drop <id>] [<root>]`.

import { resolve } from "node:path";
import { loadDirection, saveDirection, censusAt, mergeCensus, decideRule, rulesFor, ruleLine, staleRules } from "../../src/server/project_direction.ts";
import { checkStatedRules } from "../../src/server/constraint_report.ts";
import { readSkillsConfig } from "../../src/server/generic_skills.ts";
import { ruleDelivery } from "../../src/shared/project_direction_wire.ts";
import { buildStackIndex } from "../../src/server/stack.ts";
import { buildCrossingIndex } from "../../src/server/crossings.ts";
import { archModelForEnvelope } from "../../src/server/arch_envelope.ts";
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "./pipeline.mjs";
import { cliPath } from "./winpath.mjs";
import { offenderIdentity } from "./hook_findings.mjs";

/** `(rule) => {upfront, onCheck}` for this project (the legacy mode is the default). */
const deliveryOf = (absRoot) => {
  let mode;
  try { mode = readSkillsConfig(absRoot).config.hooks; } catch { mode = undefined; }
  return (r) => ruleDelivery(r, mode);
};

/** For one prompt: `(ep) => block | null` — each agreed rule told up front, once per session. */
export function projectDirectionForPrompt(absRoot, env, state) {
  const of = deliveryOf(absRoot);
  const all = loadDirection(absRoot);
  const d = { ...all, rules: all.rules.filter((r) => of(r).upfront) };
  if (!d.rules.length) return () => null;
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

/** The agreed rules set to explain when broken, and what each finds violated now. */
function violations(absRoot, loaded) {
  const of = deliveryOf(absRoot);
  const rules = loadDirection(absRoot).rules.filter((r) => of(r).onCheck);
  if (!rules.length) return { rules, keys: [] };
  try {
    const report = checkStatedRules({
      envelope: loaded.envelope, root: absRoot, stack: buildStackIndex(loaded.envelope, absRoot),
      constraints: rules.map((r) => ({ id: r.id, kind: "invariant", text: r.text, scope: { all: true }, source: "human", check: r.check })),
    });
    return { rules, keys: report.results.filter((row) => row.verdict === "violated").flatMap((row) => (row.offenders.length ? row.offenders : ["-"]).map((o) => `${row.id}|${offenderIdentity(o)}`)) };
  } catch { return { rules, keys: [] }; }
}

/** At the session's start (bookkeeping, not context): what was already so. */
export function projectDirectionBaseline(absRoot, loaded, state) {
  if (!state.directionBase) state.directionBase = violations(absRoot, loaded).keys;
}

/** After an edit: the agreed rules set to explain when broken, checked as advice. */
export function projectDirectionAfterEdit(absRoot, loaded, state) {
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

/** The census of the code as it is now (zero tokens); `have` reuses a parse. */
export function censusNow(root, have = null) {
  const envelope = have?.envelope ?? loadEnvelope(root, null, pipelineHere(root), { cache: true }).envelope;
  const stack = have?.stack ?? buildStackIndex(envelope, root);
  const model = archModelForEnvelope(envelope, stack, buildCrossingIndex(envelope), root, undefined, { applyStore: false });
  return censusAt(root, { stack, model, files: envelope.files });
}

export function runProjectDirection(args) {
  const [sub, b, c] = args;
  const rootOf = (r) => resolve(cliPath(r ?? "."));
  if (sub === "agree" || sub === "drop") {
    const root = rootOf(c);
    const d = loadDirection(root);
    // agreeing reads the code as it is now: a stale census proposal is refused
    const err = decideRule(d, b ?? "", sub, "human", new Date(), sub === "agree" ? censusNow(root) : undefined);
    if (err) return { exitCode: 1, text: `${err}\n` };
    saveDirection(root, d);
    return { exitCode: 0, text: `${sub === "agree" ? "agreed" : "dropped"} ${b}\n` };
  }
  if (sub === "census") {
    const root = rootOf(b);
    const found = censusNow(root);
    const m = mergeCensus(loadDirection(root), found);
    saveDirection(root, m.direction);
    return { exitCode: 0, text: `${found.length} rule(s) the code follows; ${m.added} new, proposed${m.changed ? `; ${m.changed} agreed rule(s) whose facts moved` : ""}\n${listText(m.direction)}` };
  }
  // the listing reads the code too: a proposal is shown with what the code says NOW
  const root = rootOf(sub);
  const d = loadDirection(root);
  return { exitCode: 0, text: listText(d, deliveryOf(root), d.rules.some((r) => r.status === "proposed") ? staleRules(d, censusNow(root)) : new Map()) };
}

function listText(d, of = null, stale = new Map()) {
  if (!d.rules.length) return "no project direction yet — `direction project census` reads it from the code (zero tokens)\n";
  const now = (r) => {
    const s = r.status === "proposed" ? stale.get(r.id) : null;
    if (!s) return "";
    return s.state === "gone" ? "\n  NOW: the code no longer shows this — `direction project census` (zero tokens) takes it off the list"
      : `\n  NOW: its facts have moved — ${s.now} (\`direction project census\` re-reads it, zero tokens)`;
  };
  const told = (r) => { if (!of || r.status !== "agreed") return ""; const x = of(r); return ` · Claude is told: ${[x.upfront ? "up front" : "", x.onCheck ? "when broken" : ""].filter(Boolean).join(" + ") || "nothing"} (\`direction set ${r.id} --up-front on|off --when-broken on|off\`)`; };
  return d.rules.map((r) => `[${r.status}] ${r.id}: ${r.text}${r.changed ? " (facts moved since agreed)" : ""}${r.missing ? " (no longer found in the code)" : ""}\n  why: ${r.why}\n  from: ${r.basis}${r.check ? ` · its check: ${r.check.rule}` : " · nothing checks it"}${told(r)}${now(r)}`).join("\n") + "\n";
}
