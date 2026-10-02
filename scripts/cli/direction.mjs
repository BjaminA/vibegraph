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
//   headlines     (default) an enabled skill whose applies_when fires on a
//                 routed thread sends its rule HEADLINES once per session;
//   on-violation  nothing up front: when a check a rule is bound to fires
//                 after an edit, THAT rule arrives with its why — once per
//                 rule per session, beside the finding it explains;
//   off           the hooks send nothing (the GUI chat and workers still do).
//
// In every mode a finding still brings its rule's why once: that is when the
// reason is worth the most, and it costs nothing until something breaks.
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
import { evaluatePredicate } from "../../src/server/quality/predicate.ts";
import { deriveStackProfile } from "../../src/server/quality/profile.ts";
import { buildStackIndex } from "../../src/server/stack.ts";
import { cliPath } from "./winpath.mjs";

export { HOOK_MODES };

export const DIRECTION_USAGE = `direction [<root>]                      the generic skills: enabled?, where they apply (zero tokens)
  direction <skill> [<root>]            one skill's rules with their why and the check each is bound to
  direction enable|disable <skill> [<root>]
  direction hooks headlines|on-violation|off [<root>]   what the hooks send (default headlines)`;

export function skillsDir(loc = locate()) {
  return loc.mode === "installed" ? join(loc.packageRoot, "vendor", "skills") : join(loc.repoRoot, "skills");
}

let loadedSkills = null;
export function shippedSkills() {
  loadedSkills ??= loadGenericSkills(skillsDir()).skills;
  return loadedSkills;
}

/** The enabled skills and the hook mode, or null when nothing is enabled. */
export function enabledDirection(absRoot) {
  const { config } = readSkillsConfig(absRoot);
  if (!config.enabled.length) return null;
  const skills = shippedSkills().filter((s) => config.enabled.includes(s.name));
  if (!skills.length) return null;
  const mode = HOOK_MODES.includes(config.hooks) ? config.hooks : "headlines";
  return { config, skills, mode };
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

/** For one prompt: `(ep) => block | null`, headline mode only, each skill
 *  once per session. */
export function directionForPrompt(absRoot, env, routedEps, state) {
  const d = enabledDirection(absRoot);
  if (!d || d.mode !== "headlines") return () => null;
  const sent = (state.direction ??= { skills: [], rules: [] });
  const pending = d.skills.filter((s) => !sent.skills.includes(s.name));
  if (!pending.length || !routedEps.length) return () => null;
  const applies = applicability(env, absRoot, d.skills);
  return (ep) => {
    const now = pending.filter((s) => !sent.skills.includes(s.name) && applies.get(s.name)?.has(ep));
    if (!now.length) return null;
    for (const s of now) sent.skills.push(s.name);
    return `## Generic direction (enabled in .vibegraph/skills.json — advice, never a gate; the why of each: \`vibegraph-knowledge direction <skill>\`)\n${now.map(headlines).join("\n")}`;
  };
}

/** For the findings a check just produced: the why of every enabled rule
 *  bound to that check, once per rule per session (any mode but off). */
export function directionForFindings(absRoot, findings, state) {
  const d = enabledDirection(absRoot);
  if (!d || d.mode === "off" || !findings.length) return null;
  const sent = (state.direction ??= { skills: [], rules: [] });
  const verbs = new Set(findings.map((f) => f.rule));
  const out = [];
  for (const s of d.skills) {
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
  const set = (root, mutate) => {
    const absRoot = resolve(cliPath(root ?? "."));
    const { config } = readSkillsConfig(absRoot);
    const err = mutate(config);
    if (err) return { exitCode: 1, text: `${err}\n` };
    saveSkillsConfig(absRoot, config);
    return { exitCode: 0, text: `.vibegraph/skills.json: enabled ${config.enabled.join(", ") || "(none)"}; hooks ${config.hooks ?? "headlines"}\n` };
  };
  const known = shippedSkills().map((s) => s.name);
  if (a === "enable" || a === "disable") {
    return set(c, (cfg) => {
      if (!known.includes(b)) return `no shipped skill named ${b ?? "(none)"} — one of: ${known.join(", ")}`;
      if (a === "enable" && !cfg.enabled.includes(b)) {
        cfg.enabled.push(b);
        cfg.enabledBy = { ...(cfg.enabledBy ?? {}), [b]: { source: "human", at: new Date().toISOString() } };
      }
      if (a === "disable") {
        cfg.enabled = cfg.enabled.filter((n) => n !== b);
        if (cfg.enabledBy) delete cfg.enabledBy[b];
      }
      return null;
    });
  }
  if (a === "hooks") {
    return set(c, (cfg) => {
      if (!HOOK_MODES.includes(b)) return `hooks mode must be one of ${HOOK_MODES.join(", ")}`;
      cfg.hooks = b;
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
    `${config.enabled.includes(s.name) ? "[on] " : "[off]"} ${s.name} [${tag(s)}] — applies to ${applies.get(s.name)?.size ?? 0} of ${n} threads; headlines ${headlines(s).length} chars, full ${s.body.length}`);
  return { exitCode: 0, text: `${lines.join("\n")}\nhooks: ${config.hooks ?? "headlines"} (\`direction hooks headlines|on-violation|off\`)\n` };
}
