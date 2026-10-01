// The session-start ORIENTATION a hooked Claude Code session receives: the
// project in one line, every stated rule in one line each, the ratified
// skills, the generic direction in force, and where the knowledge folder is.
// Moved out of hooks.mjs (2026-09-30) to keep that file under 500 lines.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { readStoredThreadSkill } from "../../src/server/thread_skill_store.ts";
import { derivedPolicyClauses } from "../../src/server/policy_check.ts";
import { enabledDirection } from "./direction.mjs";
import { docsStatus } from "../../src/server/docs_registry.ts";
import { loadPlan } from "../../src/server/plan_store.ts";
import { backlogCount, planBacklog } from "../../src/server/plan_review.ts";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function orientation(absRoot, loaded, constraints) {
  const env = loaded.envelope;
  const langs = new Map();
  for (const ir of Object.values(env.files)) langs.set(ir.language ?? "?", (langs.get(ir.language ?? "?") ?? 0) + 1);
  const kinds = new Map();
  for (const e of env.entryPoints) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const lines = [
    `This project: ${plural(Object.keys(env.files).length, "parsed source file")} (${[...langs].map(([l, n]) => `${n} ${l}`).join(", ")}); `
      + `${plural(env.entryPoints.length, "entry point")} (${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(", ")}), `
      + `each traced forward as a thread across files.`,
  ];
  if (constraints.length) {
    lines.push("", `Stated rules (${constraints.length}) — from the people who run this code, with their reasons; the checkable ones are re-checked after every edit and a new violation stops the edit:`);
    let used = 0, shown = 0;
    for (const c of constraints) {
      const checks = [...(c.checks ?? []), ...(c.check ? [c.check] : [])].map((x) => x?.rule).filter(Boolean);
      if (derivedPolicyClauses(c, env.files).length) checks.push(`policy ${c.policy.rule}`);
      const who = c.source && c.source !== "human" ? ` · ${c.source}-stated` : "";
      const text = c.text.length > 240 ? `${c.text.slice(0, 237)}…` : c.text;
      const line = `- [${c.id} · ${c.kind}${who}] ${text}${checks.length ? ` (checked: ${checks.join(", ")})` : ""}`;
      if (used + line.length > 5200) break;
      lines.push(line); used += line.length; shown++;
    }
    if (shown < constraints.length) lines.push(`- … ${constraints.length - shown} more: \`vibegraph-knowledge constraints list\``);
  } else {
    lines.push("", "No stated rules yet (`vibegraph-knowledge constraints add` records one, with its reason).");
  }
  const skills = { ratified: [], draft: 0 };
  for (const t of env.threads) {
    if (!t.entryPointId) continue;
    const s = readStoredThreadSkill(absRoot, t.entryPointId);
    if (s?.status === "ratified") skills.ratified.push(t.entryPointId);
    else if (s) skills.draft++;
  }
  lines.push("", skills.ratified.length
    ? `Ratified thread skills (${skills.ratified.length}): ${skills.ratified.slice(0, 12).join(", ")}${skills.ratified.length > 12 ? ", …" : ""} — each arrives when a prompt names its thread.${skills.draft ? ` ${skills.draft} draft(s) await ratification.` : ""}`
    : `No ratified thread skills${skills.draft ? ` (${skills.draft} draft(s) await ratification)` : ""}.`);
  const dir = enabledDirection(absRoot);
  if (dir && dir.mode !== "off") lines.push(`Generic direction enabled: ${dir.skills.map((s) => s.name).join(", ")} — ${dir.mode === "headlines" ? "rule headlines arrive with a thread they apply to" : "a rule's why arrives when its check fires"}; \`vibegraph-knowledge direction <skill>\` has each rule's why.`);
  const readme = join(absRoot, ".vibegraph", "knowledge", "README.md");
  if (existsSync(readme)) {
    const hours = Math.round((Date.now() - statSync(readme).mtimeMs) / 3_600_000);
    lines.push(`Knowledge folder: .vibegraph/knowledge/README.md (exported ${hours < 1 ? "within the hour" : `${hours} h ago`}; architecture.md is the one-page map).`);
  } else {
    lines.push("No knowledge folder yet — `vibegraph-knowledge export` writes the architecture map, one contract per thread and the rules.");
  }
  // 2026-10-01 — proposals waiting on a person (plan items, an objective, rule changes).
  const plan = (() => { try { return loadPlan(absRoot); } catch { return null; } })();
  const backlog = plan && !plan.closed ? backlogCount(planBacklog(plan, null, constraints)) : constraints.reduce((n, c) => n + (c.proposals?.length ?? 0), 0);
  if (backlog) lines.push("", `Review backlog: ${backlog} proposal${backlog === 1 ? "" : "s"} await a person — \`vibegraph-knowledge plan review\` lists them with their diffs (deciding is the person's, not yours).`);
  // 2026-10-01 — generated documents whose inputs changed since they were generated.
  const stale = docsStatus(absRoot).filter((r) => r.state === "stale");
  if (stale.length) lines.push("", `Stale generated documents (${stale.length}) — do not trust them as current: ${stale.slice(0, 6).map((r) => `${r.doc.path} (${r.since === "the working tree" ? "inputs changed in the working tree" : `since ${r.since}`}; regenerate: ${r.doc.generator})`).join("; ")}${stale.length > 6 ? "; …" : ""}.`);
  lines.push("", "How this session is wired: name a function or file in a prompt to get its thread's contract, rules and skill; an edit that breaks a checkable rule is stopped with the rule and its reason.");
  return lines.join("\n");
}
