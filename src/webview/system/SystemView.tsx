// System view (M19.2, PLAN-v5 §1) — the discrete 4th view. Renders the
// envelope's system tier as subsystem cards on an L-R react-flow canvas:
// Frontend -> Backend -> Cache/DB/external. Click-to-drill is M19.3.
//
// Thread-interaction mode (M-SI): a persisted toggle swaps the subsystem
// cards for a thread-to-thread graph (one node per thread/entry point, a
// directed edge wherever one thread reaches another's entry-point head).
// Clicking a thread node opens that thread.

import React, { useMemo, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import { Network, Boxes, Share2 } from "lucide-react";
import type { SystemTier, SystemPlan, EntryPoint, ProjectThread } from "../types";
import { buildSystemLayout } from "./buildSystemLayout";
import { buildThreadInteractionLayout } from "./threadInteraction";
import { SubsystemNode } from "./SubsystemNode";
import { PlannedSubsystemNode } from "./PlannedSubsystemNode";
import { ThreadInteractionNode } from "./ThreadInteractionNode";
import { DraftingGhostCard } from "./DraftingGhostCard";

const nodeTypes = {
  subsystem: SubsystemNode,
  plannedSubsystem: PlannedSubsystemNode,
  threadInteraction: ThreadInteractionNode,
};

type SystemMode = "subsystems" | "threads";

interface Props {
  system: SystemTier | null;
  /** PLAN-v7 Stage 3 — the proposed architecture (pending or ratified). A
      SIBLING of the honest tier: composed only inside buildSystemLayout,
      never merged into `system`. */
  plan?: SystemPlan | null;
  /** Cross-thread-call mode source data. */
  threads?: ProjectThread[];
  entryPoints?: EntryPoint[];
  /** M19.3 — drill into a thread (endpoint row / effect-edge click, or a
      thread node in thread-interaction mode). */
  onOpenThread?: (entryPointId: string) => void;
  /** M19.3 — drill into a subsystem's code (card-body click). */
  onSelectSubsystem?: (subsystemId: string) => void;
  /** M-GF3.2 — the describe round-trip in flight: the description being
      drafted, or null. Mounts the animated drafting placeholder. */
  draftingDescription?: string | null;
}

export function SystemView({
  system,
  plan = null,
  threads = [],
  entryPoints = [],
  onOpenThread,
  onSelectSubsystem,
  draftingDescription = null,
}: Props) {
  const [mode, setMode] = useState<SystemMode>(() => {
    try {
      return localStorage.getItem("vg-system-mode") === "threads" ? "threads" : "subsystems";
    } catch {
      return "subsystems";
    }
  });
  const toggleMode = () =>
    setMode((m) => {
      const next: SystemMode = m === "threads" ? "subsystems" : "threads";
      try {
        localStorage.setItem("vg-system-mode", next);
      } catch {
        /* ignore */
      }
      return next;
    });

  const base = useMemo(() => {
    if (mode === "threads") return buildThreadInteractionLayout(threads, entryPoints);
    // PLAN-v7 Stage 3 — compose honest + planned at render. A plan can exist
    // over an EMPTY honest tier (3b greenfield): the ghost architecture is
    // the whole view then.
    if (system || plan) return buildSystemLayout(system ?? { subsystems: [], edges: [] }, plan);
    return { nodes: [], edges: [] };
  }, [mode, system, plan, threads, entryPoints]);

  // Inject the drill-down callback into each node's data (react-flow custom
  // nodes receive only `data`): subsystem endpoint rows AND thread nodes both
  // open a thread via onOpenThread.
  const nodes = useMemo(
    () => base.nodes.map((n) => ({ ...n, data: { ...n.data, onOpenThread } })),
    [base.nodes, onOpenThread],
  );
  const edges = base.edges;

  const handleEdgeClick = (_: React.MouseEvent, edge: Edge) => {
    const d = edge.data as { kind?: string; viaThreads?: string[] } | undefined;
    if (d?.kind === "effect" && d.viaThreads?.length) onOpenThread?.(d.viaThreads[0]);
  };

  const handleNodeClick = (_: React.MouseEvent, n: Node) => {
    if (mode === "threads") { onOpenThread?.(n.id); return; } // n.id === entryPointId
    // PLAN-v7 Stage 3 — a planned subsystem has no code to drill into yet;
    // the honest drill-down is for built subsystems only.
    if (n.type === "plannedSubsystem") return;
    onSelectSubsystem?.(n.id);
  };

  const hasSubsystems = !!system && system.subsystems.length > 0;
  const hasThreads = threads.length > 0;
  // PLAN-v7 Stage 3 — a planned architecture makes the canvas meaningful even
  // when nothing honest exists yet (3b greenfield: all-ghost view).
  const hasPlanned = !!plan && plan.subsystems.length > 0;

  // Genuinely-empty project (single-file mode): no canvas, no toggle.
  // M-GF3.2 — while a describe round-trip is in flight (3b greenfield: this
  // is exactly the blank case), the drafting placeholder replaces the empty
  // copy: the wait has a face.
  if (!hasSubsystems && !hasThreads && !hasPlanned) {
    return (
      <div
        className="vg-system-empty"
        data-system-empty
        style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100%", gap: 12,
          color: "var(--text-secondary)",
        }}
      >
        {draftingDescription ? (
          <DraftingGhostCard description={draftingDescription} />
        ) : (
          <>
            <Network size={32} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-14)" }}>
              No system tier yet
            </div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", color: "var(--text-muted)" }}>
              Open a project (directory) to see how its subsystems connect.
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="vg-system-view" data-system-view data-system-mode={mode} style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Mode toggle — top-left of the canvas (mirrors the thread-view
          orientation toggle), clear of the breadcrumb. */}
      <button
        data-system-mode-toggle
        data-mode={mode}
        onClick={toggleMode}
        title={mode === "threads" ? "Show subsystems" : "Show how threads interact"}
        style={{
          position: "absolute",
          top: 84,
          left: 12,
          zIndex: 30,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "color-mix(in oklab, var(--bg-node) 90%, transparent)",
          border: "1px solid var(--border-edge)",
          borderRadius: 8,
          padding: "5px 10px",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-11)",
          cursor: "pointer",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        {mode === "threads"
          ? <Share2 size={14} strokeWidth={1.5} />
          : <Boxes size={14} strokeWidth={1.5} />}
        {mode === "threads" ? "Threads" : "Subsystems"}
      </button>

      {/* M-GF3.2 — describe in flight over an existing canvas (re-describe):
          the placeholder floats centered above the graph, hands-off. */}
      {draftingDescription && (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 25, pointerEvents: "none",
          }}
        >
          <DraftingGhostCard description={draftingDescription} />
        </div>
      )}

      {nodes.length === 0 && (
        <div
          data-system-mode-empty
          style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 8, zIndex: 5,
            pointerEvents: "none", color: "var(--text-muted)",
            fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)",
          }}
        >
          {mode === "threads"
            ? "No entry-point threads to graph yet."
            : "No subsystems detected for this project."}
        </div>
      )}

      <ReactFlow
        // Remount on mode switch so fitView re-runs for the new graph's
        // coordinates (fitView only fits on mount, and the subsystem vs
        // thread layouts occupy different coordinate spaces). PLAN-v7
        // Stage 3: the ghost count joins the key so a plan arriving /
        // clearing also re-fits — ghosts land in view, not off-canvas.
        key={`${mode}:${plan ? plan.subsystems.length : 0}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        panActivationKeyCode={null}
        style={{ background: "var(--bg-canvas)" }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
      >
        <Background color="var(--border-edge)" gap={24} size={1} />
        <Controls style={{ background: "var(--bg-node)", borderColor: "var(--border-edge)" }} />
      </ReactFlow>
    </div>
  );
}
