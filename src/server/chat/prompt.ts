// M26.3 — pure chat-prompt assembly (PLAN-M26 §M26.3).
//
// handleChat (server.ts) used to frame every conversation as "the user
// is editing this file: <activeFile>" — a single-file lens that misled
// the agent in thread view, where the conversation is about a CROSS-FILE
// flow, and risked edits landing in the wrong file. This module owns the
// prompt text; the caller does all the impure work (findNode /
// findNodeFile lookups, source snippets, latestThreads) and hands plain
// data in, so the unit test (test/chat_prompt.test.mjs) can pin the
// framing without booting a server.

import type { RoutedThreadContext } from "../thread_remit.ts";

/** Selected-node context, already resolved by the caller. `file` is the
 * node's TRUE file (findNode hit, or findNodeFile fallback) in the
 * relative wire format; null means the lookup failed entirely — the
 * block is still emitted so the id is never silently dropped. */
export interface ChatNodeContext {
  nodeId: string;
  file: string | null;
  type?: string;
  line?: number;
  endLine?: number;
  source?: string | null;
}

/** The thread the user is looking at (ChatPanel sends threadEntryPointId;
 * the caller resolves it against latestThreads). `nodes` in extraction
 * order, the shape extract_thread.py emits. */
export interface ChatThreadContext {
  qualifiedName: string;
  seedFile: string;
  nodes: Array<{ id: string; kind: string; label: string; file: string | null }>;
  // C1 (PLAN-v6) — the RATIFIED, fresh thread-skill body, when one exists. The
  // caller resolves it (getThreadSkill + isAuthoritative); draft/stale skills
  // are never passed here, so the prompt only ever injects authoritative
  // context. Absent when no ratified-fresh skill exists.
  skill?: string | null;
  // M-TRAINED.4 — artifact-state notes for THIS thread (missing/stale
  // artifacts it consumes, with their producers). Deterministic IR+fs fact,
  // resolved by the caller; absent when everything is present and fresh.
  artifacts?: string[];
}

export interface ChatPromptArgs {
  userText: string;
  /** File the user is viewing; relative in directory mode. */
  activeFile: string | null;
  /** Relative file list (the keys vibegraph_list_files returns); empty
   * in single-file mode. */
  projectFiles: string[];
  node: ChatNodeContext | null;
  thread: ChatThreadContext | null;
  /** M-SKILL.2 — remit-routed threads (never the active one). Empty/absent
   * when the question matched nothing: the prompt is then byte-identical
   * to the pre-routing shape. */
  routed?: RoutedThreadContext[];
}

const STEP_KINDS = new Set(["seed", "step"]);
const TERMINAL_KINDS = new Set(["external", "dynamic", "unresolved"]);

// M28.3 — the node's place in the thread flow ("step N of M"), the
// genuinely useful "coordinate" beyond its raw file/line span. Returns ""
// when the node isn't one of the thread's ordered steps (e.g. a terminal,
// or a selection outside this thread).
function stepPosition(node: ChatNodeContext, thread: ChatThreadContext): string {
  const steps = thread.nodes.filter((n) => STEP_KINDS.has(n.kind));
  const idx = steps.findIndex((s) => s.id === node.nodeId);
  if (idx === -1) return "";
  return `This node is step ${idx + 1} of ${steps.length} in the active thread.`;
}

// M28.3 — when a node is selected the user is FOCUSED on it (the chat is
// docked under that node's code). Tell the agent to stay scoped.
const SCOPE_DIRECTIVE =
  "- The user is focused on the selected node — default to editing ONLY it; if a change needs other code, say so and ask before touching it.";

