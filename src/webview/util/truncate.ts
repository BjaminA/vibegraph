// Truncate-at-token-boundary — replaces the CSS-ellipsis mid-word cut that
// produced "f\"{self.name} wi…" in the baseline. We cut at the rightmost
// boundary character within a back-off window, falling through to the raw
// limit only when no boundary exists nearby (so "averylongidentifier"
// doesn't get chopped to almost nothing).
//
// Boundary chars are the natural word/operator separators for Python source:
// whitespace, punctuation, brackets, operators, quotes. Underscores and
// alphanumerics are NOT boundaries — `format_name` reads as one token.

const BOUNDARY_RE = /[\s.,;:!?()[\]{}<>=+\-*/&|^"`'\\@#$%]/;

// 60% back-off: never cut more than 40% off the right of the budget.
// Prevents "calculate_a…" → "calculate" (wastes most of the visible space).
const MIN_KEEP_RATIO = 0.6;

export interface TruncResult {
  display: string;
  truncated: boolean;
}

export function truncateAtBoundary(text: string, maxChars: number): TruncResult {
  if (text.length <= maxChars) return { display: text, truncated: false };
  const budget = maxChars - 1; // reserve one char for the ellipsis
  const floor = Math.floor(budget * MIN_KEEP_RATIO);
  let cut = budget;
  // Walk left looking for the rightmost boundary within the keep window.
  while (cut > floor && !BOUNDARY_RE.test(text.charAt(cut))) cut--;
  // No boundary found — accept the raw cut.
  if (cut === floor && !BOUNDARY_RE.test(text.charAt(cut))) cut = budget;
  return { display: text.slice(0, cut).trimEnd() + "…", truncated: true };
}
