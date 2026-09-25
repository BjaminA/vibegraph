// How many lines a text paints when wrapped at a given width — the card
// view's height contract (2026-09-25, Ben: "cards should be dynamically
// sized to fit all the code with no scrolling"). The layout used to reserve
// a guessed line count and let a CSS clamp cut the rest; now it wraps the
// text the way `.vg-node-code` does (pre-wrap: source newlines kept, breaks
// between words, a word longer than a line broken anywhere) at the card's
// real width, and reserves exactly that. The clamp stays only as a backstop.

/** Lines `text` occupies at `charsPerLine`: at least 1. */
export function wrapCount(text: string, charsPerLine: number): number {
  const cpl = Math.max(1, Math.floor(charsPerLine));
  let lines = 0;
  for (const src of (text ?? "").split("\n")) {
    let used = 0;
    let rows = 1;
    // Whitespace is kept (pre-wrap), so a run of spaces costs its width.
    for (const word of src.split(/(?<=\s)/)) {
      let len = word.length;
      if (used + len <= cpl) { used += len; continue; }
      if (used > 0) { rows++; used = 0; }
      while (len > cpl) { rows++; len -= cpl; }
      used = len;
    }
    lines += rows;
  }
  return Math.max(1, lines);
}

/** Characters that fit in `px` at a monospace advance of `charPx`. */
export const charsIn = (px: number, charPx: number): number => Math.max(1, Math.floor(px / charPx));