function threadBlock(t: ChatThreadContext): string[] {
  const steps = t.nodes.filter((n) => STEP_KINDS.has(n.kind));
  const terminals = t.nodes.filter((n) => TERMINAL_KINDS.has(n.kind));
  const lines = [
    `Active thread: ${t.qualifiedName} (seed in ${t.seedFile}) — the user is tracing this cross-file flow, so the conversation may concern any function in it:`,
  ];
  for (const [i, s] of steps.entries()) {
    lines.push(`  ${i + 1}. ${s.id}${s.file ? ` (${s.file})` : ""}`);
  }
  if (terminals.length > 0) {
    lines.push(`  Terminals: ${terminals.map((n) => `${n.label} [${n.kind}]`).join(", ")}`);
  }
  // C1 — inject the ratified, fresh thread-skill as authoritative context,
  // clearly labelled so the agent knows it is human-vetted guidance for THIS
  // thread (not its own inference).
  if (t.skill) {
    lines.push(
      "",
      "Thread skill (human-ratified guidance for this thread — treat as authoritative):",
      t.skill.trim(),
    );
  }
  // M-TRAINED.4 — artifact state (deterministic fact, never a guess).
  if (t.artifacts && t.artifacts.length > 0) {
    lines.push("", "Artifact state for this thread:");
    for (const a of t.artifacts) lines.push(`- ${a}`);
  }
  return lines;
}

// ── M-SKILL.2 — remit-routed context ────────────────────────────────
// The server matched the question's code-shaped tokens against other
// threads' remits (thread_remit.ts — deterministic, lexical, never a
// guess). Each routed thread rides the prompt with honest provenance:
// WHY it matched, its ratified skill when one fits the budget, or the
// stated reason it was withheld. Routing is per-question — this block is
// re-rendered every turn matches exist, never treated as a context delta.

export function renderRoutedBlock(routed: RoutedThreadContext[] | undefined): string {
  if (!routed || routed.length === 0) return "";
  const lines: string[] = [
    "Routed context — this question touches threads beyond the active one (matched deterministically against the IR):",
  ];
  for (const r of routed) {
    lines.push(`- Thread ${r.qualifiedName} (entryPointId ${r.entryPointId}; matched ${r.matchedOn.join(", ")}):`);
    if (r.skill) {
      lines.push(
        "  Thread skill (human-ratified guidance for this thread — treat as authoritative):",
        ...r.skill.trim().split("\n").map((l) => `  ${l}`),
      );
    } else if (r.skillOmitted === "over-budget") {
      lines.push("  (its ratified skill was not injected: over this turn's context budget — read it with vibegraph_get_thread_skill)");
    } else if (r.skillOmitted === "already-in-session") {
      lines.push("  (its ratified skill is already in this session's context — injected on an earlier turn)");
    } else if (r.skillOmitted === "stale") {
      lines.push("  (its ratified skill was withheld: the thread's code changed after ratification and no human has re-affirmed it — you may read it with vibegraph_get_thread_skill, but verify its claims against the current code)");
    } else {
      lines.push("  (no ratified skill exists for this thread yet)");
    }
  }
  lines.push(
    "You may delegate a thread-scoped subtask to any routed thread via vibegraph_spawn_thread_agent(entryPointId, task).",
  );
  return lines.join("\n");
}

