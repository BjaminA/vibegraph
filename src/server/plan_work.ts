// vibegraph_plan_work — deterministic, IR-driven task decomposition.
//
// The middle path settled in the PLAN-v6/M-SKILL lineage: VibeGraph supplies
// the honest KNOWLEDGE for multi-agent work — it never runs the loop. Given a
// task description, this module maps it onto the threads that own it (the
// M-SKILL remit index — lexical, never a semantic guess), orders the matched
// threads dependencies-first off the tcall cross-thread graph, and annotates
// every packet with the boundary facts that make bounded agents safe: where
// the thread's static knowledge ENDS (unresolved / dynamic / uncaptured
// counts), which adjacent threads are OUTSIDE the plan (the escalation
// surface), and the packet's skill state (so the human ratifies context
// before agents consume it).
//
// The caller — the driving Claude session — writes each packet's task text,
// dispatches vibegraph_spawn_thread_agent per packet, and surfaces results
// through the existing gate UX. This tool spawns NOTHING and phrases no
// tasks: decomposition is deterministic fact, orchestration stays with the
// caller, ratification stays with the human.
//
// Honesty floor: zero matches is an honest empty plan (with the tokens that
// were tried); code-shaped tokens no thread owns are NAMED as coverage gaps;
// dependency cycles are reported, never silently linearized.
//
// Pure: no server state, no LLM, no fs. The MCP layer wires it to the live
// envelope.

import {
  buildRemitIndex,
  matchQuestion,
  tokenizeQuestion,
  type RemitThreadInput,
  type ThreadRemit,
} from "./thread_remit.ts";
import { type ThreadSkillResult } from "./thread_skill_store.ts";
import { deriveThreadCalls } from "../webview/system/threadInteraction.ts";

export type PacketSkillStatus = "authoritative" | "stale" | "draft" | "none";

export interface WorkPacketBoundaries {
  /** No resolution gaps and no uncaptured nests (dynamic terminals do NOT
   *  count against completeness — they are correctly identified, not gaps). */
  staticallyComplete: boolean;
  resolutionGaps: number;
  runtimeDispatch: number;
  uncaptured: number;
  /** In-plan threads this packet calls into (they build FIRST — that is the
   *  packet ordering). */
  dependsOn: string[];
  /** Threads OUTSIDE this plan the packet touches — the escalation surface:
   *  an agent needing them must ESCALATE, not guess. */
  outsidePlan: { reaches: string[]; reachedBy: string[] };
}

export interface WorkPacket {
  /** 1-based dependencies-first build order. */
  order: number;
  entryPointId: string;
  qualifiedName: string;
  /** Entry-point kind (cli / route / public_api / test / manual). */
  kind: string | null;
  /** Honest provenance: the exact tokens that matched this thread's remit. */
  matchedOn: string[];
  score: number;
  filesReached: string[];
  boundaries: WorkPacketBoundaries;
  skill: { status: PacketSkillStatus; note: string };
}

export interface WorkPlan {
  task: string;
  packets: WorkPacket[];
  /** Code-shaped tokens in the task that matched NO thread's remit — the
   *  plan does NOT cover them; investigate before editing anything there. */
  unmatchedTokens: string[];
  /** Dependency cycles among matched threads (order inside a cycle is
   *  score-ranked, NOT topological — coordinate these packets manually). */
  cycles: string[][];
  planNote: string;
  verification: string[];
}

// The floor the caller checks each packet's output against — real tool names,
// stated once at plan level.
const VERIFICATION = [
  "Dispatch each packet with vibegraph_spawn_thread_agent(entryPointId, task) — the agent is one-shot, bounded to the thread's projection + ratified skill + blind spots, and returns ESCALATE rather than guessing across its boundary.",
  "Every edit lands through the CST chokepoint (vibegraph_rewrite_node / vibegraph_compose_insert) — format-and-diff confines the change to the targeted node, and the returned `delta` reports the structural IR change for self-verification (B3).",
  "Capture vibegraph_thread_assertions for a packet's thread before dispatch and re-check after its edits: the behavioural contract states what must not have drifted.",
  "vibegraph_run_thread_to_node executes a packet's thread up to a node under the authoritative effect floor (consent-gated; sandboxed synth runs) when a value-level check beats a structural one.",
  "Ground your claims: vibegraph_validate_citations self-checks node-id citations; vibegraph_thread_blind_spots details any packet whose boundaries counts are non-zero.",
  "Ratification stays human: surface each packet's outcome through the existing gate UX before treating it as landed.",
];

