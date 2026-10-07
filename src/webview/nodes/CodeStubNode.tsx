// A call into ANOTHER file, in the file view's code mode (code_layout.ts):
// the function's name and the file it lives in, where the call line ends — so
// the story of the code does not stop at the edge of the file. Hover shows
// the full path.

import React from "react";
import { Handle, Position } from "@xyflow/react";
import { ArrowUpRight } from "lucide-react";
import type { CodeStubData } from "../layout/code_layout";

export function CodeStubNode({ data, selected }: { data: CodeStubData; selected?: boolean }) {
  return (
    <div data-code-stub={data.label} title={`${data.label} — in ${data.targetFile}`} style={{
      width: "100%", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center",
      gap: 2, padding: "0 12px", borderRadius: 10,
      background: "color-mix(in oklab, var(--accent-thread) 6%, var(--bg-node))",
      border: `1px dashed color-mix(in oklab, var(--accent-thread) ${selected ? 70 : 40}%, var(--border-edge))`,
    }}>
      <Handle id="in" type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      {/* 2026-10-07 — a data-flow line leaves here: this call's result, taken by a later call */}
      <Handle id="out" type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "var(--fsm-12)", whiteSpace: "nowrap" }}>
        {data.label}<ArrowUpRight size={12} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
      </span>
      {data.returns?.length ? (
        <span data-code-stub-returns title={`its result is bound to ${data.returns.join(", ")}`} style={{
          color: "var(--accent-warning)", fontFamily: "var(--font-mono)", fontSize: "var(--fsm-12)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{`→ ${data.returns.join(", ")}`}</span>
      ) : null}
      <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", whiteSpace: "nowrap" }}>{data.file}</span>
    </div>
  );
}
