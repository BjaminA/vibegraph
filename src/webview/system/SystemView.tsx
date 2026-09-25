// System view (M19.2, PLAN-v5 §1) — the discrete 4th view. Renders the
// envelope's system tier as subsystem cards on an L-R react-flow canvas:
// Frontend -> Backend -> Cache/DB/external. Click-to-drill is M19.3.
//
// Thread-interaction mode (M-SI): a persisted toggle swaps the subsystem
// cards for a thread-to-thread graph (one node per thread/entry point, a
// directed edge wherever one thread reaches another's entry-point head).
// Clicking a thread node opens that thread.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, useStore, useReactFlow, type Node, type Edge } from "@xyflow/react";
import { crossedToThread } from "../threads/lod";
import { Network, Boxes, Share2, Map as MapIcon } from "lucide-react";
import type { SystemTier, SystemPlan, EntryPoint, ProjectThread } from "../types";
import { buildSystemLayout } from "./buildSystemLayout";
import { buildThreadInteractionLayout } from "./threadInteraction";
import { SubsystemNode } from "./SubsystemNode";
import { PlannedSubsystemNode } from "./PlannedSubsystemNode";
import { ThreadInteractionNode } from "./ThreadInteractionNode";
import { DraftingGhostCard } from "./DraftingGhostCard";
import { ArchNode } from "./ArchNode";
import { ArchGroupBox } from "./ArchGroupBox";
import { buildArchLayout, ARCH_LENSES, layoutBounds, readableViewport, type ArchLens } from "./archLayout";
import { ArchEdge } from "./ArchEdge";
import { ArchTraceBar, useArchTrace } from "./ArchTrace";
import { ArchInspector, ArchLegend, ArchLensBar, ArchProposalBar } from "./ArchPanel";
import { ArchProposingCard } from "./ArchProposingCard";
import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord, ArchGroupRecord } from "../../shared/protocol";

const nodeTypes = {
  subsystem: SubsystemNode,
  plannedSubsystem: PlannedSubsystemNode,
  threadInteraction: ThreadInteractionNode,
  archNode: ArchNode,
  archGroup: ArchGroupBox,
};
const edgeTypes = { archEdge: ArchEdge };

/** Reports the subsystem cards' MEASURED heights (inside the canvas, where
 *  react-flow's store is), so the layout can stack them by their real size;
 *  fits the view once, when the first real heights arrive. */
function MeasuredHeights({ onHeights }: { onHeights: (m: Map<string, number>) => void }) {
  const key = useStore((st) => [...st.nodeLookup.values()]
    .filter((n) => n.type === "subsystem" || n.type === "plannedSubsystem")
    .map((n) => `${n.id}=${Math.round(n.measured?.height ?? 0)}`).join("|"));
  const rf = useReactFlow();
  const fitted = useRef(false);
  useEffect(() => {
    const m = new Map<string, number>();
    for (const part of key ? key.split("|") : []) {
      const i = part.lastIndexOf("=");
      const h = Number(part.slice(i + 1));
      if (h > 0) m.set(part.slice(0, i), h);
    }
    if (!m.size) return;
    onHeights(m);
    if (!fitted.current) { fitted.current = true; window.setTimeout(() => rf.fitView({ padding: FIT_PADDING }), 50); }
  }, [key, onHeights, rf]);
  return null;
}
/** where the map's first view starts: clear of the toolbar, lens and proposal bars. */
const MAP_INSET = { top: 136, left: 0, pad: 24, right: 64 };

