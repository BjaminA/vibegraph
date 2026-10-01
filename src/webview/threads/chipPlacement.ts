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
export function chipLabel(label: string, alsoIn = 0): string {
  const space = label.indexOf(" ");
  const base = space === -1 ? label.toUpperCase() : `${label.slice(0, space).toUpperCase()}  ${label.slice(space + 1)}`;
  return base + (alsoIn ? ` · +${alsoIn} more block${alsoIn === 1 ? "" : "s"}` : "");
}

// The chip CSS (ThreadContainerNode): left 12, top -10, 11px Inter 600 with
// 0.08em tracking (~7.5px a character), 8px side padding, 1px border, ~21px tall.
export const CHIP_LEFT = 12;
const CHIP_TOP = -10;
const CHIP_H = 21;
const GAP = 6;
export const chipWidth = (text: string) => Math.ceil(text.length * 7.5) + 18;

export interface ChipBox { id: string; x: number; y: number; text: string }

/** id → the chip's left offset inside its container (CHIP_LEFT when free). */
export function placeChips(boxes: readonly ChipBox[]): Map<string, number> {
  const out = new Map<string, number>();
  const placed: Array<{ l: number; t: number; r: number; b: number }> = [];
  const order = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const c of order) {
    const w = chipWidth(c.text);
    const t = c.y + CHIP_TOP;
    let l = c.x + CHIP_LEFT;
    for (let moved = true; moved;) {
      moved = false;
      for (const p of placed) {
        if (l < p.r && l + w > p.l && t < p.b && t + CHIP_H > p.t) { l = p.r + GAP; moved = true; }
      }
    }
    placed.push({ l, t, r: l + w, b: t + CHIP_H });
    out.set(c.id, l - c.x);
  }
  return out;
}
