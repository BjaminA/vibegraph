// The architecture map's JOURNEYS lens (2026-09-29): which page sends the
// user to which page. A GUI lens only, like Configuration (arch_config.ts):
// the model is built here from the page entry points (Next App Router
// `page.tsx`, discovered as routes with `next: "page"`) and the crossing
// index's `navigation` hops — `<Link href>`, `router.push`, `redirect`
// LITERALS joined to the page that serves the path — then drawn through the
// Flows lens's own layout. A computed target has no literal and is not drawn;
// an unmatched literal is counted on its page, never invented as a node.

import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord, CrossingIndexRecord } from "../../shared/protocol";
import type { EntryPoint } from "../types";

const EMPTY_UNPLACED: ArchModelRecord["unplaced"] = { tests: 0, unmatchedHops: 0, toolsPresentNotCalled: [], unattributedBoundaries: 0 };

export function isPageEntry(e: Pick<EntryPoint, "kind" | "metadata">): boolean {
  return e.kind === "route" && (e.metadata as { next?: unknown } | undefined)?.next === "page";
}

/** How a navigation is spelled, as the edge's protocol. */
function spelling(callee: string): string {
  if (callee.startsWith("<")) return "link";
  if (/redirect/i.test(callee)) return "redirect";
  return "router";
}

export function journeysModel(entryPoints: EntryPoint[], crossings: CrossingIndexRecord | null | undefined): ArchModelRecord {
  const pages = entryPoints.filter(isPageEntry);
  const navs = crossings?.navigation ?? [];
  const unmatched = new Map<string, Set<string>>();
  for (const h of navs) if (!h.targets.length) (unmatched.get(h.entryPointId) ?? unmatched.set(h.entryPointId, new Set()).get(h.entryPointId)!).add(h.path);

  const nodes: ArchNodeRecord[] = pages.map((p) => {
    const route = String((p.metadata as { route?: unknown }).route ?? p.label);
    const dead = unmatched.get(p.id);
    return {
      id: `page:${p.id}`, kind: "cluster", label: route,
      sublabel: `page · ${p.file}${dead?.size ? ` · ${dead.size} link${dead.size === 1 ? "" : "s"} to no page` : ""}`,
      category: "frontend", source: "derived", family: "web",
      entryPoints: [p.id], threads: [p.id], refs: [{ file: p.file, nodeId: p.irNodeId }],
      ...(dead?.size ? { notes: [...dead].map((d) => `links to ${d}, which no page in this project serves`) } : {}),
    } as ArchNodeRecord;
  });
  const known = new Set(pages.map((p) => p.id));

  const edges = new Map<string, ArchEdgeRecord & { _how: Set<string> }>();
  for (const h of navs) {
    if (!known.has(h.entryPointId)) continue; // a component thread that is not a page
    for (const t of h.targets) {
      if (!known.has(t.entryPointId)) continue;
      const key = `${h.entryPointId}->${t.entryPointId}`;
      let e = edges.get(key);
      if (!e) {
        e = {
          id: `nav:${key}`, from: `page:${h.entryPointId}`, to: `page:${t.entryPointId}`, kind: "http",
          protocol: "navigates", protocolBasis: "a Link href / router.push / redirect literal in the page's thread names a path this page serves",
          details: [], count: 0, threads: [h.entryPointId], confidence: "path", refs: [], source: "derived", _how: new Set(),
        };
        edges.set(key, e);
      }
      e.count++;
      e._how.add(spelling(h.callee));
      if (h.confidence === "ambiguous") e.confidence = "ambiguous";
      if (e.refs.length < 6) e.refs.push({ file: h.file, nodeId: h.nodeId, text: `${h.callee} ${h.path}` } as never);
    }
  }
  const edgeList: ArchEdgeRecord[] = [...edges.values()].map(({ _how, ...e }) => ({ ...e, details: [..._how].sort() }));
  const notes = pages.length
    ? [`${navs.length} navigation literal${navs.length === 1 ? "" : "s"} across ${pages.length} page${pages.length === 1 ? "" : "s"}; a computed target (router.push(url)) is not drawn`]
    : ["no page entry points: the Journeys lens reads Next App Router pages"];
  return { version: "1", nodes, edges: edgeList, groups: [], unplaced: { ...EMPTY_UNPLACED, unmatchedHops: [...unmatched.values()].reduce((a, s) => a + s.size, 0) }, notes };
}