export function buildChatPrompt(args: ChatPromptArgs): string {
  const parts: string[] = [
    "You are an agent embedded in VibeGraph, a visual Python code explorer. The user is looking at a live graph of their project; your edits through the `mcp__vibegraph__*` tools update that graph automatically.",
  ];

  if (args.projectFiles.length > 0) {
    parts.push("", `Project files: ${args.projectFiles.join(", ")}`);
  }
  if (args.activeFile) {
    parts.push("", `The user is currently viewing: ${args.activeFile}`);
  }

  if (args.node) {
    const n = args.node;
    if (n.file) {
      const span = n.line != null && n.endLine != null ? `, lines ${n.line}-${n.endLine}` : "";
      parts.push("", `Selected node: ${n.nodeId} (${n.type ?? "node"}${span}) — in file ${n.file}`);
      // M28.3 — the node's position in the thread flow, when we have both.
      const pos = args.thread ? stepPosition(n, args.thread) : "";
      if (pos) parts.push(pos);
      if (n.source) {
        parts.push("```python", n.source, "```");
      }
    } else {
      // Never silently drop the context block: state the gap so the
      // agent goes looking instead of guessing a file.
      parts.push(
        "",
        `Selected node: ${n.nodeId} — not found in the current parse; locate it with vibegraph_find_symbol before editing.`,
      );
    }
  }

  if (args.thread) {
    parts.push("", ...threadBlock(args.thread));
  }

  const routedText = renderRoutedBlock(args.routed);
  if (routedText) {
    parts.push("", routedText);
  }

  parts.push(
    "",
    "Targeting rules:",
    ...(args.node ? [SCOPE_DIRECTIVE] : []),
    "- Do NOT assume the active file is the edit target. Pick the target file from the IR: vibegraph_find_symbol locates a symbol's file and node id; vibegraph_get_node_source shows it before you rewrite.",
    "- A new helper function belongs in its CALLER's file — insert it with vibegraph_compose_insert anchored before/after an existing node there.",
    "- Use relative file paths exactly as vibegraph_list_files returns them.",
    "- Each successful edit is re-parsed and reflected in the user's graph automatically; never output raw code patches.",
    "- Edits reach disk ONLY through the VibeGraph edit tools — that is what verifies the change is confined to the node you targeted and keeps the graph in step. Do not write files by any other route; the raw file-write tools are disabled here.",
    "- A rejected edit is authoritative, not an obstacle to work around: the file is unchanged and the rejection tells you the change escapes the targeted node. Re-target a node whose span covers it, keep the edit inside the target, or tell the user what was refused — never reach for another way to write the file.",
    "- Keep edits minimal — change only what was asked. After all tool calls, briefly summarise what you changed.",
    "",
    "Grounding rule (A3):",
    "- When you state a fact about the code, cite the IR node id it comes from in `backticks` — the structural-path ids shown above (e.g. `module/query.fn/cursor.assign`). Do NOT assert what you cannot tie to a node: if no node id covers a claim, say so, or call vibegraph_find_symbol / vibegraph_get_project_ir to ground it first.",
    "- A fact with no node id (e.g. a low-confidence cross-subsystem inference) is allowed only if you LABEL it as not node-grounded. Use vibegraph_validate_citations to self-check your node-id citations before relying on them.",
    "",
    "User's request:",
    args.userText,
  );

  return parts.join("\n");
}

// ── M-GF3.4 — per-stage dialogue framing ────────────────────────────
//
// The stage detail dialog hosts a SCOPED conversation about ONE roadmap
// stage. Full framing rides the first turn (the persistent session
// remembers it); later turns go through bare. The revision protocol is
// part of the framing: when the user asks for a change, the agent emits
// a fenced ```vg-revise-stage JSON block that the server parses and
// validates — discussion stays prose, so nothing changes by accident.

export interface StagePromptArgs {
  userText: string;
  /** The whole roadmap, for context (order + dependency vocabulary). */
  items: Array<{ id: string; capability: string; needs: string[]; status: string; groundedIn: string | null }>;
  /** The stage under discussion. */
  itemId: string;
  /** The description the roadmap traces to (the user's original words). */
  description: string;
}

