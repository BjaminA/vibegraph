// Per-thread context from an envelope alone: the thread contract, the stated
// rules routed to it, and the skill STAMP — the one computation the export
// (what a plain Claude reads) and the CLI's `skills` command (what drafts,
// ratifies and re-affirms) must agree on, or a skill the CLI calls fresh would
// be withheld by the export (2026-09-25). The stamp is thread_skill_stamp.ts's,
// the same function the server writes with.
import { buildStackIndex } from "../src/server/stack.ts";
import { contractOptsFor } from "../src/server/quality/facts.ts";
import { computeThreadContract } from "../src/server/thread_contract.ts";
import { routeConstraints } from "../src/server/constraint_store.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { deriveThreadCalls, threadAdjacency } from "../src/webview/system/threadInteraction.ts";
import { skillRulesBlock, threadSkillStamp } from "../src/server/thread_skill_stamp.ts";

/** { stack, crossings, graph, byEntry: Map<ep, { thread, contract, routed, rulesBlock, stamp }> } */
export function threadContexts(env, absRoot, constraints, prebuilt = {}) {
  const stack = prebuilt.stack ?? buildStackIndex(env, absRoot);
  const crossings = prebuilt.crossings ?? buildCrossingIndex(env);
  const graph = prebuilt.graph ?? deriveThreadCalls(env.threads, env.entryPoints, crossings);
  const baseOpts = contractOptsFor(env, stack);
  const byEntry = new Map();
  for (const t of env.threads) {
    const ep = t.entryPointId;
    if (!ep) continue;
    const contract = computeThreadContract(t, { ...baseOpts, ...threadAdjacency(graph, ep) });
    const routed = routeConstraints(constraints, { entryPointId: ep, filesReached: contract.filesReached, stack: stack.byThread[ep] ?? [] });
    const rulesBlock = skillRulesBlock(routed);
    byEntry.set(ep, { thread: t, contract, routed, rulesBlock, stamp: threadSkillStamp(t, rulesBlock) });
  }
  return { stack, crossings, graph, byEntry };
}
