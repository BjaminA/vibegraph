// C1 (PLAN-v6) — thread-skill store. A per-thread, human-RATIFIED context
// artifact: drafted by Claude, reviewed by a human, then authoritative for
// every future agent on that thread. Distinct from the dynamic README
// (readme_store.ts) — a README is an on-request prose summary; a thread-skill
// is structured, ratified, and carries a deterministic honesty block. Distinct
// from .claude/skills/ — that registry is the curated, dispatcher-matched
// global how-to-work-here set; thread-skills are per-artifact annotations.
//
// Lives OUT of the IR (governing rule X5), under
// `<root>/.vibegraph/thread-skills/<slug(entryPointId)>.md`, keyed
// `thread:<entryPointId>`, stamped with `sourceHashOf(threadIR)` so staleness
// is a hash compare at read time (reuses readme_store's hash). Generation only
// ever writes status=draft; a HUMAN flips status to ratified (edits the file).
// A ratified skill whose thread changed reads stale=true but STAYS ratified
// (the human's review is preserved; consumers surface the staleness).
//
// Pure node builtins, no runtime state — every function takes the project root.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sourceHashOf } from "./readme_store.ts";

export { sourceHashOf };

export type SkillStatus = "draft" | "ratified";

/** M-SKILL.7 — one thread step as remembered at stamp time, so a stale
 *  skill can show WHAT changed instead of just "the hash differs". */
export interface ThreadStepSnapshot {
  id: string;
  kind: string;
  label: string;
  file: string | null;
}

export interface StoredThreadSkill {
  key: string;
  entryPointId: string;
  status: SkillStatus;
  body: string;
  sourceHash: string;
  generatedAt: string;
  /** The thread's steps when sourceHash was stamped (absent on pre-M-SKILL.7
   *  files — the diff is then honestly unavailable). */
  snapshot?: ThreadStepSnapshot[];
  /** M-SKILL.7 — human opt-in: keep injecting across code changes (with a
   *  stated caveat) until told otherwise. */
  autoReaffirm?: boolean;
}

export type ThreadSkillResult =
  | (StoredThreadSkill & { exists: true; stale: boolean })
  | { exists: false; key: string; entryPointId: string };

export function threadSkillKey(entryPointId: string): string {
  return `thread:${entryPointId}`;
}

function slug(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function threadSkillPath(root: string, entryPointId: string): string {
  return join(root, ".vibegraph", "thread-skills", `${slug(entryPointId)}.md`);
}

function serialize(r: StoredThreadSkill): string {
  return [
    "---",
    `key: ${r.key}`,
    `entryPointId: ${r.entryPointId}`,
    `status: ${r.status}`,
    `sourceHash: ${r.sourceHash}`,
    `generatedAt: ${r.generatedAt}`,
    ...(r.snapshot ? [`snapshot: ${JSON.stringify(r.snapshot)}`] : []),
    ...(r.autoReaffirm ? ["autoReaffirm: true"] : []),
    "---",
    "",
    r.body.trim(),
    "",
  ].join("\n");
}

function parse(text: string): StoredThreadSkill | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const header = text.slice(3, end).trim();
  const body = text.slice(end + 4).trim();
  const fm: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!fm.entryPointId || !fm.sourceHash) return null;
  // A human ratifies by editing status; anything that isn't exactly "ratified"
  // is treated as draft (fail-safe — never auto-trust an ambiguous value).
  const status: SkillStatus = fm.status === "ratified" ? "ratified" : "draft";
  // Fail-safe parses on the M-SKILL.7 fields too: a mangled snapshot reads
  // as absent (diff honestly unavailable); autoReaffirm only on exact "true".
  let snapshot: ThreadStepSnapshot[] | undefined;
  if (fm.snapshot) {
    try {
      const parsed = JSON.parse(fm.snapshot);
      if (Array.isArray(parsed)) snapshot = parsed;
    } catch { /* absent */ }
  }
  return {
    key: fm.key ?? threadSkillKey(fm.entryPointId),
    entryPointId: fm.entryPointId,
    status,
    sourceHash: fm.sourceHash,
    generatedAt: fm.generatedAt ?? "",
    body,
    ...(snapshot ? { snapshot } : {}),
    ...(fm.autoReaffirm === "true" ? { autoReaffirm: true } : {}),
  };
}

/** Generation writes a fresh DRAFT; only a human edits status to ratified.
 *  A regeneration deliberately DROPS any prior autoReaffirm — the new body
 *  is a new trust decision. */
export function writeThreadSkill(
  root: string,
  entryPointId: string,
  body: string,
  sourceHash: string,
  generatedAt: string,
  status: SkillStatus = "draft",
  snapshot?: ThreadStepSnapshot[],
): string {
  const p = threadSkillPath(root, entryPointId);
  mkdirSync(dirname(p), { recursive: true });
  const record: StoredThreadSkill = {
    key: threadSkillKey(entryPointId), entryPointId, status, body, sourceHash, generatedAt,
    ...(snapshot ? { snapshot } : {}),
  };
  writeFileSync(p, serialize(record));
  return p;
}

export function readStoredThreadSkill(root: string, entryPointId: string): StoredThreadSkill | null {
  const p = threadSkillPath(root, entryPointId);
  if (!existsSync(p)) return null;
  try { return parse(readFileSync(p, "utf-8")); }
  catch { return null; }
}

/** Read the skill tagged with staleness (stored hash vs the thread's current
 *  hash), or a well-formed not-generated result. */
