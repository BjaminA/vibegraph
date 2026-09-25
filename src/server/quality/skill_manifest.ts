// Quality layer, Run 3: the skill-manifest DERIVER. Pure over a thread
// skill file's text (thread_skill_store.ts's frontmatter + body) and the
// constraint store. Reads the `## Rules and why` section (M-WHY) bullet
// by bullet: a bullet becomes a Rule only when it states a why AND cites
// at least one IR node; anything else lands in `omitted` with its line
// and reason, because a rule without its why or its nodes is exactly the
// prose the manifest exists to escape. The status is the file's; a
// human ratifies by editing the file, as today.

import { NODE_REF } from "./check_registry.ts";

interface ConstraintLike { id: string; check?: { rule: string }; checks?: { rule: string }[] }
interface Rule {
  id: string; text: string; why: string; nodes: string[]; source: "constraint" | "worker-draft" | "human";
  boundTo?: { constraintId: string; rule: string };
}
export interface SkillManifest {
  version: "1.0";
  entryPointId: string;
  status: "draft" | "ratified";
  stamp: { sourceHash: string; rulesHash: string | { unknown: true; reason: string }; snapshotPresent: boolean };
  rules: Rule[];
  omitted: Array<{ line: number; reason: string }>;
  staling: Array<{ on: string; action: "stale"; reaffirm: "human" | "auto-with-caveat" }>;
  provenance: { kind: "derived"; by: string; commit: string; at: string };
}

const BY = "src/server/quality/skill_manifest.ts";
const NODE_IN_TEXT = /[A-Za-z0-9_./-]+\.[A-Za-z]+:module(?:\/[^\s,;)\]`]+)*/g;
const WHY_SPLIT = /\s+[—–-]+\s*(?:why|because|reason)\s*:?\s+|\s+because\s+|\s+why:\s+|\s+reason:\s+|\s+so that\s+/i;

export function deriveSkillManifest(text: string, constraints: ConstraintLike[], opts: { commit: string }): { manifest: SkillManifest | null; notes: string[] } {
  const notes: string[] = [];
  if (!text.startsWith("---")) return { manifest: null, notes: ["not a skill file: no frontmatter"] };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { manifest: null, notes: ["not a skill file: unterminated frontmatter"] };
  const fm: Record<string, string> = {};
  for (const line of text.slice(3, end).trim().split("\n")) {
    const i = line.indexOf(":"); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!fm.entryPointId || !fm.sourceHash) return { manifest: null, notes: ["not a skill file: no entryPointId or sourceHash"] };
  const bodyStart = end + 4;
  const lines = text.split("\n");
  const bodyLine0 = text.slice(0, bodyStart).split("\n").length; // 1-based line of the body's first line
  // The rules section: from a `## Rules and why` heading to the next `## `.
  const headingIdx = lines.findIndex((l, i) => i >= bodyLine0 - 1 && /^##\s+rules and why/i.test(l.trim()));
  const rules: Rule[] = [];
  const omitted: SkillManifest["omitted"] = [];
  if (headingIdx === -1) notes.push("no `## Rules and why` section: the skill predates M-WHY or drafted without routed constraints");
  else {
    const bullets: { line: number; text: string }[] = [];
    for (let i = headingIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^##\s/.test(l)) break;
      if (/^\s*(?:[-*]|\d+\.)\s+/.test(l)) bullets.push({ line: i + 1, text: l.replace(/^\s*(?:[-*]|\d+\.)\s+/, "") });
      else if (bullets.length && l.trim()) bullets[bullets.length - 1].text += " " + l.trim();
    }
    const byId = new Map(constraints.map((c) => [c.id, c]));
    bullets.forEach((b, n) => {
      const plain = b.text.replace(/\*\*/g, "").trim();
      const nodes = [...new Set([...plain.matchAll(NODE_IN_TEXT)].map((m) => m[0].replace(/[.,;:]+$/, "")).filter((x) => NODE_REF.test(x)))];
      const parts = plain.split(WHY_SPLIT);
      if (parts.length < 2 || !parts[1].trim()) { omitted.push({ line: b.line, reason: "no why stated (no `because` / `why:` / `reason:` clause)" }); return; }
      if (!nodes.length) { omitted.push({ line: b.line, reason: "no IR node cited (file:module/... reference)" }); return; }
      const cited = plain.match(/\bc\d+\b/g) ?? [];
      const constraintId = cited.find((id) => byId.has(id));
      const rule: Rule = {
        id: `r${n + 1}`, text: parts[0].trim(), why: parts.slice(1).join(" ").trim(), nodes,
        source: constraintId ? "constraint" : "worker-draft",
      };
      if (constraintId) {
        const c = byId.get(constraintId)!;
        const first = c.checks?.[0] ?? c.check;
        if (first) rule.boundTo = { constraintId, rule: first.rule };
      }
      rules.push(rule);
    });
  }
  const manifest: SkillManifest = {
    version: "1.0",
    entryPointId: fm.entryPointId,
    status: fm.status === "ratified" ? "ratified" : "draft",
    stamp: {
      sourceHash: fm.sourceHash,
      rulesHash: fm.rulesHash ?? { unknown: true, reason: "the file carries no rulesHash (stamped before M-WHY, or the store did not write one)" },
      snapshotPresent: !!fm.snapshot,
    },
    rules,
    omitted,
    staling: [
      { on: "step-changed", action: "stale", reaffirm: fm.autoReaffirm === "true" ? "auto-with-caveat" : "human" },
      { on: "rule-changed", action: "stale", reaffirm: "human" },
      { on: "constraint-contradiction", action: "stale", reaffirm: "human" },
      { on: "bound-constraint-removed", action: "stale", reaffirm: "human" },
    ],
    provenance: { kind: "derived", by: BY, commit: opts.commit, at: new Date().toISOString() },
  };
  return { manifest, notes };
}
