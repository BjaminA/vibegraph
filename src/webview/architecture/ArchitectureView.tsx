// Architecture view (C) — the 5th lens. Renders each nn.Module model as a
// clean stacked schematic in forward-application order: one glyph per declared
// layer, primary compute blocks + inline markers, connected top→down as the
// data path. Pure derived view over the per-file IR (deriveModels); honest
// about what the IR can't see (functional ops / nested calls live in the
// forward thread, not here).

import React, { useMemo } from "react";
import { ReactFlow, Background, Controls, MarkerType, Position, type Node, type Edge } from "@xyflow/react";
import { Boxes } from "lucide-react";
import type { ProjectFileData } from "../types";
import { deriveModels, type ArchModel } from "./architecture";
import {
  LayerGlyphNode, ModelHeaderNode, layerVisual,
  GLYPH_W, PRIMARY_H, MARKER_H, HEADER_H,
} from "./LayerGlyphNode";

const nodeTypes = { layerGlyph: LayerGlyphNode, modelHeader: ModelHeaderNode };

const COL_W = GLYPH_W + 120; // column pitch for side-by-side models
const ROW_GAP = 18;

function buildArchitectureLayout(models: ArchModel[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  models.forEach((m, ci) => {
    const x = ci * COL_W;
    nodes.push({
      id: `hdr:${m.classNodeId}`,
      type: "modelHeader",
      position: { x, y: 0 },
      data: { model: m },
      width: GLYPH_W,
      height: HEADER_H,
      draggable: false,
    });

    let y = HEADER_H + ROW_GAP * 1.5;
    let prevId: string | null = null;
    m.layers.forEach((layer) => {
      const visual = layerVisual(layer.type);
      const h = visual.tier === "marker" ? MARKER_H : PRIMARY_H;
      const id = `layer:${layer.irNodeId}`;
      nodes.push({
        id,
        type: "layerGlyph",
        position: { x, y },
        // W5 — carry the owning model so a layer-glyph click can open its
        // forward() data-path thread (it's a dead-end otherwise).
        data: { layer, visual, model: m },
        width: GLYPH_W,
        height: h,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        draggable: false,
      });
      if (prevId) {
        edges.push({
          id: `e:${prevId}->${id}`,
          source: prevId,
          target: id,
          type: "default",
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-thread)", width: 14, height: 14 },
          style: { stroke: "var(--accent-thread)", strokeWidth: 1.5, opacity: 0.6 },
        });
      }
      prevId = id;
      y += h + ROW_GAP;
    });
  });

  return { nodes, edges };
}

interface Props {
  projectIR: Record<string, ProjectFileData>;
  /** Open a model's forward() as a data-path thread (B). */
  onOpenForward?: (model: ArchModel) => void;
}

export function ArchitectureView({ projectIR, onOpenForward }: Props) {
  const models = useMemo(() => deriveModels(projectIR), [projectIR]);
  const base = useMemo(() => buildArchitectureLayout(models), [models]);
  // Inject the forward-thread callback into each header's data (react-flow
  // custom nodes receive only `data`), mirroring SystemView's onOpenThread.
  const nodes = useMemo(
    () => base.nodes.map((n) => (n.type === "modelHeader" ? { ...n, data: { ...n.data, onOpenForward } } : n)),
    [base.nodes, onOpenForward],
  );
  const edges = base.edges;

  if (models.length === 0) {
    return (
      <div
        className="vg-architecture-empty"
        data-architecture-empty
        style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100%", gap: 12, color: "var(--text-secondary)",
        }}
      >
        <Boxes size={32} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-14)" }}>
          No PyTorch models found
        </div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", color: "var(--text-muted)" }}>
          This lens shows classes that subclass <code>nn.Module</code> as layer schematics.
        </div>
      </div>
    );
  }

  return (
    <div className="vg-architecture-view" data-architecture-view style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        panActivationKeyCode={null}
        style={{ background: "var(--bg-canvas)" }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_: React.MouseEvent, n: Node) => {
          // Node clicks route through react-flow (the pane swallows inner
          // onClick). W5 — a header OR a layer-glyph click opens that
          // model's forward() data-path thread (layers were dead-ends).
          if (n.type === "modelHeader" || n.type === "layerGlyph") {
            const m = (n.data as { model?: ArchModel }).model;
            if (m) onOpenForward?.(m);
          }
        }}
      >
        <Background color="var(--border-edge)" gap={24} size={1} />
        <Controls style={{ background: "var(--bg-node)", borderColor: "var(--border-edge)" }} />
      </ReactFlow>
    </div>
  );
}
