import React from "react";
import { RotateCw, FunctionSquare, Braces, Equal, GitBranch, Box, Plus, X, AlertCircle } from "lucide-react";
import { NodeHandles } from "./NodeHandles";

export interface StubNodeData {
  stubId: string;
  constructType: string;
  sourcePreview: string;
  source: string;
  anchorNodeId: string | null;
  insertMode: "insert_before" | "insert_after" | "append_end";
  filePath?: string;
  error?: string;
}

interface Props {
  data: StubNodeData;
}

const TYPE_ICONS: Record<string, JSX.Element> = {
  for_loop: <RotateCw size={16} strokeWidth={1.5} />,
  function_def: <FunctionSquare size={16} strokeWidth={1.5} />,
  call: <Braces size={16} strokeWidth={1.5} />,
  assignment: <Equal size={16} strokeWidth={1.5} />,
  if_stmt: <GitBranch size={16} strokeWidth={1.5} />,
  class_def: <Box size={16} strokeWidth={1.5} />,
};

export function StubNode({ data }: Props) {
  const icon = TYPE_ICONS[data.constructType] ?? <Plus size={16} strokeWidth={1.5} />;
  const label = data.constructType.replace("_", " ");
  const lines = data.sourcePreview.split("\n");

  const handleInsert = (e: React.MouseEvent) => {
    e.stopPropagation();
    document.dispatchEvent(
      new CustomEvent("vg-stub-insert", { detail: data })
    );
  };

  const handleDiscard = (e: React.MouseEvent) => {
    e.stopPropagation();
    document.dispatchEvent(
      new CustomEvent("vg-stub-discard", { detail: { stubId: data.stubId } })
    );
  };

  return (
    <div
      style={{
        position: "relative",
        minWidth: 220,
        background: "var(--bg-node)",
        border: "1.5px dashed color-mix(in oklab, var(--accent-compose) 55%, transparent)",
        borderRadius: 8,
        padding: "8px 10px 8px 10px",
        fontFamily: "monospace",
        boxShadow: "0 0 12px color-mix(in oklab, var(--accent-compose) 10%, transparent)",
      }}
    >
      <NodeHandles />
      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <span style={{ color: "var(--accent-compose)", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center" }}>
          {icon}
        </span>
        <span
          style={{
            color: "var(--accent-compose)",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            opacity: 0.85,
          }}
        >
          {label}
        </span>
        <span
          style={{
            marginLeft: 4,
            fontSize: 9,
            color: "var(--border-edge)",
            opacity: 0.8,
          }}
        >
          draft
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleDiscard}
          title="Discard"
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            padding: "0 2px",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* source preview */}
      <div
        style={{
          background: "var(--bg-canvas)",
          borderRadius: 4,
          padding: "5px 8px",
          marginBottom: 8,
          fontSize: 11,
          color: "var(--text-primary)",
          lineHeight: 1.5,
          maxHeight: 80,
          overflowY: "auto",
        }}
      >
        {lines.map((line, i) => (
          <div key={i} style={{ whiteSpace: "pre" }}>
            {line || " "}
          </div>
        ))}
      </div>

      {/* error */}
      {data.error && (
        <div
          style={{
            color: "var(--accent-error)",
            fontSize: 10,
            marginBottom: 6,
            fontFamily: "monospace",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <AlertCircle size={16} strokeWidth={1.5} />
          {data.error}
        </div>
      )}

      {/* insert button */}
      <button
        onClick={handleInsert}
        style={{
          width: "100%",
          background: "color-mix(in oklab, var(--accent-compose) 12%, transparent)",
          border: "1px solid color-mix(in oklab, var(--accent-compose) 35%, transparent)",
          borderRadius: 5,
          color: "var(--accent-compose)",
          fontSize: 11,
          fontWeight: 700,
          padding: "4px 0",
          cursor: "pointer",
          fontFamily: "monospace",
          transition: "background 0.1s",
        }}
      >
        ↳ Insert into code
      </button>
    </div>
  );
}
