// M-SKILLS.2 — the wire shapes for generic skills, webview-safe (no node
// imports). The server reads skills/<name>/SKILL.md and the project's
// .vibegraph/skills.json; the webview only ever sees these.

/** The per-project enable file. Off by default: nothing injects that a
 *  human did not choose, and enabling carries who and when. */
export interface SkillsConfig {
  version: "1.0";
  enabled: string[];
  enabledBy?: Record<string, { source: "human"; id?: string; at: string }>;
}

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
}

/** Sent on connect and after every change (the `model-tiers` shape). */
export interface SkillsConfigPayload {
  config: SkillsConfig;
  catalogue: SkillCatalogueEntry[];
}
