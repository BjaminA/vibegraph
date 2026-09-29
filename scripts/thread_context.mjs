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
import { testReach } from "../src/shared/test_reach.ts";
import { buildEnvSurface, configuredByFor } from "../src/shared/env_surface.ts";
import { readEnvDeclarations } from "../src/server/infra_manifests.ts";
import { computeNearClones } from "../src/shared/near_clones.ts";
import { rankThread } from "../src/shared/thread_rank.ts";
import { threadFacts } from "../src/shared/thread_rank_facts.ts";

/** `.env.example` lines and compose `environment:` entries, as declarations. */
export function envDeclarations(absRoot) {
  try { return readEnvDeclarations(absRoot); } catch { return []; }
}

/** { stack, crossings, graph, byEntry: Map<ep, { thread, contract, routed, rulesBlock, stamp }> } */
export function threadContexts(env, absRoot, constraints, prebuilt = {}) {
  const stack = prebuilt.stack ?? buildStackIndex(env, absRoot);
  const crossings = prebuilt.crossings ?? buildCrossingIndex(env);
  const graph = prebuilt.graph ?? deriveThreadCalls(env.threads, env.entryPoints, crossings);
  const baseOpts = contractOptsFor(env, stack);
  // 2026-09-28 - the discovered tests that exercise each thread.
  const tests = testReach(env.threads, env.entryPoints);
  // 2026-09-28 - the environment variables each thread reads.
  const envSurface = prebuilt.envSurface ?? buildEnvSurface(env, envDeclarations(absRoot));
  // 2026-09-29 - near-clones of every eligible function (shared/near_clones.ts).
  const clones = prebuilt.nearClones ?? computeNearClones(env.files);
  const byEntry = new Map();
  for (const t of env.threads) {
    const ep = t.entryPointId;
    if (!ep) continue;
    // `only` — the threads a caller needs (the prompt hook routes to three),
    // computed by the same recipe as the export.
    if (prebuilt.only && !prebuilt.only.has(ep)) continue;
    const contract = computeThreadContract(t, { ...baseOpts, ...threadAdjacency(graph, ep), testedBy: tests.get(ep), configuredBy: configuredByFor(envSurface, ep), nearClonesFor: (f, id) => clones.get(`${f}::${id}`), rankFor: (th) => rankThread(th, threadFacts(th, env.files, stack, crossings)) });
    const routed = routeConstraints(constraints, { entryPointId: ep, filesReached: contract.filesReached, stack: stack.byThread[ep] ?? [] });
    const rulesBlock = skillRulesBlock(routed);
    byEntry.set(ep, { thread: t, contract, routed, rulesBlock, stamp: threadSkillStamp(t, rulesBlock) });
  }
  return { stack, crossings, graph, byEntry, envSurface, nearClones: clones };
}
