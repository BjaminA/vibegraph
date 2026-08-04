// B5 (PLAN-v6) — runtime-assisted resolution of a dynamic dispatch. For a
// `dynamic` node (a method on a runtime-bound receiver the static linker can't
// resolve to a target), run the enclosing function up to the call site and
// observe the receiver's RUNTIME TYPE — revealing the actual dispatch target
// for THIS run.
//
// The honesty rule is load-bearing: a runtime sample is a DISTINCT state, never
// promoted to static `resolved`. One run, on these inputs, can lie (a different
// run / different inputs may dispatch elsewhere). The node stays `dynamic`; this
// is a labelled observation layered over it, never a rewrite of the IR fact.

import type { EffectOffense } from "../shared/protocol";

export const OBSERVE_NOTE =
  "Runtime sample (this run, these inputs). NOT promoted to a static 'resolved' fact — one run can lie; the node stays dynamic.";

export interface DynamicObservation {
  nodeId: string;
  outcome: string;
  /** repr(type(receiver)) captured at the call site, or null on a non-ok outcome. */
  observedTarget: string | null;
  /** The honesty label — always present. */
  note: string;
  provenance: "real-input";
  /** On requires-confirmation: the effects the floor found + a consent token. */
  effects?: EffectOffense[];
  effectConsentToken?: string | null;
  error?: string;
}
