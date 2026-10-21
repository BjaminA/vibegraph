// The architecture PROPOSAL's working state (2026-09-25, Ben: "an animation
// while proposing groups, removed once it has been proposed"). A proposal is
// one thinking-tier spawn that took 78 s on a private production codebase; before this the only
// sign of it was the button reading "Proposing…".
//
// Two carriers, both mounted only while a model is drafting and gone the
// moment the reply (or an error) arrives — the M-GF3.2 working-state
// exception to "no infinite loops", bounded by the real round trip:
//   * this card, under the proposal bar: the shared WorkingCard
//     (tasks/WorkingCard.tsx, 2026-10-21) with what the model is reading and,
//     from the server's task, what it is doing now;
//   * the map's process cards breathe in the proposed accent, staggered, so
//     the reader sees WHAT is being grouped (motion.css, vg-arch-proposing).
// Nothing drawn here is a group: the model has not answered yet, and a
// placeholder box would be a claim.

import React from "react";
import type { ArchModelRecord } from "../../shared/protocol";
import type { GuiTask } from "../tasks/guiTasks";
import { WorkingCard } from "../tasks/WorkingCard";

export function ArchProposingCard({ working, model, task }: { working: "propose" | "revise"; model: ArchModelRecord | null; task?: GuiTask | null }) {
  const processes = model?.nodes.filter((n) => n.kind === "cluster" || n.kind === "hub").length ?? 0;
  const tools = model?.nodes.filter((n) => n.kind === "tool").length ?? 0;
  return (
    <WorkingCard
      data-arch-proposing-card={working}
      title={task?.label ?? (working === "revise" ? "Revising the proposal" : "Proposing groups")}
      startedAt={task?.startedAt}
      steps={task?.steps.length ? task.steps : [{ at: "", text: `reading ${processes} processes and ${tools} tools, the deployment manifests and the docs` }]}
      note="Every group must cite a line it was shown. Nothing applies until you ratify."
      style={{ position: "absolute", top: "max(176px, calc(var(--vg-toolbar-bottom, 43px) + 100px))", left: 250, zIndex: 30, width: 360, pointerEvents: "none" }}
    />
  );
}
