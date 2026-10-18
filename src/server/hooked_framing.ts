// The Agent Manager run's FRAMING (2026-10-16, from a review: the run was a
// raw task in one `claude -p` call — nothing told the session the project's
// objective, what waits for a person, which VibeGraph tools exist or when to
// use them, or that it could ask the person anything). Appended to Claude
// Code's own system prompt; the hooks still deliver the per-thread knowledge
// as the conversation names code. Deterministic and short: facts the project
// states, said as they are, never a model's summary.

import { loadPlan } from "./plan_store.ts";
import { loadConstraints, statedRules } from "./constraint_store.ts";
import { buildInbox } from "./inbox.ts";
import { readSkillsConfig } from "./generic_skills.ts";
import type { HookedRunFacts } from "../shared/hooked_run_wire.ts";
import { loadDirection } from "./project_direction.ts";

/** The MCP tools that spend tokens, start other agents or draft for a person:
 *  not for an unattended worker (its own reasoning is the session). */
export const RUN_DENIED_MCP = [
  "vibegraph_propose_architecture", "vibegraph_scope_node", "vibegraph_spawn_thread_agent", "vibegraph_start_work_run",
  "vibegraph_sweep_thread_skills", "vibegraph_generate_thread_skill", "vibegraph_generate_readme", "vibegraph_explain_node",
].map((t) => `mcp__vibegraph__${t}`);

export type FramingFacts = HookedRunFacts;

export function framingFacts(root: string): FramingFacts {
  const plan = (() => { try { return loadPlan(root); } catch { return null; } })();
  let waiting = 0;
  try { waiting = buildInbox(root).length; } catch { waiting = 0; }
  let direction: string[] = [];
  try { direction = readSkillsConfig(root).config.enabled; } catch { direction = []; }
  return {
    objective: plan?.objective ?? null,
    rules: (() => { try { return statedRules(loadConstraints(root)).length; } catch { return 0; } })(), // tool classifications are not rules
    waiting,
    openQuestions: (plan?.open ?? []).map((q) => ({ id: q.id, text: q.text })),
    direction,
    projectDirection: (() => { try { return loadDirection(root).rules.filter((r) => r.status === "agreed").length; } catch { return 0; } })(),
  };
}

export function runFraming(f: FramingFacts): string {
  const L = [
    "You are working in a project VibeGraph analyses. The person who started this run watches it in VibeGraph's Agent Manager and can answer you; it stays one conversation until they finish it.",
    "",
    "HOW THIS RUN WORKS",
    "- VibeGraph's hooks add to your context as you go: the contract, stated rules and ratified skill of each thread your messages name, the plan, the Brief, and a check after every edit. A NEW break of a stated rule blocks the edit: fix the code. Never edit .vibegraph/ to get past a rule — propose a re-scope (`vibegraph-knowledge constraint propose`) and say so; a change there is shown to the person as a change to what the project states.",
    "- When a decision is the person's — a requirement the task leaves open, a rule that seems wrong, a change that is risky or hard to undo — ask it: put each question on its own line starting `QUESTION:` and end your turn. They answer here and you continue in the same session. Do not guess where a question is cheaper.",
    "- When you are done, say in a few lines what you changed and what you did not. VibeGraph collects the evidence itself (diffs, the rule checks before and after, the tests that reach the change); the person accepts or rejects it.",
    "",
    "VIBEGRAPH TOOLS (the vibegraph MCP server) — reach for these before reading many files:",
    "- vibegraph_thread_brief: one call for a thread — its contract, then its primary functions verbatim.",
    "- vibegraph_thread_contract / vibegraph_list_entry_points: what a thread takes in, gives out and leaves the project through.",
    "- vibegraph_coverage: whether files are parsed, reached by threads and tests, configured — check it before calling code unused or untested.",
    "- vibegraph_blast_radius: what an edit to a function reaches.",
    "- vibegraph_dataflow: untrusted input reaching a shell, SQL or eval.",
    "- vibegraph_plan / vibegraph_plan_edit: the design plan; your edits land PROPOSED for the person.",
    "- vibegraph_direction: the full rules and reasons of an enabled direction skill.",
    "- vibegraph_investigation: the person's pinned nodes and notes, if they made one for this work.",
    "",
    "THE PROJECT NOW",
    `- Objective: ${f.objective ? `"${f.objective}"` : "none stated (no plan)"}.`,
    `- ${f.rules} stated rule${f.rules === 1 ? "" : "s"}${f.rules ? " — the hooks send each one with the thread it applies to" : ""}.`,
    f.waiting ? `- ${f.waiting} decision${f.waiting === 1 ? " waits" : "s wait"} for a person (proposals, drafts). Do not decide them; mention one only if your work depends on it.` : "",
    f.openQuestions.length ? `- Open plan questions — if your work answers one, say so (the person closes it):\n${f.openQuestions.slice(0, 6).map((q) => `  - ${q.id}: ${q.text.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")}` : "",
    f.direction.length ? `- Direction enabled: ${f.direction.join(", ")} — its rule headlines arrive with the threads they apply to.` : "",
    f.projectDirection ? `- ${f.projectDirection} agreed rule${f.projectDirection === 1 ? "" : "s"} of this project's own direction — each arrives with the threads it is about; going against one brings a note with its why.` : "",
  ];
  return L.filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n").trim();
}
