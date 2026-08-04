// Extracted diagram-mode canvas (M4b wave 4).
//
// Kept tiny -- this is App.tsx's render path, not a state owner. Lifted
// out so App.tsx can switch between <DiagramCanvas/> and <ThreadView/>
// based on viewMode without breaching the 500-line file cap.

import React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  useStore,
  type Node,
  type Edge,
} from "@xyflow/react";
import { VgMiniMap, fileNodeColor } from "./Minimap";

// M-FV.1 (W4) — re-fit the diagram whenever the canvas's measured size
// changes (window resize, a side dock opening/closing) or the node set
// changes (file switch / filter toggle). react-flow maintains its own
// width/height via an internal ResizeObserver, so keying the fit on those
// dims catches every reflow without a second observer. Mirrors the
// ThreadView re-fit machinery: a quick pass plus a post-transition settle
// pass, since docks animate their width over ~280ms and the quick fit can
// otherwise capture a mid-transition width. Must render INSIDE <ReactFlow>
// (useReactFlow/useStore require the flow context).
function FitOnReflow({ trigger }: { trigger?: unknown }) {
  const rf = useReactFlow();
  const dims = useStore((s) => `${Math.round(s.width)}x${Math.round(s.height)}`);
  React.useEffect(() => {
    if (!rf?.fitView) return;
    const quick = window.setTimeout(() => rf.fitView({ padding: 0.15, duration: 240 }), 60);
    const settled = window.setTimeout(() => rf.fitView({ padding: 0.15, duration: 240 }), 320);
    return () => { window.clearTimeout(quick); window.clearTimeout(settled); };
  }, [rf, dims, trigger]);
  return null;
}

interface ExitGhost {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  nodes: Node[];
  edges: Edge[];
  exitGhosts: ExitGhost[];
  nodeTypes: Record<string, React.ComponentType<any>>;
  edgeTypes: Record<string, React.ComponentType<any>>;
  composeOpen: boolean;
  // M-FV.4 — hide the bottom-right minimap when a right-side dock
  // (CodeView / editor) narrows the canvas and would sit over it.
  hideMinimap?: boolean;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  // M12.2 — invoked on pointerup over any react-flow node so the
  // add-component drag's drop dispatch reaches diagram-view nodes
  // without touching every per-construct node component. Called with
  // the IR/react-flow node id read from .react-flow__node[data-id],
  // and the React.PointerEvent so the caller can stopPropagation.
  //
  // M12 diag fix: this is pointerup, NOT mouseup. React Flow calls
  // setPointerCapture() on pointerdown, which suppresses compatibility
  // mouseup events (per W3C pointer-events spec). Listening for
  // mouseup meant the handler never fired during a real drop.
  onAnyNodePointerUp?: (event: React.PointerEvent, nodeId: string) => void;
}

export function DiagramCanvas({
  nodes, edges, exitGhosts, nodeTypes, edgeTypes, composeOpen, hideMinimap, onNodeClick,
  onAnyNodePointerUp,
}: Props) {
  // React Flow v12 doesn't expose onNodePointerUp directly. Use
  // elementsFromPoint(clientX, clientY) to find the topmost
  // .react-flow__node under the cursor — e.target is unreliable
  // because the react-flow pane and SVG edge paths sit above the
  // nodes in DOM paint order. (M14 found the same issue for mousemove.)
  const handlePointerUp = (e: React.PointerEvent) => {
    if (!onAnyNodePointerUp) return;
    const stack = document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[];
    const nodeEl = stack.find((el) => el.classList?.contains("react-flow__node"));
    if (!nodeEl) return;
    const nodeId = nodeEl.dataset.id;
    if (!nodeId) return;
    onAnyNodePointerUp(e, nodeId);
  };
  return (
    <div style={{ width: "100%", height: "100%" }} onPointerUp={handlePointerUp}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        // react-flow's default minZoom (0.5) clamps fitView on tall M-FV
        // file layouts, leaving nodes unreachable by fit (same M23 bug
        // ThreadView fixed) — match its floor.
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        // Don't let react-flow grab Space for pan-on-drag — it
        // preventDefault's the spacebar at the window level, which broke
        // typing in the floating Monaco editor. Drag-pan + scroll remain.
        panActivationKeyCode={null}
        style={{
          background: "var(--bg-canvas)",
          marginLeft: composeOpen ? 230 : 0,
          transition: "margin-left 0.18s ease",
        }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        onNodeClick={onNodeClick}
      >
        {/* 2026-08-04 — the trigger was `nodes.length` alone, so revealing an
            edge family re-fit NOTHING: the edge toggles change edges, not
            nodes. On predict.py both flow edges landed above the viewport
            (y = -290 and -375) and the toggle looked dead. Edge count is part
            of what the fit has to cover, so it is part of the trigger. */}
        <FitOnReflow trigger={`${nodes.length}:${edges.length}`} />
        <Background color="var(--border-edge)" gap={24} size={1} />
        <Controls style={{ background: "var(--bg-node)", borderColor: "var(--border-edge)" }} />
        {!hideMinimap && <VgMiniMap nodeColor={fileNodeColor} />}
      </ReactFlow>
      {exitGhosts.length > 0 && (
        <div className="vg-node-exit-layer">
          {exitGhosts.map((g) => (
            <div
              key={g.id}
              className="vg-node-exit-ghost"
              style={{ left: g.x, top: g.y, width: g.width, height: g.height }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
