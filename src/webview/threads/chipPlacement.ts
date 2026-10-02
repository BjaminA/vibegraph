// Container chips must never sit on each other (2026-10-01, from a TS test
// thread: `FOR e of bundle.entities`, `TRY` and `FOR … of bundle.labels`
// drawn on one spot). Every chip straddles its own container's top-left
// border, and NESTED containers already step down (NEST_MARGIN_TOP in
// ThreadView). SIBLING containers can still start at nearly the same
// corner: one called function is ONE card however many blocks call it, so
// two different loops around it compute almost the same box — not the same
// box, which the identical-box fold already handles. So, in reading order,
// a chip that would land on an earlier one moves right of it. Pure.

/** The text a chip shows. "except ValueError" → "EXCEPT  ValueError": the
 *  keyword head uppercased so the chip scans as a tag, the body kept. */
export function chipLabel(label: string, alsoIn = 0, boxWidth = MIN_BOX_W): string {
  const space = label.indexOf(" ");
  const base = space === -1 ? label.toUpperCase() : `${label.slice(0, space).toUpperCase()}  ${label.slice(space + 1)}`;
  const full = base + (alsoIn ? ` · +${alsoIn} more block${alsoIn === 1 ? "" : "s"}` : "");
  // 2026-10-02 — a chip is never wider than its own container (nor than
  // CHIP_MAX_W) and wraps onto at most CHIP_MAX_LINES lines: a `for (… of
  // [ …a long literal… ])` header ran off its container to the right. What
  // does not fit ends in "…"; the whole label is the chip's title, and
  // hovering it opens the tooltip. The CSS line-clamp is the hard stop.
  const max = charsPerLine(boxWidth) * CHIP_MAX_LINES;
  return full.length > max ? `${full.slice(0, max - 1).trimEnd()}…` : full;
}

/** The chip's width cap and line cap; the layout leaves room for a wrapped chip. */
export const CHIP_MAX_W = 360;
export const CHIP_MAX_LINES = 2;
export const CHIP_LINE_H = 15;
/** The narrowest container box: one card (200) and its side padding (2 × 16). */
export const MIN_BOX_W = 232;
/** The widest a chip may be inside a box this wide. */
export const chipMaxWidth = (boxWidth = MIN_BOX_W) => Math.max(80, Math.min(CHIP_MAX_W, boxWidth - CHIP_LEFT - 12));
// 8px a character: a little over the measured 7.5, because a word that does
// not fit moves whole to the next line.
const charsPerLine = (boxWidth = MIN_BOX_W) => Math.max(8, Math.floor((chipMaxWidth(boxWidth) - 18) / 8));
/** How many lines a chip's (already capped) text wraps onto in a box this wide. */
export const chipLines = (text: string, boxWidth = MIN_BOX_W) => Math.min(CHIP_MAX_LINES, Math.max(1, Math.ceil(text.length / charsPerLine(boxWidth))));

// The chip CSS (ThreadContainerNode): left 12, top -10, 11px Inter 600 with
// 0.08em tracking (~7.5px a character), 8px side padding, 1px border, ~21px tall.
export const CHIP_LEFT = 12;
const CHIP_TOP = -10;
const CHIP_H = 21;
const GAP = 6;
export const chipWidth = (text: string, boxWidth = MIN_BOX_W) => Math.min(chipMaxWidth(boxWidth), Math.ceil(text.length * 7.5) + 18);
export const chipHeight = (text: string, boxWidth = MIN_BOX_W) => CHIP_H + (chipLines(text, boxWidth) - 1) * CHIP_LINE_H;

export interface ChipBox { id: string; x: number; y: number; text: string; boxWidth?: number }

/** id → the chip's left offset inside its container (CHIP_LEFT when free). */
export function placeChips(boxes: readonly ChipBox[]): Map<string, number> {
  const out = new Map<string, number>();
  const placed: Array<{ l: number; t: number; r: number; b: number }> = [];
  const order = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const c of order) {
    const w = chipWidth(c.text, c.boxWidth);
    const h = chipHeight(c.text, c.boxWidth);
    const t = c.y + CHIP_TOP;
    let l = c.x + CHIP_LEFT;
    for (let moved = true; moved;) {
      moved = false;
      for (const p of placed) {
        if (l < p.r && l + w > p.l && t < p.b && t + h > p.t) { l = p.r + GAP; moved = true; }
      }
    }
    placed.push({ l, t, r: l + w, b: t + h });
    out.set(c.id, l - c.x);
  }
  return out;
}
