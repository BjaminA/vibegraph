// M-SKILLS.1 (PLAN-M-SKILLS.md) — generic coding-direction skills: the
// ONE parser for skills/<name>/SKILL.md, the per-project enable file, and
// the pure selector that mirrors applyRoutingBudget's honesty.
//
// A generic skill is the prose half of a quality dimension: direction that
// is true of a KIND of code, selected by a predicate over the stack
// profile (there is no `always`), injected after the thread skill under
// the same budget. Every rule carries its why and a BINDING to the check,
// pre-check or envelope fact that stands behind it — or `judgement`, which
// may never be cited as enforced. The schema
// (schemas/quality/generic_skill.json) refuses a rule that binds to
// nothing; this parser refuses a bullet that does not state both.
//
// Pure: no fs at selection time, no server state. The validator script
// imports the parser so there is one reading of the file format; the
// server (M-SKILLS.2) calls the selector with its live profile.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { evaluatePredicate, predicateFacts, type Predicate, type PredicateScope, type ProfileLike, type TaskFacts } from "./quality/predicate.ts";
import { sourceHashOf } from "./readme_store.ts";
import { SKILL_INJECTION_BUDGET_CHARS } from "./thread_remit.ts";
import type { SkillsConfig, SkillCatalogueEntry } from "../shared/generic_skills_wire.ts";

export type { SkillsConfig, SkillCatalogueEntry };

export interface GenericSkillRule { id: string; text: string; why: string; binding: string }
export interface GenericSkill {
  name: string;
  description: string;
  skillVersion: string;
  lastUpdated: string;
  dimension: string;
  applies_when: Predicate;
  binds: string[];
  derivedFrom: string[];
  evidence: "unvalidated" | "validated";
  drill?: string;
  rules: GenericSkillRule[];
  limits: string[];
  refused: Array<{ what: string; reason: string }>;
  /** The whole markdown body (everything after the frontmatter): what injects. */
  body: string;
  /** sourceHashOf(body): the dedup key, as a thread skill's sourceHash is. */
  bodyHash: string;
}

/** Required sections, in order. Mirrors the thread-skill contract's shape:
 *  a missing or misordered section is refused, never defaulted. */
export const GENERIC_SKILL_SECTIONS = [
  "## Purpose", "## Applies when", "## Rules and why", "## What this cannot check", "## Refused from the source",
] as const;

/** The binding grammar, as the schema's `Binding` pattern. Kept here too so
 *  a JS caller with no Ajv gets the same refusal. Pre-check names are their
 *  RUN1/RUN3 names: orchestration.ts exports no ids yet (gap G14). */
export const BINDING_RE =
  /^(check:(guards|not-in-loop|handles-failure|annotated|co-changes|callers-only|import-only|calls-through)|precheck:(loosening-loud|tests-touched|no-new-unattributed-boundary|added-tools|stack-policy|retry-notice)|envelope:[a-z][a-zA-Z0-9.-]*|judgement)$/;

/** A generic skill rides AFTER the thread skill inside one turn's budget. A
 *  live drafted thread skill measures ~6.9k chars (thread_remit.ts), so a
 *  generic body must leave room for that plus a second generic skill: a
 *  third of the budget each. Derived from the budget, not chosen apart
 *  from it, so the two cannot drift. */
export const GENERIC_SKILL_BODY_CEILING = Math.floor(SKILL_INJECTION_BUDGET_CHARS / 3);

const RULE_RE = /^\*\*(.+?)\*\*\s+[—–-]+\s*why:\s*(.+?)\s+[—–-]+\s*bound:\s*(\S+)\s*$/s;
const REFUSED_RE = /^(.+?)\s+[—–-]+\s*reason:\s*(.+)$/s;

function parseFrontmatter(text: string): { fm: Record<string, string>; body: string } | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const header = text.slice(3, end).trim().split("\n");
  const fm: Record<string, string> = {};
  let key: string | null = null;
  let folded = false;
  for (const line of header) {
    const m = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (m && !line.startsWith(" ")) {
      key = m[1];
      const v = m[2].trim();
      // `>-` folds the following indented lines into one paragraph (the
      // local skill-author contract's description style).
      if (v === ">-" || v === ">") { fm[key] = ""; folded = true; }
      else { fm[key] = v; folded = false; }
    } else if (key && folded && /^\s+/.test(line)) {
      fm[key] = (fm[key] ? fm[key] + " " : "") + line.trim();
    }
  }
  return { fm, body: text.slice(end + 4).trim() };
}

