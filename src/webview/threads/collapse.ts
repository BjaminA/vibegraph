// M-NEST Layer 2 — nest parentage + the collapse projection.
//
// ONE complete thread (the extractor emits nested call terminals tagged
// `nested:true`); the human view renders a COLLAPSED projection by default and
// expands a nest on demand. This module is the pure, view-side machinery for
// both: it never mutates the source thread and never calls the extractor.
//
// Parentage is structural, not positional: a nested call's IR id is
// `<outerIrId>/<segment>` by construction (parse_cst minted it with the outer
// node pushed as parent), so the outer thread node is simply the one whose
// `irNodeId` equals the nested id with its last path segment stripped. No
// per-file IR lookup is needed for parentage — only for the deferred-badge
// honesty flags, which the caller threads in via `nestsInnerCalls`.

import type { Thread, ThreadNode, ThreadEdge } from "./types";

export interface NestInfo {
  /** outer thread-node id → its nested child thread-node ids (extracted). */
  childrenByParent: Map<string, string[]>;
  /** nested child thread-node id → its outer thread-node id. */
  parentByChild: Map<string, string>;
}

/** Strip the last `/segment` of a structural IR id (the nested call's parent). */
function parentIrId(irNodeId: string): string | null {
  const i = irNodeId.lastIndexOf("/");
  return i <= 0 ? null : irNodeId.slice(0, i);
}

/**
 * Derive nest parentage by matching each `nested` node's stripped IR id against
 * the IR ids of the other thread nodes. Pure over the node list.
 */
export function deriveNests(nodes: ThreadNode[]): NestInfo {
  const byIrId = new Map<string, string>(); // irNodeId → thread node id
  for (const n of nodes) if (n.irNodeId) byIrId.set(n.irNodeId, n.id);

  const childrenByParent = new Map<string, string[]>();
  const parentByChild = new Map<string, string>();
  for (const n of nodes) {
    if (!n.nested || !n.irNodeId) continue;
    const pIr = parentIrId(n.irNodeId);
    const outerId = pIr ? byIrId.get(pIr) : undefined;
    if (!outerId) continue; // outer not in this thread (defensive) — leave bare
    parentByChild.set(n.id, outerId);
    const arr = childrenByParent.get(outerId);
    if (arr) arr.push(n.id);
    else childrenByParent.set(outerId, [n.id]);
  }
  return { childrenByParent, parentByChild };
}

/**
 * A nested node is visible only when its whole nest-ancestor chain is expanded.
 * Non-nested nodes are always visible. `expanded(id)` reports whether the nest
 * rooted at the given OUTER node id is currently open.
 */
function isVisible(
  id: string,
  nodeById: Map<string, ThreadNode>,
  parentByChild: Map<string, string>,
  expanded: (outerId: string) => boolean,
): boolean {
  const n = nodeById.get(id);
  if (!n?.nested) return true;
  const outer = parentByChild.get(id);
  if (!outer) return true; // unparented nested node — show it (never hide truth)
  return expanded(outer) && isVisible(outer, nodeById, parentByChild, expanded);
}

/**
 * Collapse the thread: drop nested nodes whose nest is not expanded, and any
 * edge that touches a dropped node. The outer nodes survive (they carry the
 * badge); collapsing is lossless — expanding everything reproduces the input
 * node set exactly (round-trip invariant, asserted in the test).
 */
export function collapseNests(
  thread: Thread,
  nests: NestInfo,
  expanded: (outerId: string) => boolean,
): Thread {
  const nodeById = new Map(thread.nodes.map((n) => [n.id, n]));
  const visible = (id: string) =>
    isVisible(id, nodeById, nests.parentByChild, expanded);

  const nodes = thread.nodes.filter((n) => visible(n.id));
  const kept = new Set(nodes.map((n) => n.id));
  const edges = thread.edges.filter((e) => kept.has(e.from) && kept.has(e.to));
  return { ...thread, nodes, edges };
}

