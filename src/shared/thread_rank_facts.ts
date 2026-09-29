// The facts one thread's terminals are ranked from (2026-09-29, moved out of
// the React hook so the server, the MCP brief and the CLI rank a thread
// exactly as the thread view and the code view do): the owning file's IR
// node and the stack index, through `factsFrom` — one path, so no two
// surfaces ever rank a call apart.

import { factsFrom, type NodeFacts, type RankNode } from "./thread_rank.ts";

interface FactsThread {
  nodes: ReadonlyArray<{ irNodeId?: string | null }>;
  entryPointId?: string | null;
}
interface FactsFile { nodes?: ReadonlyArray<{ id?: string; effectKind?: unknown }> }
interface FactsStack {
  importsByFile?: Record<string, any[]>;
  localsByFile?: Record<string, any[]>;
  [k: string]: unknown;
}
interface FactsCrossings {
  byThread?: Record<string, ReadonlyArray<{ nodeId?: string | null }>>;
  all?: ReadonlyArray<{ nodeId?: string | null }>;
}

export function threadFacts(
  thread: FactsThread,
  projectIR: Record<string, FactsFile> | null,
  stack: FactsStack | null,
  crossings: FactsCrossings | null,
): (n: RankNode) => NodeFacts {
  const files = projectIR ?? {};
  // one pass over the project: irNodeId → owning file, and the node itself
  const byId = new Map<string, { file: string; node: { effectKind?: unknown } }>();
  const wanted = new Set(thread.nodes.map((n) => n.irNodeId).filter(Boolean) as string[]);
  for (const [file, data] of Object.entries(files)) {
    for (const n of data?.nodes ?? []) {
      if (n.id && wanted.has(n.id) && !byId.has(`${file}|${n.id}`)) byId.set(`${file}|${n.id}`, { file, node: n });
    }
  }
  const fileOf = new Map<string, string>();
  for (const [k, v] of byId) fileOf.set(k.slice(v.file.length + 1), v.file);
  const list = crossings?.byThread?.[thread.entryPointId ?? ""] ?? crossings?.all ?? [];
  const crossingIds = new Set(list.map((c) => c.nodeId));
  return factsFrom({
    ownerFile: (n) => n.file ?? (n.irNodeId ? fileOf.get(n.irNodeId) ?? null : null),
    irNode: (file, id) => byId.get(`${file}|${id}`)?.node ?? null,
    imports: (f) => stack?.importsByFile?.[f] ?? [],
    locals: (f) => stack?.localsByFile?.[f] ?? [],
    stack: (stack ?? null) as never,
    crossing: (n) => !!n.irNodeId && crossingIds.has(n.irNodeId),
  });
}