function bullets(lines: string[], from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i < to; i++) {
    const l = lines[i];
    if (/^\s*[-*]\s+/.test(l)) out.push(l.replace(/^\s*[-*]\s+/, ""));
    else if (out.length && l.trim()) out[out.length - 1] += " " + l.trim();
  }
  return out;
}

/** Parse one SKILL.md. Every refusal is a named problem; a skill with any
 *  problem is null. Nothing is defaulted. */
export function parseGenericSkill(text: string): { skill: GenericSkill | null; problems: string[] } {
  const problems: string[] = [];
  const parsed = parseFrontmatter(text);
  if (!parsed) return { skill: null, problems: ["no frontmatter"] };
  const { fm, body } = parsed;

  const need = (k: string) => { if (!fm[k]) problems.push(`frontmatter: missing ${k}`); return fm[k] ?? ""; };
  const name = need("name");
  const description = need("description");
  const skillVersion = need("version");
  const lastUpdated = need("last-updated");
  const dimension = need("dimension");
  const evidence = need("evidence");
  const json = (k: string): unknown => {
    const raw = need(k);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { problems.push(`frontmatter: ${k} is not JSON`); return null; }
  };
  const applies_when = json("applies_when") as Predicate | null;
  const binds = json("binds");
  const derivedFrom = json("derivedFrom");
  if (description && !description.startsWith("Use when ")) problems.push("description must open with `Use when ` (the trigger, never the workflow)");
  if (evidence && evidence !== "unvalidated" && evidence !== "validated") problems.push(`evidence must be unvalidated or validated, not ${evidence}`);
  if (evidence === "validated" && !fm.drill) problems.push("evidence: validated requires a drill reference");
  if (!Array.isArray(binds) || !binds.length) problems.push("binds must be a non-empty JSON array");
  else for (const b of binds) if (typeof b !== "string" || !BINDING_RE.test(b)) problems.push(`binds: unknown binding ${JSON.stringify(b)}`);
  if (!Array.isArray(derivedFrom) || !derivedFrom.length) problems.push("derivedFrom must be a non-empty JSON array of RUN1 ids");
  if (applies_when && !predicateFacts(applies_when).length) problems.push("applies_when names no fact, regime or task — there is no `always`");

  // Sections, once each, in order.
  const lines = body.split("\n");
  const at: number[] = [];
  for (const s of GENERIC_SKILL_SECTIONS) {
    const hits = lines.map((l, i) => (l.trim() === s ? i : -1)).filter((i) => i >= 0);
    if (hits.length !== 1) problems.push(`section "${s}" must appear exactly once (found ${hits.length})`);
    at.push(hits[0] ?? -1);
  }
  for (let i = 1; i < at.length; i++) if (at[i] >= 0 && at[i - 1] >= 0 && at[i] < at[i - 1]) problems.push(`section "${GENERIC_SKILL_SECTIONS[i]}" is out of order`);
  if (!body.startsWith(GENERIC_SKILL_SECTIONS[0])) problems.push(`body must start with "${GENERIC_SKILL_SECTIONS[0]}" (no preamble)`);
  const sectionRange = (i: number): [number, number] => [at[i] + 1, i + 1 < at.length ? at[i + 1] : lines.length];

  const rules: GenericSkillRule[] = [];
  if (at[2] >= 0) {
    const [f, t] = sectionRange(2);
    bullets(lines, f, t).forEach((b, n) => {
      const m = b.match(RULE_RE);
      if (!m) { problems.push(`rule ${n + 1}: must read \`**rule** — why: … — bound: <binding>\` (both the why and the binding are required)`); return; }
      const [, text, why, binding] = m;
      if (!BINDING_RE.test(binding)) { problems.push(`rule ${n + 1}: unknown binding ${binding}`); return; }
      rules.push({ id: `r${n + 1}`, text: text.trim(), why: why.trim(), binding });
    });
    if (!rules.length) problems.push("no rules");
  }
  const limits = at[3] >= 0 ? bullets(lines, ...sectionRange(3)) : [];
  if (at[3] >= 0 && !limits.length) problems.push("`## What this cannot check` is empty — a skill whose checks see everything is a claim no static check can make");
  const refused: GenericSkill["refused"] = [];
  if (at[4] >= 0) {
    bullets(lines, ...sectionRange(4)).forEach((b, n) => {
      const m = b.match(REFUSED_RE);
      if (!m) { problems.push(`refused ${n + 1}: must read \`<what> — reason: <reason>\``); return; }
      refused.push({ what: m[1].trim(), reason: m[2].trim() });
    });
    if (!refused.length) problems.push("`## Refused from the source` is empty — the refusal ledger is required");
  }

  // Binding consistency: what a rule binds must be listed, and what is
  // listed must be used — a stale `binds` line would misdescribe the skill.
  if (Array.isArray(binds)) {
    const used = new Set(rules.map((r) => r.binding));
    for (const b of binds as string[]) if (!used.has(b)) problems.push(`binds lists ${b} but no rule binds to it`);
    for (const b of used) if (!(binds as string[]).includes(b)) problems.push(`rule binds to ${b} but binds does not list it`);
  }
  if (body.length > GENERIC_SKILL_BODY_CEILING) problems.push(`body is ${body.length} chars; ceiling ${GENERIC_SKILL_BODY_CEILING} (a third of the injection budget, so it rides beside a thread skill)`);

  if (problems.length) return { skill: null, problems };
  return {
    skill: {
      name, description, skillVersion, lastUpdated, dimension,
      applies_when: applies_when as Predicate, binds: binds as string[], derivedFrom: derivedFrom as string[],
      evidence: evidence as GenericSkill["evidence"], ...(fm.drill ? { drill: fm.drill } : {}),
      rules, limits, refused, body, bodyHash: sourceHashOf({ body }),
    },
    problems: [],
  };
}

