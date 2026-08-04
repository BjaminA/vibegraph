// M-CHAT-POLISH.3 — the component half of the minimal markdown pipeline
// (parser in markdown_parse.ts — named to dodge the case-insensitive
// collision with this file — pure + node:test-pinned). Tokens only; the
// inline-code chip is .vg-inline-code (tokens.css). Consumers: chat
// assistant segments, the thread-skill card body.
import React, { useMemo } from "react";
import { parseMarkdown, type Block, type Inline } from "./markdown_parse";

function InlineRun({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.kind === "code") return <code key={i} className="vg-inline-code">{n.text}</code>;
        if (n.kind === "bold") return <strong key={i}><InlineRun nodes={n.children} /></strong>;
        if (n.kind === "italic") return <em key={i}><InlineRun nodes={n.children} /></em>;
        return <React.Fragment key={i}>{n.text}</React.Fragment>;
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === "heading") {
    return (
      <div
        style={{
          fontSize: block.level === 2 ? "var(--fs-13)" : "var(--fs-12)",
          fontWeight: 700,
          color: "var(--text-primary)",
          margin: "8px 0 4px",
        }}
      >
        <InlineRun nodes={block.children} />
      </div>
    );
  }
  if (block.kind === "bullets") {
    return (
      <ul style={{ margin: "4px 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 2 }}>
        {block.items.map((item, i) => (
          <li key={i}><InlineRun nodes={item} /></li>
        ))}
      </ul>
    );
  }
  if (block.kind === "codeblock") {
    return (
      <pre
        className="vg-code-wrap"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          border: "1px solid var(--border-edge)",
          borderRadius: 6,
          padding: 8,
          margin: "4px 0",
          background: "color-mix(in oklab, var(--bg-canvas) 60%, transparent)",
        }}
      >
        {block.text}
      </pre>
    );
  }
  return (
    <div style={{ whiteSpace: "pre-wrap", margin: "2px 0" }}>
      <InlineRun nodes={block.children} />
    </div>
  );
}

/** Render markdown text. Streaming-safe: partial constructs (unclosed
 * fence, dangling **) render stably — see markdown_parse.ts. */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </>
  );
}
