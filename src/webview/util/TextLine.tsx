import React from "react";

// W1 — node-card code/expression text WRAPS, never silently truncates.
//
// Previously this hard-cut `text` at a `maxChars` token boundary and relied
// on CSS ellipsis — so args (the information) were lost off the right edge.
// Now it renders the FULL text and lets `.vg-node-code` wrap it (up to 3
// lines, then clamp), with the full string pinned on `title` for hover
// reveal. So a cut is always reachable + visibly marked, never silent.
//
// `maxChars` is retained for call-site API compatibility but no longer
// hard-cuts the string — the wrap + clamp + title replace the boundary cut.

interface Props {
  text: string;
  maxChars?: number; // deprecated (W1): no longer truncates; kept for compat
  style?: React.CSSProperties;
  className?: string;
  // Override the shared 3-line clamp for genuinely multi-line source text
  // (an RHS with embedded newlines): the layout sizes the node to the full
  // line count, so the clamp must not cut what the box already fits.
  clampLines?: number;
  // Hover reveal for callers that paint a DERIVED string (e.g. a docstring's
  // summary line): the full text must still be reachable. Defaults to `text`.
  title?: string;
}

export function TextLine({ text, style, className, clampLines, title }: Props) {
  const full = text ?? "";
  return (
    <span
      className={["vg-node-code", className].filter(Boolean).join(" ")}
      title={title ?? full}
      style={{
        ...(clampLines !== undefined ? { WebkitLineClamp: clampLines } : {}),
        ...style,
      }}
    >
      {full}
    </span>
  );
}
