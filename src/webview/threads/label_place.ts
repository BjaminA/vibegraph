// Thread-view edge labels placed where they cover no card and no other label.
//
// The overlap audit (scripts/review_overlaps.mjs) and Ben's screenshots of
// a private production codebase showed call-argument chips like "(status: 401 | 403, reason:…)"
// sitting on cards and on each other: a label was put at a fixed point of
// its curve (M-FS3 staggered siblings along t, and nothing else). Now each
// label tries points along its own curve and takes the first whose chip
// clears every card (including the nest badge that rides 10px above a card)
// and every label already placed; a label with no free point is not drawn.
//
// Geometry is the layout's, approximated at the handles: a card is at most
// CARD_W wide; the L-R source handle sits on its right edge at HANDLE_Y, the
// target handle on the left. Obstacles and placed chips sit in a spatial
// grid so a 4,000-node thread stays linear.

export const CARD_W = 272;
// 130, not the 110 a one-line card needs: since the call tree (2026-09-24)
// stacks siblings directly above and below each other, a taller preview
// card (up to ~125) was grazed by a far-call chip placed beside its neighbour.
export const CARD_H = 130;
const BADGE_ABOVE = 14;
const HANDLE_Y = 34;
const CELL = 320;
const CANDIDATES = [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85];

interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface LabelInput { id: string; source: string; target: string; text: string; t0?: number }
export interface LabelPlaced { t: number | null }

class Grid {
  private cells = new Map<string, Rect[]>();
  private keys(r: Rect): string[] {
    const out: string[] = [];
    for (let i = Math.floor(r.x0 / CELL); i <= Math.floor(r.x1 / CELL); i++)
      for (let j = Math.floor(r.y0 / CELL); j <= Math.floor(r.y1 / CELL); j++) out.push(`${i},${j}`);
    return out;
  }
  add(r: Rect) { for (const k of this.keys(r)) this.cells.set(k, [...(this.cells.get(k) ?? []), r]); }
  hits(r: Rect, pad = 2): boolean {
    for (const k of this.keys(r)) for (const o of this.cells.get(k) ?? [])
      if (r.x0 < o.x1 + pad && o.x0 < r.x1 + pad && r.y0 < o.y1 + pad && o.y0 < r.y1 + pad) return true;
    return false;
  }
}

/** The label's chip: 11px mono, ~6.6px a character, 8px padding a side, 22px tall. */
export const chipSize = (text: string) => ({ w: text.length * 6.6 + 16, h: 22 });

/** A point on the cubic bezier react-flow's getBezierPath draws (curvature c). */
function bezierAt(t: number, sx: number, sy: number, tx: number, ty: number, horizontal: boolean, c = 0.4): [number, number] {
  const off = (d: number) => (d >= 0 ? 0.5 * d : c * 25 * Math.sqrt(-d));
  const [c1x, c1y] = horizontal ? [sx + off(tx - sx), sy] : [sx, sy + off(ty - sy)];
  const [c2x, c2y] = horizontal ? [tx - off(tx - sx), ty] : [tx, ty - off(ty - sy)];
  const u = 1 - t;
  return [
    u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * tx,
    u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ty,
  ];
}

/** A long edge's stub chip (ThreadEdge): anchored at a card's handle, it may
 *  sit anywhere along its stub; `at` is the chosen distance and sideways
 *  offset, or null when no spot is clear (the chip is then not drawn). */
export interface ChipInput { key: string; node: string; end: "out" | "in"; text: string }
/** `x`/`y`: the ABSOLUTE centre that was checked clear. The chip is drawn
 *  there, not re-derived from the rendered handle: cards are narrower than
 *  CARD_W, and a chip re-derived from a 156px seed's real handle landed 116px
 *  left of the checked spot, on the card beside it (2026-09-24, call tree). */
export interface ChipPlaced { dist: number; off: number; x: number; y: number }
const CHIP_DIST = [232, 150, 300, 90, 360];
const CHIP_OFF = [0, -30, 30, -60, 60];

export function placeThreadLabels(
  labels: LabelInput[], positions: Map<string, { x: number; y: number }>, horizontal: boolean,
  chips: ChipInput[] = [], chipOut?: Map<string, ChipPlaced | null>,
): Map<string, LabelPlaced> {
  const cards = new Grid();
  for (const p of positions.values()) cards.add({ x0: p.x, y0: p.y - BADGE_ABOVE, x1: p.x + CARD_W, y1: p.y + CARD_H });
  const placed = new Grid();
  const out = new Map<string, LabelPlaced>();
  for (const l of labels) {
    const a = positions.get(l.source), b = positions.get(l.target);
    if (!a || !b) { out.set(l.id, { t: l.t0 ?? 0.5 }); continue; }
    const [sx, sy] = horizontal ? [a.x + CARD_W, a.y + HANDLE_Y] : [a.x + CARD_W / 2, a.y + CARD_H];
    const [tx, ty] = horizontal ? [b.x, b.y + HANDLE_Y] : [b.x + CARD_W / 2, b.y];
    const { w, h } = chipSize(l.text);
    let chosen: number | null = null;
    for (const t of [...new Set([l.t0 ?? 0.5, ...CANDIDATES])]) {
      const [cx, cy] = bezierAt(t, sx, sy, tx, ty, horizontal);
      const r = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
      if (cards.hits(r) || placed.hits(r)) continue;
      placed.add(r);
      chosen = t;
      break;
    }
    out.set(l.id, { t: chosen });
  }
  for (const c of chips) {
    const p = positions.get(c.node);
    if (!p) { chipOut?.set(c.key, null); continue; }
    // the handle and the stub's direction (out: away from the card; in: into it)
    const [hx, hy] = c.end === "out"
      ? (horizontal ? [p.x + CARD_W, p.y + HANDLE_Y] : [p.x + CARD_W / 2, p.y + CARD_H])
      : (horizontal ? [p.x, p.y + HANDLE_Y] : [p.x + CARD_W / 2, p.y]);
    const sgn = c.end === "out" ? 1 : -1;
    const [dx, dy] = horizontal ? [sgn, 0] : [0, sgn];
    const { w, h } = chipSize(c.text);
    let got: ChipPlaced | null = null;
    for (const dist of CHIP_DIST) {
      for (const off of CHIP_OFF) {
        const cx = hx + dx * dist + (horizontal ? 0 : off), cy = hy + dy * dist + (horizontal ? off : 0);
        const r = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
        if (cards.hits(r) || placed.hits(r)) continue;
        placed.add(r);
        got = { dist, off, x: cx, y: cy };
        break;
      }
      if (got) break;
    }
    chipOut?.set(c.key, got);
  }
  return out;
}
