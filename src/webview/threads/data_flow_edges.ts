// DATA-FLOW LINES in the thread view (2026-10-07): when a step's result is
// passed into a later step of the same function, a quiet dashed line runs
// from what produced it to what takes it, labelled with the names —
// load() ⇢ run_training via train_x, train_y. Derived, never laid out: the
// thread's own call edges place the cards; these are drawn over that
// layout. The rule is shared/call_flow.ts's, the one the code view uses.

import { MarkerType, type Edge } from "@xyflow/react";
import type { Thread } from "./types";
import type { ProjectFileData } from "../../shared/protocol";
import { callIO, dataFlows, scopeOf, type CallNodeLike } from "../../shared/call_flow";

const fileIR = (ir: Record<string, ProjectFileData>, file: string) =>
  ir[file] ?? Object.entries(ir).find(([k]) => k === file || k.endsWith(`/${file}`) || k.endsWith(file))?.[1] ?? null;

export function threadDataFlowEdges(thread: Thread, projectIR: Record<string, ProjectFileData> | null, colour: string): Edge[] {
  if (!projectIR) return [];
  const nodeById = new Map(thread.nodes.map((n) => [n.id, n]));
  const sites: Array<{ key: string; scope: string; line: number; io: ReturnType<typeof callIO> }> = [];
  const targetOf = new Map<string, string>();
  thread.edges.forEach((e, i) => {
    const from = nodeById.get(e.from), to = nodeById.get(e.to);
    if (!from?.file || !e.irSource || !to || to.kind === "container") return;
    const ir = fileIR(projectIR, from.file);
    if (!ir) return;
    const byId = new Map((ir.nodes as CallNodeLike[]).map((n) => [n.id, n]));
    const call = byId.get(e.irSource);
    if (!call?.line) return;
    const key = `e${i}`;
    // scoped by the calling FILE too: two files' functions never share names
    sites.push({ key, scope: `${from.file}::${scopeOf(call.id, byId)}`, line: call.line, io: callIO(call) });
    targetOf.set(key, e.to);
  });
  const out: Edge[] = [];
  for (const f of dataFlows(sites)) {
    const a = targetOf.get(f.from)!, b = targetOf.get(f.to)!;
    if (a === b || out.some((x) => x.source === a && x.target === b)) continue;
    out.push({
      id: `tdf-${a}-${b}`,
      source: a, target: b,
      type: "threadEdge",
      markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 12, height: 12 },
      data: { kind: "data-flow", irSource: null, crossFile: false, crossDepth: false, sameFileHueIndex: null, branchHueIndex: null, tier: "thin", label: f.names.join(", "), labelFull: `its result reaches this call as ${f.names.join(", ")}`, labelSource: "flow" } as unknown as Record<string, unknown>,
    });
  }
  return out;
}