/** Load every skills/<name>/SKILL.md under `dir`. A folder whose name does
 *  not equal the skill's `name` is a problem (the local contract). */
export function loadGenericSkills(dir: string): { skills: GenericSkill[]; problems: Record<string, string[]> } {
  const skills: GenericSkill[] = [];
  const problems: Record<string, string[]> = {};
  if (!existsSync(dir)) return { skills, problems };
  for (const folder of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const p = join(dir, folder, "SKILL.md");
    if (!existsSync(p)) { problems[folder] = ["no SKILL.md"]; continue; }
    const { skill, problems: ps } = parseGenericSkill(readFileSync(p, "utf-8"));
    if (!skill) { problems[folder] = ps; continue; }
    if (skill.name !== folder) { problems[folder] = [`frontmatter name ${skill.name} does not equal the folder name`]; continue; }
    skills.push(skill);
  }
  return { skills, problems };
}

// ── The per-project enable file ────────────────────────────────────────
// Off by default: nothing injects that a human did not choose. Enabling
// is the ratification act, and it carries who and when. The shape lives
// in src/shared/generic_skills_wire.ts so the panel renders the same
// definition the server persists.

export function skillsConfigPath(root: string): string { return join(root, ".vibegraph", "skills.json"); }

/** Fail-safe toward OFF: a missing or malformed file enables nothing, and
 *  says so in `problems` rather than silently. */
export function readSkillsConfig(root: string): { config: SkillsConfig; problems: string[] } {
  const p = skillsConfigPath(root);
  const off: SkillsConfig = { version: "1.0", enabled: [] };
  if (!existsSync(p)) return { config: off, problems: [] };
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    if (!raw || raw.version !== "1.0" || !Array.isArray(raw.enabled)) return { config: off, problems: [`${p}: not a v1.0 skills config — nothing enabled`] };
    const enabled = raw.enabled.filter((x: unknown) => typeof x === "string");
    return { config: { version: "1.0", enabled, ...(raw.enabledBy && typeof raw.enabledBy === "object" ? { enabledBy: raw.enabledBy } : {}) }, problems: [] };
  } catch (e: any) {
    return { config: off, problems: [`${p}: ${e?.message ?? e} — nothing enabled`] };
  }
}

// ── Selection ──────────────────────────────────────────────────────────

