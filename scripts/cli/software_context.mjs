// SOFTWARE SPECS in a hooked session (2026-09-30). A RATIFIED spec is sent
// once per session — its definition, the calls this code makes into it, its
// states, its rules with their reasons — when a prompt's routed threads reach
// the tool (an import, or a call to one of its operations) or the open plan
// names it in its stack (a greenfield plan has no threads yet). A compaction
// resets the record. Drafts never reach a session.
import { ratifiedSpecs } from "../../src/server/software_store.ts";
import { specUsage, specHeadlines } from "../../src/server/software_apply.ts";
import { loadPlan } from "../../src/server/plan_store.ts";

export function softwareForPrompt(absRoot, env, routedEps, state, room = Infinity) {
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
  const held = [];
  // a spec the code CALLS comes before one it only imports or the plan names
  const due = specs.filter((s) => !sent.has(s.tool)).map((spec) => ({ spec, usage: reached.size ? specUsage(spec, env.files, reached) : { imports: [], calls: [] } }))
    .filter(({ spec, usage }) => usage.imports.length || usage.calls.length || planTools.has(spec.tool))
    .sort((a, b) => b.usage.calls.length - a.usage.calls.length);
  let left = room;
  for (const { spec, usage } of due) {
    const text = specHeadlines(spec, usage.calls);
    // 2026-10-20 (live run): the specs went in unbudgeted and the whole context
    // was cut at the end — the task's own thread was what got lost. A spec
    // that does not fit is named, and sent by a later prompt.
    if (text.length + 2 > left) { held.push(spec.tool); continue; }
    out.push(text); left -= text.length + 2;
    sent.add(spec.tool);
  }
  if (held.length) out.push(`(Software specs that also apply, not sent for length: ${held.join(", ")} — \`vibegraph-knowledge software show <tool>\`.)`);
  state.software = [...sent];
  return out.length ? out.join("\n\n") : null;
}
