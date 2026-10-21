// GENERIC DIRECTION in the plain-Claude path (2026-09-29, Ben: "we're
// bloating the context … make it as concise and lightweight as possible …
// could they be deterministic scripts Claude can call … give the user the
// option to enable and disable").
//
// The six generic skills (skills/<name>/SKILL.md) each carry RULES, and each
// rule a `why` and a binding to the check that catches it. A whole body is
// 2.4–4 KB; its rule headlines are 165–573 chars. So in a hooked session a
// skill is never sent whole:
//
//   up front      a skill whose applies_when fires on a routed thread sends
//                 its rule HEADLINES once per session (and rides the GUI
//                 chat, workers and thread agents in full);
//   when broken   when a check a rule is bound to fires after an edit, THAT
//                 rule arrives with its why — once per rule per session,
//                 beside the finding it explains.
// Two switches per skill (2026-10-20, Ben: one page-wide mode was confusing,
// and "nothing" is just both off); `.vibegraph/skills.json` `delivery`.
// The full rule set is on demand, deterministically, from `vibegraph-knowledge
// direction <skill>` or MCP `vibegraph_direction` — no model, no tokens.
// Enable / disable is the same `.vibegraph/skills.json` the Skills panel
// writes; nothing is enabled by default.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { locate } from "./paths.mjs";
import { cacheDirFor } from "../envelope_cache.mjs";
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "./pipeline.mjs";
import { loadGenericSkills, readSkillsConfig, saveSkillsConfig, HOOK_MODES, skillHeadlines as headlines, describeGenericSkill as describeSkill } from "../../src/server/generic_skills.ts";
import { DELIVERY_OFF, deliveryInUse, legacyDelivery, skillDelivery } from "../../src/shared/generic_skills_wire.ts";
import { loadDirection, saveDirection, setRuleDelivery } from "../../src/server/project_direction.ts";
import { evaluatePredicate } from "../../src/server/quality/predicate.ts";
import { deriveStackProfile } from "../../src/server/quality/profile.ts";
import { buildStackIndex } from "../../src/server/stack.ts";
import { cliPath } from "./winpath.mjs";
import { projectDirectionForPrompt, runProjectDirection, PROJECT_DIRECTION_USAGE } from "./project_direction_context.mjs";

export { HOOK_MODES };

export const DIRECTION_USAGE = `direction [<root>]                      the generic skills: enabled?, where they apply (zero tokens)
  direction <skill> [<root>]            one skill's rules with their why and the check each is bound to
  direction enable|disable <skill> [<root>]   both switches on, or both off
  direction set <skill|dN> [--up-front on|off] [--when-broken on|off] [<root>]
                                        what Claude is told about one skill or agreed project rule:
                                        its rules up front, and/or its why when an edit breaks its check
  direction hooks headlines|on-violation|off [<root>]   LEGACY: set every skill and agreed rule at once
  ${PROJECT_DIRECTION_USAGE}`;

export function skillsDir(loc = locate()) {
  return loc.mode === "installed" ? join(loc.packageRoot, "vendor", "skills") : join(loc.repoRoot, "skills");
}

let loadedSkills = null;
export function shippedSkills() {
  loadedSkills ??= loadGenericSkills(skillsDir()).skills;
  return loadedSkills;
}

/** The skills in use and which of them each switch covers, or null when none is. */
export function enabledDirection(absRoot) {
  const { config } = readSkillsConfig(absRoot);
  if (!config.enabled.length) return null;
  const skills = shippedSkills().filter((s) => deliveryInUse(skillDelivery(config, s.name)));
  if (!skills.length) return null;
  return { config, skills, upfront: skills.filter((s) => skillDelivery(config, s.name).upfront), onCheck: skills.filter((s) => skillDelivery(config, s.name).onCheck) };
}

/** skill name → the entry points its applies_when fires on. The stack
 *  profile behind it is cached beside the envelope, keyed on the threads. */
export function applicability(env, absRoot, skills) {
  const key = createHash("sha1").update(JSON.stringify([env.threads.map((t) => [t.entryPointId, t.filesReached ?? []]), skills.map((s) => s.bodyHash)])).digest("hex");
  const file = join(cacheDirFor(absRoot), "direction-applies.json");
  try {
    const c = JSON.parse(readFileSync(file, "utf-8"));
    if (c.key === key) return new Map(Object.entries(c.applies).map(([k, v]) => [k, new Set(v)]));
  } catch { /* build */ }
  const profile = deriveStackProfile(env, buildStackIndex(env, absRoot), { project: absRoot, commit: "working-tree" }).profile;
  const applies = new Map();
  for (const s of skills) {
    applies.set(s.name, new Set(Object.keys(profile.threads ?? {}).filter((ep) => evaluatePredicate(s.applies_when, { profile, entryPointId: ep }))));
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ key, applies: Object.fromEntries([...applies].map(([k, v]) => [k, [...v]])) }));
  } catch { /* only slower */ }
  return applies;
}

