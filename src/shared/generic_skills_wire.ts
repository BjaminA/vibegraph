// M-SKILLS.2 — the wire shapes for generic skills, webview-safe (no node
// imports). The server reads skills/<name>/SKILL.md and the project's
// .vibegraph/skills.json; the webview only ever sees these.

/** What Claude is told about one direction item — a generic skill or one of
 *  the project's agreed rules (2026-10-20, replacing one hooks mode for the
 *  whole page). Both off = not used, the default.
 *    upfront  its rules once per session, when a prompt reaches a thread it
 *             applies to (a generic skill also reaches the chat panel,
 *             workers and thread agents in full);
 *    onCheck  the rule and its reason, beside the finding, when an edit
 *             trips the check it is bound to. */
export interface Delivery { upfront: boolean; onCheck: boolean }

export const DELIVERY_OFF: Delivery = { upfront: false, onCheck: false };

/** The per-project enable file. Off by default: nothing injects that a
 *  human did not choose, and enabling carries who and when. */
export interface SkillsConfig {
  version: "1.0";
  /** the skills in use (either switch on) — kept for readers that predate `delivery` */
  enabled: string[];
  enabledBy?: Record<string, { source: "human"; id?: string; at: string }>;
  /** per skill: what Claude is told (readSkillsConfig fills it for every enabled skill) */
  delivery?: Record<string, Delivery>;
  /** LEGACY (2026-09-29): one mode for the whole page. Read, never written by
   *  the panel: it decides the starting switches of a skill or agreed project
   *  rule that has none of its own. */
  hooks?: "headlines" | "on-violation" | "off";
}

/** The switches a legacy hooks mode meant: headlines sent both, on-violation
 *  only the why, off nothing. */
export function legacyDelivery(mode: SkillsConfig["hooks"]): Delivery {
  return mode === "off" ? { ...DELIVERY_OFF } : mode === "on-violation" ? { upfront: false, onCheck: true } : { upfront: true, onCheck: true };
}

/** A generic skill's switches. */
export function skillDelivery(config: SkillsConfig, name: string): Delivery {
  return config.delivery?.[name] ?? (config.enabled.includes(name) ? legacyDelivery(config.hooks) : { ...DELIVERY_OFF });
}

export const deliveryInUse = (d: Delivery): boolean => d.upfront || d.onCheck;

/** One shipped skill as the Skills panel lists it — never the body (the
 *  body is what injects; the panel decides whether it may). `fires`/`of`
 *  is the skill's applies_when MEASURED on this project's stack profile. */
export interface SkillCatalogueEntry {
  name: string;
  description: string;
  dimension: string;
  skillVersion: string;
  evidence: "unvalidated" | "validated";
  binds: string[];
  fires: number;
  of: number;
  /** its rules, one line each — what "up front" sends */
  rules?: string[];
}

/** Sent on connect and after every change (the `model-tiers` shape). */
export interface SkillsConfigPayload {
  config: SkillsConfig;
  catalogue: SkillCatalogueEntry[];
}