export function buildStagePrompt(args: StagePromptArgs): string {
  const idx = args.items.findIndex((i) => i.id === args.itemId);
  const item = idx >= 0 ? args.items[idx] : null;
  const parts: string[] = [
    "You are an agent embedded in VibeGraph, discussing ONE stage of a ratified-or-proposed build roadmap with the user. Your job: help them understand this stage, and revise it when they ask for a change.",
    "",
    `Project description the roadmap traces to: ${args.description}`,
    "",
    "The roadmap (in build order):",
  ];
  for (const [i, it] of args.items.entries()) {
    const marker = it.id === args.itemId ? "  → " : "    ";
    const needs = it.needs.length ? ` (needs: ${it.needs.join(", ")})` : "";
    parts.push(`${marker}${i + 1}. [${it.id}] ${it.capability}${needs} — ${it.status}`);
  }
  if (item) {
    parts.push(
      "",
      `The stage under discussion is ${idx + 1} ("${item.id}").`,
      item.groundedIn
        ? `It is grounded in the user's words: "${item.groundedIn}".`
        : "It was INFERRED — proposed by the planner, not present in the user's description.",
    );
  }
  parts.push(
    "",
    "Rules:",
    "- Discussion turns are plain prose. Keep answers short and concrete.",
    "- ONLY when the user asks you to CHANGE this stage, end your reply with exactly one fenced block:",
    "  ```vg-revise-stage",
    '  {"capability": "<the revised capability text>", "needs": ["<earlier item ids, only if the dependencies change>"]}',
    "  ```",
    "  Omit \"needs\" to keep the current dependencies. `needs` may only name items EARLIER in the roadmap.",
    "- Never emit the block for a question or discussion — a revision is a proposal the user must still apply.",
    "- The stage's capability text is handed verbatim to a builder agent later: keep it a single self-contained instruction.",
    "",
    "User's message:",
    args.userText,
  );
  return parts.join("\n");
}

// ── M27.2 — per-turn context deltas ─────────────────────────────────
//
// With a persistent session (M27.1) the full framing rides the FIRST
// turn only; re-sending it every message fights multi-turn coherence
// instead of helping it. Later turns get a short delta block naming
// only what changed since the previous turn — or nothing at all.

/** What the user was looking at when a turn was sent. handleChat keeps
 * the previous turn's snapshot per session and diffs against it. */
export interface ChatTurnContext {
  activeFile: string | null;
  projectFiles: string[];
  node: ChatNodeContext | null;
  thread: ChatThreadContext | null;
}

/** Returns the delta block for a follow-up turn, or "" when nothing
 * changed (the user text then goes through bare). */
export function buildTurnPreamble(prev: ChatTurnContext, next: ChatTurnContext): string {
  const lines: string[] = [];

  if (next.activeFile !== prev.activeFile && next.activeFile) {
    lines.push(`The user is now viewing: ${next.activeFile}`);
  }

  const prevNodeKey = prev.node ? `${prev.node.nodeId}@${prev.node.file ?? ""}` : null;
  const nextNodeKey = next.node ? `${next.node.nodeId}@${next.node.file ?? ""}` : null;
  if (nextNodeKey !== prevNodeKey) {
    if (next.node) {
      if (next.node.file) {
        // M28.3 — carry the focus directive across turns so a new
        // selection re-scopes the agent (it's docked under this node now).
        lines.push(`The user's selection is now: ${next.node.nodeId} — in file ${next.node.file}. Focus on this node; default to editing only it.`);
        const pos = next.thread ? stepPosition(next.node, next.thread) : "";
        if (pos) lines.push(pos);
      } else {
        lines.push(`The user's selection is now: ${next.node.nodeId} — not found in the current parse; locate it with vibegraph_find_symbol before editing.`);
      }
    } else {
      lines.push("The user cleared their selection.");
    }
  }

  // Thread identity, not array identity — re-derives of the SAME thread
  // (fresh objects per project-update) are not a switch.
  const prevThreadKey = prev.thread?.qualifiedName ?? null;
  const nextThreadKey = next.thread?.qualifiedName ?? null;
  if (nextThreadKey !== prevThreadKey) {
    if (next.thread) {
      lines.push(...threadBlock(next.thread));
    } else {
      lines.push("The user left the thread view.");
    }
  }

  if (next.projectFiles.join("\n") !== prev.projectFiles.join("\n") && next.projectFiles.length > 0) {
    lines.push(`Project files now: ${next.projectFiles.join(", ")}`);
  }

  if (lines.length === 0) return "";
  return ["[Context update]", ...lines].join("\n");
}
