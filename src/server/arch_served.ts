// WHO A PROCESS SERVES (2026-10-06, system views): a cluster whose entry
// points are routes, or whose files call `.listen()` when loaded (the JS/TS
// builder's `programSignals`), answers calls from outside its own process.
// Stamped as `serves` on the cluster; the map (arch_real.ts) draws an outside
// caller in front of one that no project process calls. A fact about the
// code, not about who the callers are — the plan names them when it can.

import type { ArchModelRecord } from "../shared/protocol.ts";
import type { EntryPoint } from "../shared/protocol.ts";
import { isTestFile } from "../shared/path_match.ts";

const fileOf = (ep: string) => ep.replace(/:[^:]*$/, "");

export function stampServed(
  model: ArchModelRecord,
  entryPoints: EntryPoint[],
  files: Record<string, { programSignals?: string[] } & Record<string, any>>,
): ArchModelRecord {
  const byId = new Map(entryPoints.map((e) => [e.id, e]));
  const nodes = model.nodes.map((n) => {
    if (n.kind !== "cluster" || !n.entryPoints?.length) return n;
    const routes = n.entryPoints.filter((id) => byId.get(id)?.kind === "route" && !isTestFile(fileOf(id)));
    if (routes.length) return { ...n, serves: { how: "routes" as const, files: [...new Set(routes.map(fileOf))].sort() } };
    const listening = [...new Set(n.entryPoints.map(fileOf))]
      .filter((f) => !isTestFile(f) && (files[f]?.programSignals ?? []).includes("listen"));
    return listening.length ? { ...n, serves: { how: "listen" as const, files: listening.sort() } } : n;
  });
  return { ...model, nodes };
}
