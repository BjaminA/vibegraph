// The call sites a stack index keyed, looked up by (file, node id).
//
// attributeBoundary's rule 3 ("the index already keyed THIS call node") used
// to scan every tool's evidence for every boundary: on a 743-file tree that
// was a quarter of a second per check, paid by the hook after every edit
// (2026-10-20). The map is built once per index, first match in `tools` order
// winning, as the scan did. It is keyed on the index's `tools` array: an index
// is complete when it is handed out, and nothing appends evidence after.

import type { StackToolLike } from "./stack_attribution.ts";

const SITES = new WeakMap<ReadonlyArray<StackToolLike>, Map<string, StackToolLike>>();
const LAUNCHES = new WeakMap<ReadonlyArray<StackToolLike>, Map<string, StackToolLike>>();

/** RC3 — the program a launching call runs (evidence kind "exec"), or null. */
export function toolLaunchedAt(tools: ReadonlyArray<StackToolLike>, file: string, nodeId: string): StackToolLike | null {
  let sites = LAUNCHES.get(tools);
  if (!sites) {
    sites = new Map();
    for (const t of tools) for (const e of t.evidence ?? []) if (e.kind === "exec" && e.nodeId) sites.set(`${e.file}\u0000${e.nodeId}`, t);
    LAUNCHES.set(tools, sites);
  }
  return sites.get(`${file}\u0000${nodeId}`) ?? null;
}

/** The first non-project tool whose evidence names this call, or null. */
export function toolAtCallSite(tools: ReadonlyArray<StackToolLike>, file: string, nodeId: string): StackToolLike | null {
  let sites = SITES.get(tools);
  if (!sites) {
    sites = new Map();
    for (const t of tools) {
      if (t.origin === "project") continue;
      for (const e of t.evidence ?? []) {
        if (!e.nodeId) continue;
        const key = `${e.file}\u0000${e.nodeId}`;
        if (!sites.has(key)) sites.set(key, t);
      }
    }
    SITES.set(tools, sites);
  }
  return sites.get(`${file}\u0000${nodeId}`) ?? null;
}
