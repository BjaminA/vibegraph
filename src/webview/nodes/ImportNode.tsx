import React from "react";
import { PackageIcon } from "./icons";
import { NodeActionStrip } from "./NodeActionStrip";
import { NodeHandles } from "./NodeHandles";

interface Props {
  data: { id: string; names: string[]; module?: string; isFrom?: boolean };
}

const ACCENT = "var(--accent-thread)";

export function ImportNode({ data }: Props) {
  const label = data.isFrom ? `from ${data.module}` : "import";
  const names = (data.names ?? []).join(", ");

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <NodeHandles />
      <div style={{
        width: "100%", height: "100%",
        background: "linear-gradient(135deg, color-mix(in oklab, var(--accent-thread) 8%, var(--bg-node)) 0%, var(--bg-node) 100%)",
        border: `1.5px solid ${ACCENT}`,
        clipPath: "polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%)",
        display: "flex", alignItems: "center",
        padding: "0 var(--node-action-reserve) 0 var(--node-pad-x)",
        gap: "var(--node-inline-gap)",
        boxSizing: "border-box",
        boxShadow: `0 0 12px color-mix(in oklab, var(--accent-thread) 15%, transparent)`,
      }}>
        <PackageIcon color={ACCENT} />
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div style={{ color: ACCENT, fontSize: 8.5, fontWeight: 700, fontFamily: "monospace", opacity: 0.8, letterSpacing: "0.07em" }}>
            {label.toUpperCase()}
          </div>
          <div style={{ color: "var(--text-primary)", fontSize: 11, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {names}
          </div>
        </div>
      </div>
      <NodeActionStrip nodeId={data.id} accentColor={ACCENT} />
    </div>
  );
}

export function ImportFromNode({ data }: Props) {
  return <ImportNode data={{ ...data, isFrom: true }} />;
}
