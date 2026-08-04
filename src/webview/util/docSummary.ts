// The function-card docstring: ONE owner for what it shows and how tall it is.
//
// Found 2026-07-30 in the file view: a long docstring pushed the params band
// down THROUGH the first body statement (`prepare_tensors`' `rows` port sat
// under its `if not rows` container). Three causes, one shape:
//
//   1. buildLayout reserved a CONSTANT header height (function_def: 76) while
//      the painted band ran 43px (no docstring) to 112px (7 wrapped lines).
//   2. That constant was consumed in TWO places — calcHeight and emitNode —
//      so even fixing one would leave them disagreeing.
//   3. FunctionDefNode passed `display: "block"` inline, which overrode
//      `.vg-node-code`'s `display: -webkit-box` and so silently disabled the
//      3-line clamp meant to bound the growth in the first place.
//
// So the height has to be DERIVED from the same text the renderer paints, and
// bounded. Both sides import from here; neither may guess.
//
// What's shown is the SUMMARY — PEP 257's first paragraph. That's the line
// Python authors write to be read alone; the detail paragraphs are reference
// material that belongs on hover (the card keeps the full docstring in its
// title attribute) and in the editor. Cutting there is a legibility choice,
// not silent truncation: it's marked by the clamp and reachable on hover.

/** Wrap width in characters. Also the cap on the docstring's contribution to
 *  card WIDTH (buildLayout.contentLen), which is what makes the line-count
 *  prediction safe: the card is sized at ~7px/char (a mono advance) while the
 *  docstring paints at ~5.6px/char (11px italic Inter), so the real text
 *  always fits in at most the predicted number of lines — never more. */
export const DOC_WRAP_CHARS = 72;

/** Rendered line ceiling. The clamp enforces it, so header height stays
 *  bounded even if the prediction below is pessimistic. */
export const DOC_MAX_LINES = 2;

/** Height reserved per rendered docstring line (11px × 1.25, rounded up). */
export const DOC_LINE_H = 14;

/** PEP 257 summary: the first paragraph, whitespace collapsed to one line. */
export function docSummary(docstring: string | null | undefined): string {
  if (!docstring) return "";
  const firstPara = docstring.trim().split(/\n\s*\n/)[0] ?? "";
  return firstPara.replace(/\s+/g, " ").trim();
}

/** Rendered lines the summary will occupy: 0, or 1..DOC_MAX_LINES. */
export function docLineCount(docstring: string | null | undefined): number {
  const summary = docSummary(docstring);
  if (!summary) return 0;
  return Math.min(DOC_MAX_LINES, Math.ceil(summary.length / DOC_WRAP_CHARS));
}