const tag = (s) => (s.evidence === "validated" ? "drilled" : "unvalidated");

/** For one prompt: `(ep) => block | null` — the generic skills' headlines
 *  and the project's agreed direction (project_direction_context.mjs). */
export function directionForPrompt(absRoot, env, routedEps, state) {
  const generic = genericForPrompt(absRoot, env, routedEps, state);
  const project = routedEps.length ? projectDirectionForPrompt(absRoot, env, state) : () => null;
  return (ep) => [generic(ep), project(ep)].filter(Boolean).join("\n") || null;
}

/** The generic skills told up front, each once per session. */
function genericForPrompt(absRoot, env, routedEps, state) {
  const d = enabledDirection(absRoot);
  if (!d || !d.upfront.length) return () => null;
  // read per call: a thread held back for room restores state.direction to a
  // copy, and a record kept on the old object would be lost (2026-10-16)
  const sent = () => (state.direction ??= { skills: [], rules: [] });
  const pending = d.upfront.filter((s) => !sent().skills.includes(s.name));
  if (!pending.length || !routedEps.length) return () => null;
  const applies = applicability(env, absRoot, d.upfront);
  return (ep) => {
    const now = pending.filter((s) => !sent().skills.includes(s.name) && applies.get(s.name)?.has(ep));
    if (!now.length) return null;
    for (const s of now) sent().skills.push(s.name);
    return `## Generic direction (enabled in .vibegraph/skills.json — advice, never a gate; the why of each: \`vibegraph-knowledge direction <skill>\`)\n${now.map(headlines).join("\n")}`;
  };
}

/** For the findings a check just produced: the why of every rule bound to
 *  that check in a skill set to explain when broken, once per rule per session. */
export function directionForFindings(absRoot, findings, state) {
  const d = enabledDirection(absRoot);
  if (!d || !d.onCheck.length || !findings.length) return null;
  const sent = (state.direction ??= { skills: [], rules: [] });
  const verbs = new Set(findings.map((f) => f.rule));
  const out = [];
  for (const s of d.onCheck) {
    for (const r of s.rules) {
      const verb = r.binding.startsWith("check:") ? r.binding.slice(6) : null;
      const key = `${s.name}/${r.id}`;
      if (!verb || !verbs.has(verb) || sent.rules.includes(key)) continue;
      sent.rules.push(key);
      out.push(`- (${s.name}, on ${verb}) ${r.text} — why: ${r.why}`);
    }
  }
  return out.length ? `Why, from the enabled generic direction:\n${out.join("\n")}` : null;
}