export interface RoutedGenericSkill {
  name: string;
  skillVersion: string;
  /** The body to inject, or null with the reason below. */
  skill: string | null;
  omitted?: "disabled" | "not-applicable" | "over-budget" | "already-in-session";
  /** The facts / regimes / task keys the predicate read — the provenance line's "applies because". */
  appliesOn: string[];
  evidence: GenericSkill["evidence"];
}

export interface SelectInput {
  skills: GenericSkill[];
  config: SkillsConfig;
  profile: ProfileLike;
  entryPointId?: string;
  task?: TaskFacts;
  /** Chars left in the turn AFTER the thread skill and constraints. */
  budgetChars: number;
  alreadyInjected: ReadonlyMap<string, string>;
}

/** Which enabled skills apply to this thread, within the budget, not yet
 *  sent this session. Every omission is named — a skill that is silently
 *  not there reads as "no direction exists", which M-SKILL.7 forbids for
 *  thread skills and this forbids for generic ones. Mutates nothing;
 *  returns the (name → bodyHash) pairs the caller records once the turn
 *  is actually sent. */
export function selectGenericSkills(input: SelectInput): { routed: RoutedGenericSkill[]; injected: Array<[string, string]> } {
  const routed: RoutedGenericSkill[] = [];
  const injected: Array<[string, string]> = [];
  const enabled = new Set(input.config.enabled);
  const scope: PredicateScope = { profile: input.profile, entryPointId: input.entryPointId, task: input.task };
  let remaining = input.budgetChars;
  for (const s of input.skills) {
    const base = { name: s.name, skillVersion: s.skillVersion, appliesOn: predicateFacts(s.applies_when), evidence: s.evidence };
    if (!enabled.has(s.name)) { routed.push({ ...base, skill: null, omitted: "disabled" }); continue; }
    if (!evaluatePredicate(s.applies_when, scope)) { routed.push({ ...base, skill: null, omitted: "not-applicable" }); continue; }
    if (input.alreadyInjected.get(s.name) === s.bodyHash) { routed.push({ ...base, skill: null, omitted: "already-in-session" }); continue; }
    if (s.body.length > remaining) { routed.push({ ...base, skill: null, omitted: "over-budget" }); continue; }
    remaining -= s.body.length;
    routed.push({ ...base, skill: s.body });
    injected.push([s.name, s.bodyHash]);
  }
  return { routed, injected };
}

/** The line that precedes an injected generic skill in a prompt: who
 *  enabled it, that it is direction (advisory), and why it applies here. */
export function genericSkillProvenanceLine(r: RoutedGenericSkill, config: SkillsConfig): string {
  const by = config.enabledBy?.[r.name];
  const who = by ? `enabled by ${by.source}${by.id ? ` (${by.id})` : ""} on ${by.at.slice(0, 10)}` : "enabled in .vibegraph/skills.json";
  const ev = r.evidence === "validated" ? "drilled" : "unvalidated — direction, never a gate";
  return `[generic skill ${r.name} v${r.skillVersion}; ${who}; ${ev}; applies because: ${r.appliesOn.join(", ")}]`;
}

// ── M-SKILLS.2 — the boundary, the persistence, and the prompt section ──

/** Task facts for a packet: ONE builder for the objective gate and the
 *  worker spawn, so the retry skill cannot fire at one and not the other.
 *  `priorAttempts` is how many attempts happened BEFORE this one — at the
 *  gate that is `packet.attempts` (nothing has run yet); at spawn it is
 *  `packet.attempts - 1`, because setPacketStatus("running") already
 *  counted the attempt in flight. */
export function packetTaskFacts(p: {
  priorAttempts: number;
  /** The plan's `kind` is nullable on the wire (a pre-M-ORCH.3 run); null reads as a thread packet. */
  kind?: string | null;
  effects?: Record<string, number> | null;
  crossesInto?: string[] | null;
  routedCount: number;
}): TaskFacts {
  return {
    constraintsRouted: p.routedCount > 0,
    effectfulBoundaries: Object.values(p.effects ?? {}).some((n) => n > 0),
    systemPacket: p.kind === "system",
    crossLanguage: (p.crossesInto?.length ?? 0) > 0,
    retry: p.priorAttempts > 0,
  };
}