function skillPacketState(res: ThreadSkillResult): { status: PacketSkillStatus; note: string } {
  if (!res.exists) {
    return {
      status: "none",
      note: "No thread-skill exists — draft one (vibegraph_generate_thread_skill) and have the human ratify it before dispatching an agent that should trust it.",
    };
  }
  if (res.status !== "ratified") {
    return {
      status: "draft",
      note: "A skill draft exists but is NOT ratified — agents will not receive it until a human ratifies it in the skill card.",
    };
  }
  if (res.stale) {
    return {
      status: "stale",
      note: res.autoReaffirm
        ? "Ratified but stale with auto-reaffirm ON — agents receive it WITH a verify-first caveat."
        : "Ratified but STALE (the thread changed since review) — agents will not receive it; have the human Re-affirm or Re-draft first.",
    };
  }
  return { status: "authoritative", note: "Ratified and fresh — injected into the packet's agent automatically." };
}

/** Light per-thread boundary counts, straight off the thread's node kinds
 *  (same buckets as A1's roll-up; the effects axis and per-node detail live
 *  in vibegraph_thread_blind_spots). */
function boundaryCounts(thread: RemitThreadInput): {
  staticallyComplete: boolean; resolutionGaps: number; runtimeDispatch: number; uncaptured: number;
} {
  let resolutionGaps = 0, runtimeDispatch = 0, uncaptured = 0;
  for (const raw of thread.nodes) {
    const n = raw as { kind?: unknown; nestsInnerCalls?: unknown; nestExtracted?: unknown };
    if (n.kind === "unresolved") resolutionGaps++;
    if (n.kind === "dynamic") runtimeDispatch++;
    if (n.nestsInnerCalls && !n.nestExtracted) uncaptured++;
  }
  return { staticallyComplete: resolutionGaps === 0 && uncaptured === 0, resolutionGaps, runtimeDispatch, uncaptured };
}

/** Tokens from the task that no remit in the whole index owns — the honest
 *  "this plan does not cover it" list. */
function findUnmatchedTokens(task: string, index: ThreadRemit[]): string[] {
  const tokens = tokenizeQuestion(task);
  const unmatched: string[] = [];
  for (const t of tokens.nodeIds) {
    if (!index.some((r) => r.nodeIds.has(t))) unmatched.push(t);
  }
  for (const t of tokens.files) {
    if (!index.some((r) => r.files.has(t) || [...r.files].some((f) => f.endsWith(`/${t}`)))) unmatched.push(t);
  }
  for (const t of tokens.symbols) {
    if (!index.some((r) => r.symbols.has(t))) unmatched.push(`\`${t}\``);
  }
  return unmatched.sort();
}

export interface PlanWorkArgs {
  task: string;
  /** The envelope's threads[] (ProjectThread shape — remit fields read
   *  structurally, absent fields simply add nothing). */
  threads: RemitThreadInput[];
  /** The envelope's entryPoints[] (for tcall head matching + packet kind). */
  entryPoints: Array<{ id?: unknown; kind?: unknown; file?: unknown; irNodeId?: unknown }>;
  /** Live skill lookup (the M-SKILL store, read at plan time). */
  skillFor: (entryPointId: string) => ThreadSkillResult;
  /** Max packets (default 8, capped at 16). */
  maxPackets?: number;
}

