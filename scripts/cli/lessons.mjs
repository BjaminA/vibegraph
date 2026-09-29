// Lessons (2026-09-29) — what the hooks saw a session get wrong, and how the
// session put it right. From the OpenViking review: its "experience" memory
// turns a finished session into rules a MODEL wrote and injects them next
// time unreviewed. Here the raw material is recorded deterministically and
// nothing is injected from it:
//
//   the post-edit / stop hooks record an EPISODE when a violation they
//   blocked stops being reported — the rule, its reason, the offending call,
//   and the working-tree diff of that file at the moment it cleared (so the
//   diff shows the session's whole change to the file, not only the fix —
//   said on every episode);
//   `lessons list` shows them;
//   `skills draft <entry>` hands a thread's episodes to the drafting prompt,
//   so a skill a person then ratifies can carry "this was broken, and this is
//   how it was put right". That is the only way a lesson reaches a future
//   session: through the draft gate and a human ratification.
//
// Stored per user beside the envelope cache (~/.cache), never in the project:
// the hooks write nothing to the project. Named limit: clearing the cache
// clears the lessons.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { cacheDirFor } from "../envelope_cache.mjs";

export const LESSONS_USAGE = `lessons list [<root>] [--json]   what the hooks saw sessions break and put right (zero tokens);
                                  \`skills draft\` hands a thread's lessons to the drafting prompt`;

const DIFF_CAP = 1600;

export function lessonsFile(absRoot) {
  return join(cacheDirFor(absRoot), "lessons.jsonl");
}

/** The working-tree diff of one file against HEAD, capped; null outside git. */
export function fileDiff(absRoot, file) {
  try {
    const d = execFileSync("git", ["diff", "--no-color", "-U2", "HEAD", "--", file], { cwd: absRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    if (!d.trim()) return null;
    return d.length > DIFF_CAP ? `${d.slice(0, DIFF_CAP)}\n… (${d.length - DIFF_CAP} more characters of diff)` : d;
  } catch {
    return null;
  }
}

export function appendLesson(absRoot, episode) {
  const path = lessonsFile(absRoot);
  mkdirSync(join(path, ".."), { recursive: true });
  appendFileSync(path, JSON.stringify(episode) + "\n");
}

export function readLessons(absRoot) {
  const path = lessonsFile(resolve(absRoot));
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped, never guessed */ }
  }
  return out;
}

/** The file a `file:node` offender names. */
export const offenderFile = (offender) => (typeof offender === "string" && offender.includes(":") ? offender.slice(0, offender.indexOf(":")) : null);

/** Episodes that concern one thread: a rule routed to it, on a file it walks. */
export function lessonsForThread(lessons, { routedIds, filesReached }) {
  const ids = new Set(routedIds), files = new Set(filesReached);
  return lessons.filter((l) => ids.has(l.ruleId) && (!l.file || files.has(l.file)));
}

/** The block the skill-drafting prompt receives. Empty string when none. */
export function lessonsBlock(lessons) {
  if (!lessons.length) return "";
  const lines = [
    "",
    "Recent episodes on this thread, recorded by the VibeGraph hooks (facts, not advice): a stated rule was",
    "broken by an edit, the edit was stopped, and the session then changed the code until the rule held again.",
    "Where one teaches something the rules alone do not say, put it in `## Gotchas` or `## Rules and why` —",
    "in your words, citing node ids from the step list. Each diff is the whole working-tree change to that",
    "file when the rule cleared, not only the fix.",
  ];
  for (const l of lessons.slice(-6)) {
    lines.push(`- rule ${l.ruleId} (${l.check}): broken at ${l.offender ?? l.file ?? "?"} — ${l.reason}`);
    if (l.diff) lines.push("```diff", l.diff.trimEnd(), "```");
  }
  return lines.join("\n");
}

export function runLessons({ root, json = false }) {
  const absRoot = resolve(root);
  const all = readLessons(absRoot);
  if (json) return { text: JSON.stringify(all, null, 2) + "\n", exitCode: 0 };
  if (!all.length) {
    return { text: `No lessons recorded for ${absRoot}. They appear when a hook (\`init --hooks\`) stops an edit that breaks a stated rule and the session then puts it right.\n`, exitCode: 0 };
  }
  const byRule = new Map();
  for (const l of all) { if (!byRule.has(l.ruleId)) byRule.set(l.ruleId, []); byRule.get(l.ruleId).push(l); }
  const lines = [`${all.length} episode(s) in ${lessonsFile(absRoot)}`, ""];
  for (const [id, ls] of byRule) {
    lines.push(`[${id}] ${ls[0].ruleText ?? ls[0].check} — broken and put right ${ls.length} time(s)`);
    for (const l of ls.slice(-5)) lines.push(`    ${l.at}  ${l.offender ?? l.file ?? "?"}${l.diff ? "" : "  (no diff: not a git repository, or the file matches HEAD)"}`);
  }
  lines.push("", "A rule broken again and again is one the code does not make obvious: consider a thread skill that carries",
    "its reason (`skills draft <entry>` now reads these episodes) or a clearer name at the call site.");
  return { text: lines.join("\n") + "\n", exitCode: 0 };
}
