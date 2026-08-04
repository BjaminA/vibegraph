// D1 (PLAN-v6) — per-thread agent (anti-drift architecture). Spawn a subagent
// whose context is DELIBERATELY BOUNDED to one thread: its compact projection,
// its human-ratified thread-skill (C1), its blind-spot roll-up (A1), and the
// adjacent threads it reaches / is reached by (the cross-thread graph). Because
// the context is bounded, the agent must ESCALATE when a task needs anything
// outside its thread — rather than confabulate. That escalation protocol is the
// whole point: an honest bounded agent, not a blind one.
//
// Pure: the server renders the bundle pieces to strings and assembles the
// prompt here, so this is unit-testable without a claude -p call.

export interface ThreadAgentBundle {
  entryPointId: string;
  qualifiedName: string;
  /** Rendered compact execution path (seed/step/external, honestly marked). */
  projection: string;
  /** The ratified + fresh thread-skill body, or null. */
  skill: string | null;
  /** Rendered A1 blind-spot roll-up (what is NOT statically known). */
  blindSpots: string;
  filesReached: string[];
  /** entryPointIds this thread reaches (outgoing adjacency). */
  reaches: string[];
  /** entryPointIds that reach this thread (incoming adjacency). */
  reachedBy: string[];
}

export interface ThreadAgentResult {
  entryPointId: string;
  task: string;
  result: string | null;
  /** True when the agent honestly refused for lack of in-thread context. */
  escalated: boolean;
  error?: string;
}

export const ESCALATE_PREFIX = "ESCALATE:";

// ── projection rendering ──────────────────────────────────────────────
//
// 2026-08-04 sitting: the projection rendered collapsed nests as a bare count
// (`[+6 nested]`). An agent given that count INVENTED the decomposition — it
// read "3 Linear + 3 activations" off a stack that is 3 Linear + 2 ReLU + 1
// Dropout, and in the same reply hedged on "which activations" as unknowable.
// Both labels were in the IR; the renderer discarded them. A count is not a
// fact an agent can reason from. Name them.
//
// Lives here (pure) rather than inline in server.ts so it is unit-testable —
// the failure above was invisible to the suite because nothing could see this
// string. Takes the already-derived pieces so it stays free of collapse.ts.

export const PROJECTION_MAX = 40;

export interface ProjectionNode {
  kind: string;
  label: string;
  irNodeId?: string | null;
  file?: string | null;
  nestedCollapsed?: number;
  uncaptured?: true;
  /** Labels of the collapsed nested calls, outer-to-inner as the IR lists them. */
  nestedLabels?: string[];
}

/** Order-preserving de-dupe with occurrence counts: `nn.Linear ×3` reads as
 *  three occurrences rather than three unexplained repeats. */
export function renderNestLabels(labels: string[]): string {
  const seen = new Map<string, number>();
  for (const nm of labels) seen.set(nm, (seen.get(nm) ?? 0) + 1);
  return [...seen].map(([nm, c]) => (c > 1 ? `${nm} ×${c}` : nm)).join(", ");
}

/** Render the agent-facing execution path. Truncation is ANNOUNCED: a cut
 *  projection that looks complete is how an agent concludes "nothing else
 *  happens here" about a path it was never shown. */
export function renderAgentProjection(nodes: ProjectionNode[]): string {
  const eligible = nodes.filter((n) => ["seed", "step", "external"].includes(n.kind));
  const lines = eligible.slice(0, PROJECTION_MAX).map((n) => {
    const names = n.nestedCollapsed
      ? (n.nestedLabels?.length ? renderNestLabels(n.nestedLabels) : `${n.nestedCollapsed} unnamed`)
      : "";
    const mark = (n.nestedCollapsed ? ` [nests: ${names}]` : "")
      + (n.uncaptured ? " [hides calls not in IR]" : "");
    return `- ${n.kind}: ${n.label}${n.irNodeId ? ` \`${n.irNodeId}\`` : ""}${n.file ? ` (${n.file})` : ""}${mark}`;
  });
  if (eligible.length > PROJECTION_MAX) {
    lines.push(
      `- [TRUNCATED: ${eligible.length - PROJECTION_MAX} more steps of ${eligible.length} are NOT shown. `
      + "This projection is INCOMPLETE — do not conclude anything about what this thread does "
      + "or does not do after the last line above.]",
    );
  }
  return lines.join("\n");
}

const ESCALATION_RULE =
  `If completing the task needs code or context OUTSIDE this thread, do NOT guess — respond with a SINGLE line starting \`${ESCALATE_PREFIX}\` naming what's missing (e.g. \`${ESCALATE_PREFIX} needs thread <entryPointId>\` or \`${ESCALATE_PREFIX} needs file <path>\`). The adjacent threads below are the boundary you can SEE but are NOT scoped to — reaching into them is an escalation, not your job.`;

// 2026-07-30 sitting: an agent closed its reply by reporting 2-epoch synthetic
// runs, a real 3-epoch `train()` on the project's csv, and a grep for callers.
// None of it happened — the artifact `train()` would have written was still an
// hour old. The prompt never said the agent cannot execute anything, and the
// blind-spots line offered "read source / run / ask" as if running were on the
// table. Say the constraint plainly, and forbid the claim as well as the act:
// a fabricated verification is worse than no verification, because the reader
// stops checking. Whoever reads the reply does the running.
const NO_EXECUTION_RULE =
  "You are a REASONING agent: one shot, text in and text out. You cannot run code, execute tests, read files, or search the project — everything you have is in this prompt. "
  + "Never claim, or imply, that you ran, tested, executed, benchmarked, or grepped anything. If a claim would need execution to stand up, state it as an expectation and name the check a human should run. "
  + "An unverified answer marked unverified is a good answer; an invented verification is a failure.";

export function buildThreadAgentPrompt(b: ThreadAgentBundle, task: string): string {
  const parts: string[] = [
    `You are a subagent scoped to ONE code thread of a Python project: ${b.qualifiedName} (${b.entryPointId}).`,
    "Your context is DELIBERATELY BOUNDED to this thread. Work within it; everything you need to know about the thread is below.",
    "",
    NO_EXECUTION_RULE,
    "",
    "Execution path (compact, honest projection):",
    b.projection || "(no steps)",
    "",
    `Files reached: ${b.filesReached.join(", ") || "(none)"}`,
  ];
  if (b.skill) {
    parts.push("", "Human-ratified thread skill (authoritative guidance for this thread):", b.skill.trim());
  }
  parts.push(
    "",
    // Was "read source / run / ask" — an instruction to do three things this
    // agent cannot do, in the one block that exists to mark uncertainty.
    "What is NOT statically known here (IR fact). You cannot resolve these yourself — name them as open questions, never fill them in:",
    b.blindSpots,
    "",
    "Adjacent threads (visible boundary; you are NOT scoped to these):",
    `  reaches: ${b.reaches.join(", ") || "(none)"}`,
    `  reached by: ${b.reachedBy.join(", ") || "(none)"}`,
    "",
    ESCALATION_RULE,
    "",
    "Task:",
    task,
  );
  return parts.join("\n");
}

/** An agent reply escalates when its first non-blank line starts ESCALATE:. */
export function isEscalation(result: string | null): boolean {
  return !!result && result.trimStart().startsWith(ESCALATE_PREFIX);
}
