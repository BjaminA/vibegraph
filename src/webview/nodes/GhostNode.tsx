import React from "react";
import {
  RotateCw, FunctionSquare, Braces, Equal, GitBranch, Box, Plus,
} from "lucide-react";
import { NodeHandles } from "./NodeHandles";

// PLAN-v7 Stage 1 — the ghost/proposed node. It renders the dry-run parse of
// an UNWRITTEN edit as a clearly-not-real preview: the honest IR is untouched
// until the human accepts. Distinct from StubNode (a user-composed draft):
// this is a PROPOSAL of what the parser will produce, gated behind
// accept/reject. Visual state is a muted dashed ring + dimmed body + an
// explicit "PROPOSED — NOT YET WRITTEN" pill (tokens.css: --proposed-*).
//
// 1b — the accept/reject DECISION lives in App.tsx's fixed ProposalActionBar,
// not on the node: an in-canvas node can be occluded by the docked chat panel
// (fixed, z900), so its buttons weren't reliably reachable. The ghost is now a
// pure preview; the always-on-top bar owns the gate.
export interface GhostNodeData {
  label: string;
  kindType: string;
  // PLAN-v7 Stage 1b — the source was drafted by `claude -p`. Shifts the
  // honesty badge to "CLAUDE DRAFT — not yet written" so the human knows they
  // are ratifying a model proposal, not their own composed source.
  drafted?: boolean;
}

interface Props {
  data: GhostNodeData;
}

const TYPE_ICONS: Record<string, JSX.Element> = {
  for_loop: <RotateCw size={16} strokeWidth={1.5} />,
  function_def: <FunctionSquare size={16} strokeWidth={1.5} />,
  call: <Braces size={16} strokeWidth={1.5} />,
  assignment: <Equal size={16} strokeWidth={1.5} />,
  if_stmt: <GitBranch size={16} strokeWidth={1.5} />,
  class_def: <Box size={16} strokeWidth={1.5} />,
};

export function GhostNode({ data }: Props) {
  const icon = TYPE_ICONS[data.kindType] ?? <Plus size={16} strokeWidth={1.5} />;
  const kindLabel = data.kindType.replace("_", " ");

  return (
    <div
      data-ghost-node
      style={{
        position: "relative",
        minWidth: 248,
        background: "var(--bg-node)",
        // DASHED ring in a teal-leaning pending hue + a subtle glow — reads as
        // "becoming on accept", not "disabled". Distinct from the solid
        // kind-coloured borders of real (built) nodes.
        border: "1.5px dashed var(--proposed-border)",
        borderRadius: 12,
        padding: "10px 12px",
        fontFamily: "monospace",
        opacity: "var(--proposed-opacity)",
        boxShadow: "0 0 14px var(--proposed-glow)",
      }}
    >
      <NodeHandles />

      {/* PROPOSED banner — the honesty label, always visible, never subtle */}
      <div
        data-proposed-badge
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-muted)",
          marginBottom: 6,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center" }}>{icon}</span>
        <span>{data.drafted ? "Claude draft — not yet written" : "Proposed — not yet written"}</span>
      </div>

      {/* what it is — full-strength label (legibility over recession) */}
      <div
        style={{
          fontSize: 13,
          color: "var(--text-primary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <span style={{ color: "var(--text-muted)" }}>{kindLabel} </span>
        {data.label}
      </div>
    </div>
  );
}