export function runDirection(args) {
  const [a, b, c] = args;
  if (a === "project") return runProjectDirection(args.slice(1));
  const set = (root, mutate) => {
    const absRoot = resolve(cliPath(root ?? "."));
    const { config } = readSkillsConfig(absRoot);
    const err = mutate(config);
    if (err) return { exitCode: 1, text: `${err}\n` };
    for (const n of Object.keys(config.delivery ?? {})) if (!deliveryInUse(config.delivery[n])) delete config.delivery[n];
    config.enabled = Object.keys(config.delivery ?? {});
    for (const n of Object.keys(config.enabledBy ?? {})) if (!config.enabled.includes(n)) delete config.enabledBy[n];
    saveSkillsConfig(absRoot, config);
    return { exitCode: 0, text: `.vibegraph/skills.json: ${config.enabled.map((n) => `${n} (${switches(config.delivery[n])})`).join(", ") || "no skill in use"}\n` };
  };
  const on = (cfg, name, d) => {
    cfg.delivery = { ...(cfg.delivery ?? {}), [name]: d };
    if (deliveryInUse(d) && !cfg.enabledBy?.[name]) cfg.enabledBy = { ...(cfg.enabledBy ?? {}), [name]: { source: "human", at: new Date().toISOString() } };
  };
  const known = shippedSkills().map((s) => s.name);
  if (a === "enable" || a === "disable") {
    return set(c, (cfg) => {
      if (!known.includes(b)) return `no shipped skill named ${b ?? "(none)"} — one of: ${known.join(", ")}`;
      on(cfg, b, a === "enable" ? { upfront: true, onCheck: true } : { ...DELIVERY_OFF });
      return null;
    });
  }
  if (a === "set") return setOne(args.slice(1), set, on, known);
  if (a === "hooks") {
    // LEGACY: one mode for everything — every skill in use and every agreed
    // project rule gets the mode's switches, and it stays the default for
    // rules agreed later.
    return set(c, (cfg) => {
      if (!HOOK_MODES.includes(b)) return `hooks mode must be one of ${HOOK_MODES.join(", ")}`;
      for (const n of cfg.enabled) on(cfg, n, legacyDelivery(b));
      cfg.hooks = b;
      const root = resolve(cliPath(c ?? "."));
      const dir = loadDirection(root);
      const d = legacyDelivery(b);
      for (const r of dir.rules.filter((x) => x.status === "agreed")) setRuleDelivery(dir, r.id, { upfront: d.upfront, onCheck: d.onCheck && !!r.check }, d);
      if (dir.rules.some((r) => r.status === "agreed")) saveDirection(root, dir);
      return null;
    });
  }
  if (a && known.includes(a)) return { exitCode: 0, text: `${describeSkill(shippedSkills().find((s) => s.name === a))}\n` };
  const absRoot = resolve(a ?? ".");
  if (!existsSync(absRoot)) return { exitCode: 1, text: `no skill or directory named ${a}\n${DIRECTION_USAGE}\n` };
  const { config } = readSkillsConfig(absRoot);
  const { envelope } = loadEnvelope(absRoot, null, pipelineHere(absRoot), { cache: true });
  const applies = applicability(envelope, absRoot, shippedSkills());
  const n = envelope.threads.filter((t) => t.entryPointId).length;
  const lines = shippedSkills().map((s) =>
    `[${switches(skillDelivery(config, s.name))}] ${s.name} [${tag(s)}] — applies to ${applies.get(s.name)?.size ?? 0} of ${n} threads; headlines ${headlines(s).length} chars, full ${s.body.length}`);
  return { exitCode: 0, text: `${lines.join("\n")}\nchange one: \`direction set <skill> --up-front on|off --when-broken on|off\`\n` };
}

const switches = (d) => (d && deliveryInUse(d) ? [d.upfront ? "up front" : "", d.onCheck ? "when broken" : ""].filter(Boolean).join(" + ") : "off");

/** `direction set <skill|dN> [--up-front on|off] [--when-broken on|off] [<root>]` */
function setOne(rest, set, on, known) {
  const [name, ...more] = rest;
  const flag = (f) => { const i = more.indexOf(f); return i < 0 ? undefined : more[i + 1]; };
  const bool = (v) => (v === undefined ? undefined : v === "on" ? true : v === "off" ? false : null);
  const upfront = bool(flag("--up-front")), onCheck = bool(flag("--when-broken"));
  if (upfront === null || onCheck === null) return { exitCode: 2, text: "--up-front and --when-broken take on or off\n" };
  if (upfront === undefined && onCheck === undefined) return { exitCode: 2, text: `say what to change: --up-front on|off and/or --when-broken on|off\n${DIRECTION_USAGE}\n` };
  const flags = new Set(["--up-front", "--when-broken"]);
  const root = more.filter((x, i) => !flags.has(x) && !flags.has(more[i - 1]))[0];
  if (/^d\d+$/.test(name ?? "")) {
    const absRoot = resolve(cliPath(root ?? "."));
    const dir = loadDirection(absRoot);
    const err = setRuleDelivery(dir, name, { upfront, onCheck }, legacyDelivery(readSkillsConfig(absRoot).config.hooks));
    if (err) return { exitCode: 1, text: `${err}\n` };
    saveDirection(absRoot, dir);
    const r = dir.rules.find((x) => x.id === name);
    return { exitCode: 0, text: `${name}: ${switches(r.delivery)}\n` };
  }
  if (!known.includes(name)) return { exitCode: 1, text: `no shipped skill or project rule named ${name ?? "(none)"} — skills: ${known.join(", ")}; rules: d1, d2… (\`direction project\`)\n` };
  return set(root, (cfg) => {
    const was = skillDelivery(cfg, name);
    on(cfg, name, { upfront: upfront ?? was.upfront, onCheck: onCheck ?? was.onCheck });
    return null;
  });
}