/** The WS boundary. Only SHIPPED skill names survive, deduplicated; a
 *  name newly enabled is stamped with who enabled it and when, a name
 *  already enabled keeps its original stamp. Anything else in the payload
 *  is dropped, never coerced, so a hand-sent message cannot enable a
 *  skill that does not exist. */
export function sanitiseSkillsConfig(
  raw: unknown,
  known: readonly string[],
  stamp: { source: "human"; id?: string; at: string },
  prev?: SkillsConfig,
): SkillsConfig {
  const r = (raw ?? {}) as { enabled?: unknown };
  const wanted = Array.isArray(r.enabled) ? r.enabled.filter((x): x is string => typeof x === "string") : [];
  const enabled = [...new Set(wanted.filter((n) => known.includes(n)))];
  const enabledBy: NonNullable<SkillsConfig["enabledBy"]> = {};
  for (const n of enabled) enabledBy[n] = prev?.enabledBy?.[n] ?? stamp;
  return { version: "1.0", enabled, ...(enabled.length ? { enabledBy } : {}) };
}

export function saveSkillsConfig(root: string, config: SkillsConfig): void {
  const p = skillsConfigPath(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/** How many threads of a profile a skill applies to: the panel's
 *  "applies to N of M threads here", measured on THIS project rather than
 *  asserted. The retry skill is measured with the retry fact on. */
export function countApplicable(skill: GenericSkill, profile: ProfileLike, task?: TaskFacts): { fires: number; of: number } {
  const ids = Object.keys(profile.threads ?? {});
  const t = task ?? (skill.dimension === "retry" ? { retry: true } : undefined);
  const fires = ids.filter((entryPointId) => evaluatePredicate(skill.applies_when, { profile, entryPointId, task: t })).length;
  return { fires, of: ids.length };
}

export function catalogueOf(skills: GenericSkill[], profile: ProfileLike | null): SkillCatalogueEntry[] {
  return skills.map((s) => ({
    name: s.name, description: s.description, dimension: s.dimension, skillVersion: s.skillVersion,
    evidence: s.evidence, binds: s.binds,
    ...(profile ? countApplicable(s, profile) : { fires: 0, of: 0 }),
  }));
}

/** What a spawn recorded: which skills rode the prompt and, for every
 *  other enabled-or-not skill, why it did not. The prompt is not the
 *  audit; this is. */
export interface GenericSkillAudit { injected: string[]; omitted: Record<string, NonNullable<RoutedGenericSkill["omitted"]>> }
export function auditOf(routed: RoutedGenericSkill[]): GenericSkillAudit {
  const injected = routed.filter((r) => r.skill).map((r) => r.name);
  const omitted: GenericSkillAudit["omitted"] = {};
  for (const r of routed) if (!r.skill && r.omitted) omitted[r.name] = r.omitted;
  return { injected, omitted };
}
export function describeAudit(a: GenericSkillAudit): string {
  const om = Object.entries(a.omitted).map(([n, why]) => `${n} (${why})`).join(", ");
  return `injected: ${a.injected.join(", ") || "(none)"}${om ? `; omitted: ${om}` : ""}`;
}

/** The prompt section — ONE renderer for the worker, the thread agent and
 *  the chat. An injected skill rides with its provenance line; a skill
 *  withheld for budget or already in the session is NAMED, so silence
 *  never reads as "no direction exists" (the M-SKILL.7 rule for thread
 *  skills, kept here). Disabled and not-applicable skills are not
 *  mentioned: the prompt is not the audit. */
export function renderGenericSkillsBlock(routed: RoutedGenericSkill[], config: SkillsConfig): string {
  const shown = routed.filter((r) => r.skill || r.omitted === "over-budget" || r.omitted === "already-in-session");
  if (!shown.length) return "";
  const lines = [
    "Generic direction (enabled for this project by a human; ADVISORY — never a gate; every rule names the check or envelope fact behind it, and a `judgement` rule is exactly that):",
  ];
  for (const r of shown) {
    if (r.skill) lines.push("", genericSkillProvenanceLine(r, config), r.skill.trim());
    else if (r.omitted === "over-budget") lines.push("", `(generic skill ${r.name} applies here but was not injected: over this turn's context budget)`);
    else lines.push("", `(generic skill ${r.name} is already in this session's context — injected on an earlier turn)`);
  }
  return lines.join("\n");
}