export function getThreadSkill(root: string, entryPointId: string, currentHash: string): ThreadSkillResult {
  const stored = readStoredThreadSkill(root, entryPointId);
  if (!stored) return { exists: false, key: threadSkillKey(entryPointId), entryPointId };
  return { ...stored, exists: true, stale: stored.sourceHash !== currentHash };
}

/** The injection gate: a skill is authoritative context ONLY when a human has
 *  ratified it AND the thread hasn't changed under it. */
export function isAuthoritative(r: ThreadSkillResult): r is StoredThreadSkill & { exists: true; stale: boolean } {
  return r.exists && r.status === "ratified" && !r.stale;
}

// ── M-SKILL.7 — re-affirm + diff + auto-reaffirm ──────────────────────
// A stale ratified skill's guidance may still be accurate; the human gets an
// INFORMED one-click path back to trusted: the card shows what changed since
// the stamp (via the stored snapshot), and Re-affirm re-stamps hash+snapshot
// without regeneration. Auto-reaffirm is a per-skill human opt-in: keep
// injecting across code changes — always with a stated caveat, never
// silently. The strict isAuthoritative predicate is UNCHANGED; injection
// sites use injectableSkillText so the caveat can never be dropped.

const SNAPSHOT_KINDS = new Set(["seed", "step", "external", "dynamic", "unresolved"]);

/** Compact step list for diffing (containers excluded — they mirror steps). */
export function makeThreadSnapshot(threadIR: { nodes?: unknown[] }): ThreadStepSnapshot[] {
  return ((threadIR.nodes ?? []) as Array<Record<string, unknown>>)
    .filter((n) => typeof n.kind === "string" && SNAPSHOT_KINDS.has(n.kind))
    .map((n) => ({
      id: String(n.id ?? ""),
      kind: String(n.kind),
      label: String(n.label ?? ""),
      file: typeof n.file === "string" ? n.file : null,
    }));
}

export interface ThreadSkillDiff {
  added: ThreadStepSnapshot[];
  removed: ThreadStepSnapshot[];
  relabeled: Array<{ id: string; from: string; to: string }>;
}

export function threadSkillDiff(
  stamped: ThreadStepSnapshot[],
  current: ThreadStepSnapshot[],
): ThreadSkillDiff {
  const stampedById = new Map(stamped.map((s) => [s.id, s]));
  const currentById = new Map(current.map((s) => [s.id, s]));
  const added = current.filter((s) => !stampedById.has(s.id));
  const removed = stamped.filter((s) => !currentById.has(s.id));
  const relabeled: ThreadSkillDiff["relabeled"] = [];
  for (const s of stamped) {
    const now = currentById.get(s.id);
    if (now && now.label !== s.label) relabeled.push({ id: s.id, from: s.label, to: now.label });
  }
  return { added, removed, relabeled };
}

/** One-click "still accurate": re-stamps hash + snapshot on a STALE ratified
 *  skill only (body untouched; a fresh or draft skill has nothing to
 *  re-affirm). Returns null when the skill is missing or not stale-ratified. */
export function reaffirmThreadSkill(
  root: string,
  entryPointId: string,
  currentHash: string,
  currentSnapshot: ThreadStepSnapshot[],
): StoredThreadSkill | null {
  const stored = readStoredThreadSkill(root, entryPointId);
  if (!stored || stored.status !== "ratified" || stored.sourceHash === currentHash) return null;
  const record: StoredThreadSkill = { ...stored, sourceHash: currentHash, snapshot: currentSnapshot };
  writeFileSync(threadSkillPath(root, entryPointId), serialize(record));
  return record;
}

/** Human toggle: keep this ratified skill injecting across code changes
 *  (with a stated caveat). Ratified skills only — a draft is never trusted. */
export function setThreadSkillAutoReaffirm(
  root: string,
  entryPointId: string,
  value: boolean,
): StoredThreadSkill | null {
  const stored = readStoredThreadSkill(root, entryPointId);
  if (!stored || stored.status !== "ratified") return null;
  const record: StoredThreadSkill = { ...stored };
  if (value) record.autoReaffirm = true;
  else delete record.autoReaffirm;
  writeFileSync(threadSkillPath(root, entryPointId), serialize(record));
  return record;
}

export const AUTO_REAFFIRM_CAVEAT =
  "(Caveat: this skill is auto-re-affirmed — the thread's code has CHANGED since a human last reviewed it. Verify its claims against the current code before relying on them.)";

/** The ONE injection gate for prompts: authoritative body, or a stale
 *  ratified body the human opted into auto-reaffirm — then ALWAYS with the
 *  caveat appended, never silently. Drafts never inject. */
export function injectableSkillText(r: ThreadSkillResult): string | null {
  if (!r.exists || r.status !== "ratified") return null;
  if (!r.stale) return r.body;
  return r.autoReaffirm ? `${r.body}\n\n${AUTO_REAFFIRM_CAVEAT}` : null;
}

/** M-SKILL.3 — human ratification via the UI: the ONLY sanctioned status
 *  writer. Flips status ONLY; body / sourceHash / generatedAt untouched —
 *  ratifying a draft generated against an older thread yields ratified+stale,
 *  honestly (the human reviewed THAT body against THAT thread version).
 *  Returns the updated record, or null when no stored skill exists. */
export function ratifyThreadSkill(root: string, entryPointId: string): StoredThreadSkill | null {
  const stored = readStoredThreadSkill(root, entryPointId);
  if (!stored) return null;
  const record: StoredThreadSkill = { ...stored, status: "ratified" };
  writeFileSync(threadSkillPath(root, entryPointId), serialize(record));
  return record;
}
