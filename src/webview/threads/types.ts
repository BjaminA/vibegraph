// Thread JSON v1.0 shape — matches the output of scripts/extract_thread.py
// exactly. Kept narrow and discriminated-union-ish on `kind` so the
// renderer can switch on it without runtime checks elsewhere.

export type ThreadNodeKind =
  | "seed"
  | "step"
  | "external"
  | "dynamic"
  // R3 — a bare reference the linker could not resolve and that is NOT a
  // local binding: a resolution gap, distinct from `dynamic` (genuine
  // runtime dispatch). Rendered ghosted + --text-muted so it reads as
  // "couldn't find this", never as "runtime-determined".
  | "unresolved"
  | "return"
  // M17.2 — control-flow container kinds. The IR / extractor emits these
  // for try / except / finally / while ancestors of call sites. M17.2
  // ships only the data; ThreadView filters container kinds out of the
  // react-flow render set until M17.3 introduces the bordered-rect
  // visual + react-flow group nodes. Listed here so TypeScript knows
  // about the kind values consumers may encounter in raw thread JSON.
  | "container";

// M17.2 shipped try / except / finally / while. M17.3 adds for plus the
// two if arms: an `if_stmt` is split into `if_then` (chip "IF <cond>") and
// `if_else` (chip "ELSE") containers by source position, so a call in the
// else branch reads as a distinct region from one in the then branch.
export type ContainerKind =
  | "try"
  | "except"
  | "finally"
  | "while"
  | "for"
  | "if_then"
  | "if_else"
  // M-NEST L2 — view-only backdrop wrapping an expanded nest (outer step +
  // its revealed inner calls). Never emitted by the extractor.
  | "nest";

export interface ThreadNode {
  id: string;
  kind: ThreadNodeKind;
  label: string;
  file: string | null;
  irNodeId: string | null;
  preview: string | null;
  // M17.1 — for external terminals whose receiver is a local variable
  // (e.g. `parser.add_subparsers()` where `parser = argparse.ArgumentParser(...)`),
  // `qualifiedTarget` carries the resolved dotted path
  // (e.g. `argparse.ArgumentParser.add_subparsers`) that the M13
  // external-call resolver can actually import; `viaLocal` records the
  // receiver name for display. Both absent on non-via-local terminals.
  qualifiedTarget?: string;
  viaLocal?: string;
  // R4 — dotted dynamic terminals whose receiver is a runtime-bound
  // local (e.g. `conn.execute()` where `conn = _get_conn()`) carry the
  // callee that bound the receiver, so the tooltip can say
  // "receiver 'conn' is a local binding from _get_conn()" instead of
  // attempting (and dishonestly failing) a module import of `conn`.
  receiverBoundFrom?: string;
  // §5.5a — HOW the dynamic receiver was bound: a call-valued local
  // assignment ("local-call", pairs with receiverBoundFrom), a function
  // parameter ("param"), or a for-loop target ("loop"). Lets the tooltip
  // name the binding form instead of falling to a generic line.
  receiverBoundKind?: "local-call" | "param" | "loop";
  // M17.2 — only present when kind === "container". Subtype of the
  // control-flow construct (drives label + accent in the M17.3 renderer).
  containerKind?: ContainerKind;
  // M-NEST L1 (extractor-set) — this terminal is a call nested inside another
  // call's arguments (`self.conv1` in `F.relu(self.conv1(x))`). Collapsed out
  // of the default view; revealed on expand.
  nested?: boolean;
  // M-NEST L2 (view-computed in App.tsx, never serialised) — nest parentage and
  // honesty flags, derived from irNodeId path structure + per-file IR.
  /** outer thread-node id this nested node lives inside. */
  nestedParent?: string;
  /** this (outer) node has ≥1 extracted nested child → expandable badge. */
  hasNested?: boolean;
  /** detector flag: the source statement hides ≥1 nested call (ALL forms). */
  nestsInnerCalls?: boolean;
  /** true when v1 minted child nodes; false = detected-but-deferred (note). */
  nestExtracted?: boolean;
}

// M24 — "flow": an unconditional control-flow join between sibling
// containers (try → finally). Rendered SOLID with its explicit label
// ("always"). Fork arrows into if arms reuse "conditional" (dashed) —
// the grammar is solid = always joins, dashed = conditional entry.
export type ThreadEdgeKind = "direct" | "conditional" | "contains" | "flow";

export interface ThreadEdge {
  from: string;
  to: string;
  kind: ThreadEdgeKind;
  irSource: string | null;
  // M24 — explicit semantic label, only present on flow edges
  // ("always"). Takes precedence over the U3.3 args-label resolution.
  label?: string;
}

export interface Thread {
  version: "1.0";
  seed: {
    file: string;
    irNodeId: string;
    qualifiedName: string;
  };
  nodes: ThreadNode[];
  edges: ThreadEdge[];
}
