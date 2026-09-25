// `vibegraph-knowledge skills` (2026-09-25) — THREAD SKILLS from the command
// line: per-thread guidance a model drafts, a person ratifies, and the export
// copies to a plain Claude (only ratified and fresh, or ratified with the
// auto-reaffirm opt-in). Until now a skill could only be drafted and ratified
// in the GUI or over MCP, so a project handed over by the CLI alone carried
// none.
//
//   skills list [<root>]
//   skills draft <entry id>... | --missing [<root>] [--dry-run] [--reply <file>] [--model <id>]   SPENDS TOKENS
//   skills ratify <entry id> [<root>]            the draft becomes ratified — whoever runs this reviewed it
//   skills reaffirm <entry id> [<root>]          a stale ratified skill is still accurate: re-stamp it
//   skills auto-reaffirm <entry id> on|off [<root>]
//
// Freshness is computed exactly as the export reads it (scripts/thread_context.mjs:
// the thread's code AND the rules routed to it). Drafting uses the server's
// own prompt and gates (src/server/thread_skill_draft.ts): at least one real
// IR node cited and none invented, the four sections, the injection budget;
// a draft that fails is reported and not written. The model is spawned like
// `classify`'s: no MCP servers, no write tools.
import { readFileSync } from "node:fs";
import { loadConstraints } from "../../src/server/constraint_store.ts";
import {
  getThreadSkill, makeThreadSnapshot, ratifyThreadSkill, reaffirmThreadSkill, setThreadSkillAutoReaffirm, writeThreadSkill,
} from "../../src/server/thread_skill_store.ts";
import { draftThreadSkill, threadSkillPrompt } from "../../src/server/thread_skill_draft.ts";
import { loadEnvelope } from "../quality_check.mjs";
import { threadContexts } from "../thread_context.mjs";
import { spawnClassifier } from "./classify.mjs";

export const SKILLS_USAGE = `skills list|draft|ratify|reaffirm|auto-reaffirm [...]   per-thread skills (.vibegraph/thread-skills/)
      list [<root>]
      draft <entry id>... | --missing [<root>]   SPENDS TOKENS (one model call per skill, a retry if it cites
                           an id that does not exist); written as a DRAFT, never ratified
          --dry-run  print the prompt, spawn nothing · --reply <file> use a saved reply · --model <id>
      ratify <entry id> [<root>]      the draft becomes ratified (whoever runs this reviewed it)
      reaffirm <entry id> [<root>]    a stale ratified skill is still accurate: re-stamp it
      auto-reaffirm <entry id> on|off [<root>]   keep a ratified skill injecting across code changes, with a caveat`;

function stateOf(s) {
  if (!s.exists) return "none";
  if (s.status !== "ratified") return "draft (not injected until ratified)";
  if (!s.stale) return `ratified${s.ratifiedBy?.kind === "model" ? ` by a model (${s.ratifiedBy.model})` : ""} · fresh`;
  return s.autoReaffirm ? "ratified · STALE, injected with the auto-reaffirm caveat" : "ratified · STALE, withheld (reaffirm it, or redraft)";
}

