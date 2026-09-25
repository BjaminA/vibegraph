// One block of the file view's CODE mode (code_layout.ts): a top-level
// statement's source as written, highlighted exactly as the editor shows it —
// Monaco's own colorizer under the vibegraph-dark theme, so there is one
// highlighting, not a second approximation of it. The outline and label row
// match the card view's boxes; the body is the code, line-numbered.

import React, { useEffect, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { loader } from "@monaco-editor/react";
import { defineVibegraphDark, VIBEGRAPH_DARK } from "../themes/vibegraph-dark";
import { CODE_LINE_H, CODE_HEAD_H, CODE_PAD_Y, CODE_GUTTER_L, CODE_GUTTER_R, CODE_PAD_R, type CodeBlockData } from "../layout/code_layout";

const cache = new Map<string, string>();
let themed: Promise<unknown> | null = null;

async function colorize(code: string, language: string): Promise<string> {
  const key = `${language}\u0000${code}`;
  if (cache.has(key)) return cache.get(key)!;
  const monaco = await loader.init();
  themed ??= Promise.resolve().then(() => { defineVibegraphDark(monaco as never); monaco.editor.setTheme(VIBEGRAPH_DARK); });
  await themed;
  const html = await monaco.editor.colorize(code, language, { tabSize: 4 });
  cache.set(key, html);
  return html;
}

const ACCENT: Record<string, string> = {
  imports: "var(--accent-io-muted)",
  assignment: "var(--accent-warning)",
  class_def: "var(--accent-thread)",
  function_def: "var(--accent-thread)",
};

export function CodeBlockNode({ data, selected }: { data: CodeBlockData; selected?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    colorize(data.code, data.language).then((h) => { if (live) setHtml(h); }).catch(() => { if (live) setHtml(null); });
    return () => { live = false; };
  }, [data.code, data.language]);
  const accent = ACCENT[data.kind] ?? "var(--text-muted)";
  const lineCount = data.code.split("\n").length;
  return (
    <div data-code-block={data.kind} style={{
      width: "100%", height: "100%", boxSizing: "border-box",
      background: "var(--bg-node)",
      border: `1px solid color-mix(in oklab, ${accent} ${selected ? 75 : 35}%, var(--border-edge))`,
      borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column",
    }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
      <div style={{
        height: CODE_HEAD_H, boxSizing: "border-box", flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "0 12px",
        borderBottom: "1px solid var(--border-edge)", color: accent,
        fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", fontWeight: 600,
      }}>
        <span style={{ color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.label}</span>
        <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", fontWeight: 400 }}>
          {`L${data.firstLine}`}
        </span>
      </div>
      {/* Sized by code_layout to hold every line whole: nothing scrolls. */}
      <div style={{ display: "flex", padding: `${CODE_PAD_Y}px 0`, overflow: "hidden", flex: 1 }}>
        <div aria-hidden style={{
          flexShrink: 0, padding: `0 ${CODE_GUTTER_R}px 0 ${CODE_GUTTER_L}px`, textAlign: "right", userSelect: "none",
          color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--fsm-12)", lineHeight: `${CODE_LINE_H}px`,
        }}>
          {Array.from({ length: lineCount }, (_, i) => <div key={i}>{data.firstLine + i}</div>)}
        </div>
        {html
          ? <div data-code-block-body className="vg-code-block-body" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fsm-12)", lineHeight: `${CODE_LINE_H}px`, whiteSpace: "pre", paddingRight: CODE_PAD_R }}
              dangerouslySetInnerHTML={{ __html: html }} />
          : <pre data-code-block-body style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: "var(--fsm-12)", lineHeight: `${CODE_LINE_H}px`, color: "var(--text-secondary)", whiteSpace: "pre", paddingRight: CODE_PAD_R }}>{data.code}</pre>}
      </div>
    </div>
  );
}