// M-ARCH.2 — "map": the architecture model (clusters, boundary tools,
// protocol edges) under a lens. The subsystem/thread toggle is untouched.
type SystemMode = "subsystems" | "threads" | "map";

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
  // M-STACK.3 — the stack facts, so a subsystem card can name the tools
  // behind it instead of a bare kind. Absent = no index (single-file).
  stack?: import("../../shared/protocol").StackIndexRecord | null;
  /** M-XLANG.1 - cross-language hops, drawn in thread-interaction mode. */
  crossings?: import("../../shared/protocol").CrossingIndexRecord | null;
  /** M-ZOOM (PLAN-v5 5.2) - the thread the reader zoomed OUT of. Arriving
   *  with it set opens the THREAD plane with that card marked, so the
   *  continuum keeps its place instead of dropping them at the top of a
   *  map. Zooming back IN past the band descends into it. */
  focusEntryPointId?: string | null;
  /** M19.3 — drill into a subsystem's code (card-body click). */
  onSelectSubsystem?: (subsystemId: string) => void;
  /** M-GF3.2 — the describe round-trip in flight: the description being
      drafted, or null. Mounts the animated drafting placeholder. */
  draftingDescription?: string | null;
  /** M-ARCH.2 — the derived architecture model (envelope `architecture`). */
  architecture?: ArchModelRecord | null;
  /** M-ARCH.4 — the proposal round trip, and the three actions. */
  archPropose?: { busy: boolean; error: string | null; working?: "propose" | "revise" | null };
  onArchAction?: (action: "propose" | "ratify" | "reject", guidance?: string) => void;
}

/** Fit padding: the top clears the toolbar band and the mode / lens bar that
 *  float over the canvas (a proportional 0.2 put the top cards under both). */
const FIT_PADDING = { top: "150px", bottom: "40px", left: "40px", right: "40px" } as const;