/** @returns {Promise<{ lines: string[], messages: string[], exitCode: number }>} */
export async function runSkills({ root, sub, targets, values, envelope, pipeline, env = process.env }) {
  const lines = [];
  const messages = [];
  const known = ["list", "draft", "ratify", "reaffirm", "auto-reaffirm"];
  if (!known.includes(sub)) return { lines, messages: [`unknown skills subcommand: ${sub ?? "(none)"} — ${known.join(", ")}`], exitCode: 2 };
  const { envelope: envl } = loadEnvelope(root, envelope, pipeline ?? {});
  const ctx = threadContexts(envl, root, loadConstraints(root));
  const need = (ep) => {
    const c = ctx.byEntry.get(ep);
    if (!c) messages.push(`no thread for entry point ${ep} (see \`skills list\`)`);
    return c;
  };

  if (sub === "list") {
    let n = 0;
    for (const [ep, c] of ctx.byEntry) {
      const s = getThreadSkill(root, ep, c.stamp);
      if (s.exists) n++;
      lines.push(`${stateOf(s).padEnd(40)} ${ep}${c.routed.length ? `  (${c.routed.length} rule${c.routed.length === 1 ? "" : "s"} routed)` : ""}`);
    }
    lines.push(`${ctx.byEntry.size} threads, ${n} with a skill`);
    return { lines, messages, exitCode: 0 };
  }

  if (sub === "draft") {
    const eps = values.missing
      ? [...ctx.byEntry.keys()].filter((ep) => !getThreadSkill(root, ep, ctx.byEntry.get(ep).stamp).exists)
      : targets;
    if (!eps.length) return { lines, messages: [values.missing ? "every thread already has a skill" : "draft needs entry ids, or --missing"], exitCode: values.missing ? 0 : 2 };
    const knownIds = new Set(Object.values(envl.files).flatMap((ir) => (ir.nodes ?? []).map((n) => n.id)));
    const effectKindFor = (file, id) => {
      if (!id) return null;
      const n = (file ? [envl.files[file]] : Object.values(envl.files)).flatMap((ir) => ir?.nodes ?? []).find((x) => x.id === id);
      return typeof n?.effectKind === "string" ? n.effectKind : null;
    };
    const saved = values.reply ? readFileSync(values.reply, "utf-8") : null;
    let failed = 0;
    for (const ep of eps) {
      const c = need(ep);
      if (!c) { failed++; continue; }
      if (values["dry-run"]) { lines.push(`── prompt for ${ep} ──`, threadSkillPrompt(ep, c.thread, c.rulesBlock)); continue; }
      let label = saved ? "saved reply" : null;
      if (!saved) messages.push(`drafting ${ep} (this spends tokens)`);
      const r = await draftThreadSkill({
        entryPointId: ep, ir: c.thread, rulesBlock: c.rulesBlock, knownIds, effectKindFor,
        runLlm: async (prompt) => {
          if (saved) return saved;
          const out = spawnClassifier({ prompt, model: values.model, cwd: root, env });
          if (!out.ok) { messages.push(out.error); return null; }
          label = out.model;
          return out.text;
        },
      });
      if (!r.ok) { failed++; lines.push(`${ep}: NOT written — ${r.error}`); continue; }
      writeThreadSkill(root, ep, r.body, c.stamp, new Date().toISOString(), "draft", makeThreadSnapshot(c.thread));
      lines.push(`${ep}: drafted by ${label} — a DRAFT; review it, then \`skills ratify ${ep}\``);
    }
    return { lines, messages, exitCode: failed ? (failed === eps.length ? 3 : 1) : 0 };
  }

  const ep = targets[0];
  if (!ep) return { lines, messages: [`${sub} needs an entry id (see \`skills list\`)`], exitCode: 2 };
  const c = need(ep);
  if (!c) return { lines, messages, exitCode: 1 };
  if (sub === "ratify") {
    const cur = getThreadSkill(root, ep, c.stamp);
    if (!cur.exists) return { lines, messages: [`${ep} has no skill to ratify — draft one first`], exitCode: 1 };
    if (cur.status === "ratified") return { lines, messages: [`${ep} is already ratified (${stateOf(cur)})`], exitCode: 1 };
    ratifyThreadSkill(root, ep, { kind: "human" });
    lines.push(`${ep}: ratified by whoever ran this — ${stateOf(getThreadSkill(root, ep, c.stamp))}; the next export copies it`);
    return { lines, messages, exitCode: 0 };
  }
  if (sub === "reaffirm") {
    const r = reaffirmThreadSkill(root, ep, c.stamp, makeThreadSnapshot(c.thread));
    if (!r) return { lines, messages: [`${ep}: nothing to re-affirm — ${stateOf(getThreadSkill(root, ep, c.stamp))}`], exitCode: 1 };
    lines.push(`${ep}: re-affirmed against the current code and rules — fresh`);
    return { lines, messages, exitCode: 0 };
  }
  // auto-reaffirm
  const on = targets[1];
  if (on !== "on" && on !== "off") return { lines, messages: ["auto-reaffirm needs on or off"], exitCode: 2 };
  const r = setThreadSkillAutoReaffirm(root, ep, on === "on");
  if (!r) return { lines, messages: [`${ep}: auto-reaffirm applies to a ratified skill only`], exitCode: 1 };
  lines.push(`${ep}: auto-reaffirm ${on}`);
  return { lines, messages, exitCode: 0 };
}