/**
 * Synthesize an inner→outer "runs before" flow edge for every visible nested
 * child (children-first execution order — the inner call runs before the outer
 * one wraps it). Reuses the existing `flow` edge grammar (solid). Appended only
 * for expanded nests, so collapsed threads are byte-identical to before.
 */
export function nestFlowEdges(
  visibleNodes: ThreadNode[],
  nests: NestInfo,
): ThreadEdge[] {
  const kept = new Set(visibleNodes.map((n) => n.id));
  const out: ThreadEdge[] = [];
  for (const [child, outer] of nests.parentByChild) {
    if (kept.has(child) && kept.has(outer)) {
      out.push({ from: child, to: outer, kind: "flow", irSource: null });
    }
  }
  return out;
}

// ── agent-facing projection (M-NEST L3) ───────────────────────────────
//
// Claude consumes a COMPACT projection of the one complete thread by default,
// and drills into a specific nest only when a trace needs it. The projection
// must preserve the TWO honest states as DISTINCT SEMANTICS — not just visuals —
// so the agent never reads an uncaptured hole as empty-or-complete:
//   • `nestedCollapsed: N`  — N nested calls are collapsed but ARE in the IR;
//                              the agent can drill to get them (full sub-IR).
//   • `uncaptured: true`    — the statement hides calls v1 did NOT decompose
//                              (chain / comprehension / literal); they are NOT
//                              in the IR and cannot be drilled — the path is
//                              genuinely incomplete here.

export interface AgentThreadNode extends ThreadNode {
  /** drillable: this many nested calls collapsed out, but present in the IR. */
  nestedCollapsed?: number;
  /** NOT in IR: the statement hides calls v1 never decomposed — undrillable. */
  uncaptured?: true;
}

export interface AgentThread extends Omit<Thread, "nodes"> {
  nodes: AgentThreadNode[];
}

/**
 * The default agent projection: collapse every nest, then stamp the two honest
 * markers on the surviving outer steps. Node SET equals `collapseNests(full,
 * …, ()=>false)` — the markers are additive fields, so `projection ==
 * collapse(full)` holds (asserted in the test). Drilling = the full thread.
 */
export function projectThreadForAgent(thread: Thread): AgentThread {
  const nests = deriveNests(thread.nodes);
  const collapsed = collapseNests(thread, nests, () => false);
  const nodes: AgentThreadNode[] = collapsed.nodes.map((n) => {
    const childCount = nests.childrenByParent.get(n.id)?.length;
    const out: AgentThreadNode = { ...n };
    if (childCount) out.nestedCollapsed = childCount; // drillable (in IR)
    // Uncaptured is a SEPARATE axis: a node may be both (some args extracted,
    // others — a chain — not). Both markers can coexist and stay distinct.
    if (n.nestsInnerCalls && !n.nestExtracted) out.uncaptured = true;
    return out;
  });
  return { ...collapsed, nodes };
}

/**
 * Opt-in drill: the FULL thread for a nest — all nested nodes, NOT re-collapsed.
 * `outerId` omitted → the whole thread expanded (every nest). When given, only
 * the nest rooted at `outerId` is expanded; other nests stay compact.
 */
export function drillThread(thread: Thread, outerId?: string): Thread {
  const nests = deriveNests(thread.nodes);
  if (!outerId) return collapseNests(thread, nests, () => true); // whole thread
  // Expand the named nest AND every nest transitively inside it, so the drill
  // returns the FULL sub-IR for that nest — never a re-collapsed view.
  const open = new Set<string>([outerId]);
  for (let added = true; added; ) {
    added = false;
    for (const [child, parent] of nests.parentByChild) {
      if (open.has(parent) && !open.has(child)) { open.add(child); added = true; }
    }
  }
  return collapseNests(thread, nests, (id) => open.has(id));
}