export function planWork(args: PlanWorkArgs): WorkPlan {
  const limit = Math.min(Math.max(1, args.maxPackets ?? 8), 16);
  const index = buildRemitIndex(args.threads);
  const matches = matchQuestion(args.task, index, { limit });
  const unmatchedTokens = findUnmatchedTokens(args.task, index);

  if (matches.length === 0) {
    return {
      task: args.task,
      packets: [],
      unmatchedTokens,
      cycles: [],
      planNote:
        "No thread's remit matched this task (matching is lexical over the IR — exact code-shaped tokens only, never a semantic guess). " +
        "Name the code the task touches (backticked symbols, file names, or structural node ids), or explore first with vibegraph_list_entry_points / vibegraph_find_symbol.",
      verification: VERIFICATION,
    };
  }

  const matched = new Set(matches.map((m) => m.entryPointId));
  const byId = new Map(matches.map((m) => [m.entryPointId, m]));
  const threadById = new Map(args.threads.filter((t) => t.entryPointId).map((t) => [t.entryPointId as string, t]));
  const epKind = new Map(
    args.entryPoints
      .filter((e): e is { id: string; kind?: unknown } => typeof e.id === "string")
      .map((e) => [e.id, typeof e.kind === "string" ? e.kind : null]),
  );

  // Cross-thread call graph: an edge from→to means `from` invokes `to`'s
  // head, so `to` is a dependency of `from` and builds first.
  const graph = deriveThreadCalls(args.threads as never[], args.entryPoints as never[]);
  const dependsOn = new Map<string, Set<string>>();
  const outsideReaches = new Map<string, Set<string>>();
  const outsideReachedBy = new Map<string, Set<string>>();
  for (const id of matched) {
    dependsOn.set(id, new Set());
    outsideReaches.set(id, new Set());
    outsideReachedBy.set(id, new Set());
  }
  for (const e of graph.edges) {
    if (matched.has(e.from) && matched.has(e.to)) dependsOn.get(e.from)!.add(e.to);
    else if (matched.has(e.from)) outsideReaches.get(e.from)!.add(e.to);
    else if (matched.has(e.to)) outsideReachedBy.get(e.to)!.add(e.from);
  }

  // Kahn, dependencies-first. Deterministic tie-break: higher score, then id.
  const rank = (id: string) => byId.get(id)!.score;
  const pick = (ids: string[]) =>
    ids.sort((a, b) => rank(b) - rank(a) || (a < b ? -1 : a > b ? 1 : 0));
  const remainingDeps = new Map([...dependsOn].map(([id, deps]) => [id, new Set(deps)]));
  const ordered: string[] = [];
  while (remainingDeps.size > 0) {
    const free = pick([...remainingDeps.keys()].filter((id) => remainingDeps.get(id)!.size === 0));
    if (free.length === 0) break; // cycle among everything left
    for (const id of free) {
      ordered.push(id);
      remainingDeps.delete(id);
    }
    for (const deps of remainingDeps.values()) for (const id of free) deps.delete(id);
  }
  // Whatever Kahn could not free is cyclic: report it honestly, then append
  // score-ranked so the plan still covers every match.
  const cyclic = pick([...remainingDeps.keys()]);
  const cycles: string[][] = cyclic.length > 0 ? [cyclic] : [];
  ordered.push(...cyclic);

  const packets: WorkPacket[] = ordered.map((id, i) => {
    const m = byId.get(id)!;
    const thread = threadById.get(id);
    const counts = thread
      ? boundaryCounts(thread)
      : { staticallyComplete: false, resolutionGaps: 0, runtimeDispatch: 0, uncaptured: 0 };
    return {
      order: i + 1,
      entryPointId: id,
      qualifiedName: m.qualifiedName,
      kind: epKind.get(id) ?? null,
      matchedOn: m.matchedOn.map((t) => (t.kind === "symbol" ? `\`${t.token}\`` : t.token)),
      score: m.score,
      filesReached: thread ? [...new Set([thread.seed.file, ...thread.filesReached])] : [],
      boundaries: {
        ...counts,
        dependsOn: pick([...(dependsOn.get(id) ?? [])]),
        outsidePlan: {
          reaches: [...(outsideReaches.get(id) ?? [])].sort(),
          reachedBy: [...(outsideReachedBy.get(id) ?? [])].sort(),
        },
      },
      skill: skillPacketState(args.skillFor(id)),
    };
  });

  return {
    task: args.task,
    packets,
    unmatchedTokens,
    cycles,
    planNote:
      "Deterministic decomposition off the IR (lexical remit match + tcall dependency order) — not a semantic guess. " +
      "Packets are ordered dependencies-first; write each packet's task yourself and dispatch it with vibegraph_spawn_thread_agent. " +
      "This tool spawns nothing: orchestration is yours, ratification is the human's." +
      (unmatchedTokens.length > 0
        ? " NOTE: unmatchedTokens lists code-shaped parts of the task NO thread owns — the plan does not cover them."
        : ""),
    verification: VERIFICATION,
  };
}
