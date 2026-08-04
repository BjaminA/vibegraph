import React from "react";
import { NodeHandles } from "./NodeHandles";

export interface ModuleNodeData {
  filePath: string;
  fileName: string;
  functionCount: number;
  classCount: number;
  nodeCount: number;
}

interface Props {
  data: ModuleNodeData;
}

export function ModuleNode({ data }: Props) {
  const handleZoom = (e: React.MouseEvent) => {
    e.stopPropagation();
    document.dispatchEvent(
      new CustomEvent("vg-zoom-to-file", { detail: { filePath: data.filePath } })
    );
  };

  return (
    <div
      style={{
        width: 280,
        background: "var(--bg-node)",
        border: "1.5px solid color-mix(in oklab, var(--accent-thread) 45%, transparent)",
        borderRadius: 10,
        padding: "var(--node-pad-y) var(--node-pad-x)",
        fontFamily: "monospace",
        boxShadow: "0 0 18px color-mix(in oklab, var(--accent-thread) 8%, transparent)",
        position: "relative",
      }}
    >
      <NodeHandles />
      {/* file name */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--node-inline-gap)", marginBottom: "var(--node-inline-gap)" }}>
        <span
          style={{
            color: "var(--accent-thread)",
            fontSize: 13,
            fontWeight: 700,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.fileName}
        </span>
        <button
          onClick={handleZoom}
          title="Open file"
          style={{
            background: "color-mix(in oklab, var(--accent-thread) 15%, transparent)",
            border: "1px solid color-mix(in oklab, var(--accent-thread) 35%, transparent)",
            borderRadius: 5,
            color: "var(--accent-thread)",
            cursor: "pointer",
            fontSize: 12,
            padding: "var(--sp-1) var(--sp-2)",
            fontFamily: "monospace",
            fontWeight: 700,
            transition: "background 0.1s",
          }}
        >
          Open →
        </button>
      </div>

      {/* stats — per-kind colour preserved via tokens (fn=thread, cls=secondary, nodes=muted) */}
      <div style={{ display: "flex", gap: "var(--node-inline-gap)" }}>
        <Stat label="fn" value={data.functionCount} color="var(--accent-thread)" />
        <Stat label="cls" value={data.classCount} color="var(--text-secondary)" />
        <Stat label="nodes" value={data.nodeCount} color="var(--text-muted)" />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-1)",
        fontSize: 11,
        color: "var(--text-muted)",
      }}
    >
      <span style={{ color, fontWeight: 700 }}>{value}</span>
      <span>{label}</span>
    </div>
  );
}
