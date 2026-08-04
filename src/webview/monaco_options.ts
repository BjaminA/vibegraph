// Shared Monaco wrapping policy — one source of truth so code is NEVER cut off
// at a panel edge. Long lines wrap to the next line instead of disappearing
// behind a horizontal scrollbar. Spread LAST into each editor's `options` so it
// wins over any local default. (Rule: "all code, when shown, never appears
// off-screen.")
//
// Monaco wrapping is an editor option, not a CSS property, so it can't live in
// tokens.css — this constant is the editor-side equivalent. For plain HTML code
// blocks (stderr/traceback <pre>, inline value lines) use the `.vg-code-wrap`
// class in tokens.css, which is the CSS half of the same rule.
export const CODE_WRAP_OPTIONS = {
  wordWrap: "on",
  // Continuation lines align with the wrapped line's start — keeps the block
  // shape legible rather than re-flowing to column 0.
  wrappingIndent: "same",
} as const;
