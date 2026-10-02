// DECLARED TOPOLOGY (2026-10-02). On a shared data platform — a sync
// database, a message broker, an object store, a CRDT service — the
// architecture that matters (which partitions exist, who may write each, which
// documents live where, which decision rules read which data) is DECLARED AS
// DATA in the code: catalogue arrays, transition tables, decision trees, a
// principals file. The resource names are COMPUTED at run time, so static call
// analysis sees "calls writeDoc" and nothing else.
//
// The project hands VibeGraph that data through a GENERATOR it owns: a command
// that reads the declarations and prints this shape (schemas/topology.schema.json).
// VibeGraph never guesses it from prose and never asks a model for it. Every
// item may cite the `file:line` it is declared at. Webview-safe: types only.

export const TOPOLOGY_VERSION = "1";

/** `file:line` of the declaration this item was read from. */
export type Cite = string;

export interface TopoStore { id: string; kind?: string; label?: string; cite?: Cite }
export interface TopoZone { id: string; store: string; label?: string; holds?: string[]; cite?: Cite }
export interface TopoFamily { id: string; pattern?: string; zone?: string; label?: string; cite?: Cite }
export interface TopoPrincipal { id: string; kind?: "service" | "human" | "role-holder" | "owner" | string; roles?: string[]; label?: string; cite?: Cite }
export interface TopoGrant {
  /** a principal id, or `role:<name>` */
  who: string;
  zone: string;
  access: "read" | "write";
  cite?: Cite;
}
export interface TopoRouter {
  /** the function that maps a document to its zone (`zoneFor`, `Router.route`) */
  function: string;
  file?: string;
  /** the zones it routes to (when the declaration says) */
  zones?: string[];
  cite?: Cite;
}
export interface TopoTransition {
  from: string;
  to: string;
  /** who may make it (principal ids or `role:<name>`) */
  roles?: string[];
  /** what must hold first (prose or family ids) */
  requires?: string[];
  cite?: Cite;
}
export interface TopoStateMachine {
  id: string;
  /** the document family whose state it is */
  family?: string;
  states?: string[];
  transitions: TopoTransition[];
  /** the function that applies a transition */
  evaluatedBy?: string;
  cite?: Cite;
}
export interface TopoDecisionNode {
  id: string;
  question?: string;
  /** families (or `zone:<id>`) the node reads its evidence from */
  reads?: string[];
  /** the function that evaluates it */
  evaluatedBy?: string;
  yes?: string;
  no?: string;
  /** a leaf: the decision it reaches */
  outcome?: string;
  cite?: Cite;
}
export interface TopoDecisionTree { id: string; root: string; nodes: TopoDecisionNode[]; cite?: Cite }

export interface Topology {
  version: typeof TOPOLOGY_VERSION;
  stores?: TopoStore[];
  zones?: TopoZone[];
  families?: TopoFamily[];
  principals?: TopoPrincipal[];
  grants?: TopoGrant[];
  routers?: TopoRouter[];
  stateMachines?: TopoStateMachine[];
  decisionTrees?: TopoDecisionTree[];
}

/** A registered generator and what its last run produced. */
export interface TopologySource {
  id: string;
  generator: string;
  /** files, folders (trailing /) or globs the declarations live in */
  inputs: string[];
}

export interface TopologyStatus {
  source: TopologySource;
  state: "fresh" | "stale" | "never-run" | "failed";
  generatedAt?: string;
  detail: string;
}

/** What the views and checks read: every fresh-or-stale source merged. */
export interface TopologyModel {
  topology: Topology;
  status: TopologyStatus[];
  /** what merging could not reconcile (two sources, one id, different shapes) */
  conflicts: string[];
}
