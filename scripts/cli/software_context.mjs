// SOFTWARE SPECS in a hooked session (2026-09-30). A RATIFIED spec is sent
// once per session — its definition, the calls this code makes into it, its
// states, its rules with their reasons — when a prompt's routed threads reach
// the tool (an import, or a call to one of its operations) or the open plan
// names it in its stack (a greenfield plan has no threads yet). A compaction
// resets the record. Drafts never reach a session.
import { ratifiedSpecs } from "../../src/server/software_store.ts";
import { specUsage, specHeadlines } from "../../src/server/software_apply.ts";
import { loadPlan } from "../../src/server/plan_store.ts";

export function softwareForPrompt(absRoot, env, routedEps, state) {
  let specs;
  try { specs = ratifiedSpecs(absRoot); } catch { return null; }
  if (!specs.length) return null;
  const sent = new Set(state.software ?? []);
  let planTools = new Set();
  try {
    const plan = loadPlan(absRoot);
    if (plan && !plan.closed) planTools = new Set(plan.stack.filter((t) => t.status !== "dropped").map((t) => t.tool));
  } catch { /* no plan */ }
  const reached = new Set(routedEps.flatMap((ep) => env.threads.find((t) => t.entryPointId === ep)?.filesReached ?? []));
  const out = [];
  for (const spec of specs) {
    if (sent.has(spec.tool)) continue;
    const usage = reached.size ? specUsage(spec, env.files, reached) : { imports: [], calls: [] };
    if (!usage.imports.length && !usage.calls.length && !planTools.has(spec.tool)) continue;
    out.push(specHeadlines(spec, usage.calls));
    sent.add(spec.tool);
  }
  state.software = [...sent];
  return out.length ? out.join("\n\n") : null;
}