export function SystemView({
  system,
  plan = null,
  threads = [],
  entryPoints = [],
  onOpenThread,
  stack,
  crossings,
  focusEntryPointId,
  onSelectSubsystem,
  draftingDescription = null,
  architecture = null,
  archPropose,
  onArchAction,
}: Props) {
  // M-ZOOM - armed after mount for the same reason ThreadView is: this
  // view is arrived at, and an unarmed descend bounces straight back.
  const lastZoomRef = useRef<number>(1);
  const armedRef = useRef(false);
  useEffect(() => {
    armedRef.current = false;
    const t = setTimeout(() => { armedRef.current = true; }, 500);
    return () => clearTimeout(t);
  }, [focusEntryPointId]);
  const [mode, setMode] = useState<SystemMode>(() => {
    try {
      const m = localStorage.getItem("vg-system-mode");
      return m === "threads" || m === "map" ? m : "subsystems";
    } catch {
      return "subsystems";
    }
  });
  const persistMode = (next: SystemMode) => {
    try {
      localStorage.setItem("vg-system-mode", next);
    } catch {
      /* ignore */
    }
    return next;
  };
  // From the map the subsystem/thread toggle returns to subsystems first.
  const toggleMode = () => setMode((m) => persistMode(m === "subsystems" ? "threads" : "subsystems"));
  const toggleMap = () => setMode((m) => persistMode(m === "map" ? "subsystems" : "map"));
  const [lens, setLensState] = useState<ArchLens>(() => {
    try {
      const l = localStorage.getItem("vg-arch-lens") as ArchLens | null;
      return l && ARCH_LENSES.includes(l) ? l : "overview";
    } catch {
      return "overview";
    }
  });
  const setLens = (l: ArchLens) => {
    setLensState(l);
    try { localStorage.setItem("vg-arch-lens", l); } catch { /* ignore */ }
  };
  // Measured card heights for the subsystem stack (MeasuredHeights).
  const [cardHeights, setCardHeights] = useState<Map<string, number> | null>(null);
  const onHeights = React.useCallback((m: Map<string, number>) => {
    setCardHeights((prev) => (prev && prev.size === m.size && [...m].every(([k, v]) => prev.get(k) === v) ? prev : m));
  }, []);
  const [archSelected, setArchSelected] = useState<{ node: ArchNodeRecord } | { edge: ArchEdgeRecord } | { group: ArchGroupRecord } | null>(null);

  const base = useMemo((): { nodes: Node[]; edges: Edge[]; hiddenTools?: string[]; hiddenClusters?: string[] } => {
    if (mode === "map" && !focusEntryPointId) {
      return architecture ? buildArchLayout(architecture, lens) : { nodes: [], edges: [] };
    }
    if (mode === "threads" || focusEntryPointId) {
      const laid = buildThreadInteractionLayout(threads, entryPoints, crossings);
      // M-ZOOM - mark the thread we came from. Data only: the node
      // component reads `focused` and the spec can assert on it.
      return focusEntryPointId
        ? {
          ...laid,
          nodes: laid.nodes.map((n) =>
            n.id === focusEntryPointId ? { ...n, data: { ...n.data, focused: true } } : n),
        }
        : laid;
    }
    // PLAN-v7 Stage 3 — compose honest + planned at render. A plan can exist
    // over an EMPTY honest tier (3b greenfield): the ghost architecture is
    // the whole view then.
    if (system || plan) return buildSystemLayout(system ?? { subsystems: [], edges: [] }, plan, cardHeights ?? undefined);
    return { nodes: [], edges: [] };
  }, [mode, system, plan, threads, entryPoints, crossings, focusEntryPointId, architecture, lens, cardHeights]);

  // Inject the drill-down callback into each node's data (react-flow custom
  // nodes receive only `data`): subsystem endpoint rows AND thread nodes both
  // open a thread via onOpenThread.
  const trace = useArchTrace(mode === "map" ? architecture : null, base);
  const decorated = mode === "map" ? trace.decorate(base.nodes, base.edges) : base;
  const nodes = useMemo(
    () => decorated.nodes.map((n) => ({ ...n, data: { ...n.data, onOpenThread, stack } })),
    [decorated.nodes, onOpenThread, stack],
  );
  const edges = decorated.edges;
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelOf = (id: string) => (base.nodes.find((n) => n.id === id)?.data as { node?: ArchNodeRecord } | undefined)?.node?.label ?? id;

  const handleEdgeClick = (_: React.MouseEvent, edge: Edge) => {
    if (mode === "map") {
      const e = (edge.data as { edge?: ArchEdgeRecord } | undefined)?.edge;
      if (e) setArchSelected({ edge: e });
      return;
    }
    const d = edge.data as { kind?: string; viaThreads?: string[] } | undefined;
    if (d?.kind === "effect" && d.viaThreads?.length) onOpenThread?.(d.viaThreads[0]);
  };

  const handleNodeClick = (_: React.MouseEvent, n: Node) => {
    if (mode === "map") {
      if (trace.actions.pick(n.id)) return;
      const d = n.data as { node?: ArchNodeRecord; group?: ArchGroupRecord } | undefined;
      if (d?.node) setArchSelected({ node: d.node });
      else if (d?.group) setArchSelected({ group: d.group });
      return;
    }
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
  const hasArch = !!architecture && architecture.nodes.length > 0;

  // Genuinely-empty project (single-file mode): no canvas, no toggle.
  // M-GF3.2 — while a describe round-trip is in flight (3b greenfield: this
  // is exactly the blank case), the drafting placeholder replaces the empty
  // copy: the wait has a face.
  if (!hasSubsystems && !hasThreads && !hasPlanned && !hasArch) {
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
    <div ref={wrapRef} className="vg-system-view" data-system-view data-system-mode={mode}
      // Keyboard (reviews/m-arch/COMPARE.md): Tab reaches a card, Enter opens it
      // exactly as a click does.
      onKeyDown={(ev) => {
        if (mode !== "map" || ev.key !== "Enter") return;
        const el = (ev.target as HTMLElement).closest?.(".react-flow__node") as HTMLElement | null;
        const n = el ? nodes.find((x) => x.id === el.dataset.id) : undefined;
        if (n) { ev.preventDefault(); handleNodeClick(ev as unknown as React.MouseEvent, n); }
      }}
      // While a model drafts groups, the processes it is grouping breathe
      // (motion.css, vg-arch-proposing); the attribute goes with the reply.
      data-arch-proposing={mode === "map" && archPropose?.working ? archPropose.working : undefined}
      style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Mode toggle — top-left of the canvas (mirrors the thread-view
          orientation toggle), clear of the breadcrumb. */}
      <button
        data-system-mode-toggle
        data-mode={mode}
        onClick={toggleMode}
        title={mode === "threads" ? "Show subsystems" : "Show how threads interact"}
        style={{
          position: "absolute",
          // Below the toolbar however far it wraps (overlap pass).
          top: "max(84px, calc(var(--vg-toolbar-bottom, 43px) + 8px))",
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

      {/* M-ARCH.2 — the architecture map: clusters, boundary tools and the
          protocol on every edge, all derived from the IR. */}
      <button
        data-system-arch-toggle
        data-active={mode === "map" ? "true" : "false"}
        onClick={toggleMap}
        title={mode === "map" ? "Leave the architecture map" : "Architecture map — clusters, tools and the protocol on every edge, derived from the code"}
        style={{
          position: "absolute", top: "max(84px, calc(var(--vg-toolbar-bottom, 43px) + 8px))", left: 132, zIndex: 30,
          display: "flex", alignItems: "center", gap: 6,
          background: mode === "map"
            ? "color-mix(in oklab, var(--accent-thread) 18%, var(--bg-node))"
            : "color-mix(in oklab, var(--bg-node) 90%, transparent)",
          border: `1px solid ${mode === "map" ? "var(--accent-thread)" : "var(--border-edge)"}`,
          borderRadius: 8, padding: "5px 10px",
          color: mode === "map" ? "var(--text-primary)" : "var(--text-secondary)",
          fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", cursor: "pointer",
          backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        }}
      >
        <MapIcon size={14} strokeWidth={1.5} />
        Architecture
      </button>
      {mode === "map" && <ArchLensBar lens={lens} onLens={(l) => { setLens(l); setArchSelected(null); }} onStory={trace.beats.length ? trace.actions.story : undefined} />}
      {mode === "map" && architecture && <ArchLegend model={architecture} hiddenTools={base.hiddenTools ?? []} hiddenClusters={base.hiddenClusters ?? []} lens={lens} fold={!!archSelected} />}
      {mode === "map" && <ArchTraceBar mode={trace.mode} beats={trace.beats} labelOf={labelOf} actions={trace.actions} />}
      {mode === "map" && architecture && (
        <ArchProposalBar model={architecture} state={archPropose ?? { busy: false, error: null }} onAction={onArchAction} />
      )}
      {mode === "map" && archPropose?.working && <ArchProposingCard working={archPropose.working} model={architecture} />}
      {mode === "map" && architecture && (
        <ArchInspector selected={archSelected} model={architecture} onClose={() => setArchSelected(null)} onOpenThread={onOpenThread}
          onReach={(id, dir) => trace.actions.reach(id, dir)} onRouteFrom={(id) => { trace.actions.routeFrom(id); setArchSelected(null); }} />
      )}

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
            : mode === "map"
              ? "No architecture model yet — it is derived once the project's threads are extracted."
              : "No subsystems detected for this project."}
        </div>
      )}

      <ReactFlow
        // M-ZOOM - the continuum's other direction: zooming IN past the
        // band, while a thread is focused, descends into it. Crossing,
        // once, so sitting zoomed-in does not re-fire.
        onMove={(_, viewport) => {
          const prev = lastZoomRef.current;
          lastZoomRef.current = viewport.zoom;
          if (armedRef.current && focusEntryPointId && crossedToThread(prev, viewport.zoom)) {
            armedRef.current = false; // one transition per visit
            onOpenThread?.(focusEntryPointId);
          }
        }}
        // Remount on mode switch so fitView re-runs for the new graph's
        // coordinates (fitView only fits on mount, and the subsystem vs
        // thread layouts occupy different coordinate spaces). PLAN-v7
        // Stage 3: the ghost count joins the key so a plan arriving /
        // clearing also re-fits — ghosts land in view, not off-canvas.
        key={`${mode}:${mode === "map" ? lens : ""}:${plan ? plan.subsystems.length : 0}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // The map starts READABLE (fit all, else fit width, else the label
        // floor, from the top-left); every other mode fits everything.
        fitView={mode !== "map"}
        fitViewOptions={{ padding: FIT_PADDING }}
        minZoom={0.1}
        onInit={(inst) => {
          if (mode !== "map" || !base.nodes.length) return;
          const r = wrapRef.current?.getBoundingClientRect();
          if (r) inst.setViewport(readableViewport(layoutBounds(base.nodes), r.width, r.height, MAP_INSET, lens === "birdseye" ? 0.35 : undefined));
        }}
        proOptions={{ hideAttribution: true }}
        panActivationKeyCode={null}
        style={{ background: "var(--bg-canvas)" }}
        nodesDraggable={mode !== "map"}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={() => setArchSelected(null)}
      >
        {mode === "subsystems" && !focusEntryPointId && <MeasuredHeights onHeights={onHeights} />}
        <Background color="var(--border-edge)" gap={24} size={1} />
        <Controls style={{ background: "var(--bg-node)", borderColor: "var(--border-edge)" }} />
      </ReactFlow>
    </div>
  );
}
