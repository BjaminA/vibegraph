// Orthogonal edge routing for the architecture map, one function for every
// surface that draws it: the GUI map (archLayout.ts → ArchEdge), the
// self-contained architecture.html (arch_html.ts) and the Archify adapter
// (arch_archify.ts). Written after reviews/m-arch/COMPARE.md measured our
// own artifact drawing 8 of 13 (next_demo) and 16 of 40 (a private production codebase) edges
// THROUGH unrelated cards, while the adapter, which already routed through
// empty lanes, drew none.
//
// The picture is columns of cards. An edge only ever runs:
//   - horizontally inside its own card's column band, at the card's port;
//   - vertically in a GAP between two column bands (a lane);
//   - horizontally across intermediate columns only at a y no card in those
//     columns occupies (a channel).
// So no segment can cross a card by construction; the test re-checks it.
//   forward  (column a < b): leave A's RIGHT side, enter B's LEFT side;
//   backward (a > b):        leave A's LEFT side,  enter B's RIGHT side;
//   same column:             leave A's RIGHT side, down the lane beside the
//                            column, enter B's RIGHT side.
// Lanes in one gap are spread evenly across it; ports on one side of a card
// are spread along it (optional: Archify anchors at the midpoint when an
// edge carries explicit points, so its adapter turns spreading off).
// Labels are placed by trying positions along the edge's own segments and
// taking the first that overlaps no card and no label already placed; when
// none is free, the longest segment's midpoint is used and reported.
//
// Pure and deterministic: same boxes and edges in, same points out.

/** The narrowest a truncated label may get (about five characters and an ellipsis). */
const MIN_LABEL_W = 56;

export interface RouteBox { id: string; x: number; y: number; w: number; h: number; col: number }
export interface RouteEdgeIn { id: string; from: string; to: string; labelW: number; labelH: number }
export interface RouteRect { x: number; y: number; w: number; h: number }
export interface RouteOut {
  points: [number, number][];
  /** the label's CENTRE, or null when the edge has no label. */
  label: { cx: number; cy: number } | null;
  /** false when no label position was free of cards and other labels. */
  labelClear: boolean;
  /** the width the label got: its full labelW, or less when only a narrower
   *  spot was free (the caller truncates the text to it and keeps the full
   *  text in a title — a hidden main label is worse than a shortened one). */
  labelW?: number;
}
export interface RouteOptions {
  /** spread several ports on one side of a card along that side. */
  spreadPorts: boolean;
  /** the height of the side a port may sit on, from the card's top (the card may be taller). */
  portBand: (b: RouteBox) => { top: number; bottom: number };
  /** width of the lane gap to the right of the LAST column (same-column edges there). */
  gapAfterLast: number;
  /** extra rectangles labels must not cover (group headers). */
  obstacles?: RouteRect[];
}

type Pt = [number, number];
const CARD_PAD = 8;   // a channel keeps this far from a card, vertically
const LANE_MARGIN = 16;

export function routeEdges(boxesIn: RouteBox[], edges: RouteEdgeIn[], opts: RouteOptions): Map<string, RouteOut> {
  const out = new Map<string, RouteOut>();
  const boxes = new Map(boxesIn.map((b) => [b.id, b]));
  const cols = [...new Set(boxesIn.map((b) => b.col))].sort((a, b) => a - b);
  const ord = new Map(cols.map((c, i) => [c, i]));
  const bandOf = cols.map((c) => {
    const inCol = boxesIn.filter((b) => b.col === c);
    return { left: Math.min(...inCol.map((b) => b.x)), right: Math.max(...inCol.map((b) => b.x + b.w)), boxes: inCol };
  });
  /** the gap to the right of column ordinal i. */
  const gap = (i: number) => {
    const left = bandOf[i].right;
    const right = i + 1 < bandOf.length ? bandOf[i + 1].left : left + opts.gapAfterLast;
    return { left, right };
  };
  const live = edges.filter((e) => boxes.has(e.from) && boxes.has(e.to) && e.from !== e.to);

  // 1. sides, then ports.
  type Plan = { e: RouteEdgeIn; a: RouteBox; b: RouteBox; oa: number; ob: number; fromSide: "left" | "right"; toSide: "left" | "right"; sy: number; ey: number };
  const plans: Plan[] = live.map((e) => {
    const a = boxes.get(e.from)!, b = boxes.get(e.to)!;
    const oa = ord.get(a.col)!, ob = ord.get(b.col)!;
    const fromSide = oa > ob ? "left" : "right";
    const toSide = oa < ob ? "left" : "right";
    return { e, a, b, oa, ob, fromSide, toSide, sy: 0, ey: 0 };
  });
  const mid = (b: RouteBox) => { const p = opts.portBand(b); return b.y + (p.top + p.bottom) / 2; };
  const ports = new Map<string, { plan: Plan; end: "s" | "t"; other: number }[]>();
  for (const p of plans) {
    const ks = `${p.a.id}|${p.fromSide}`, kt = `${p.b.id}|${p.toSide}`;
    ports.set(ks, [...(ports.get(ks) ?? []), { plan: p, end: "s", other: mid(p.b) }]);
    ports.set(kt, [...(ports.get(kt) ?? []), { plan: p, end: "t", other: mid(p.a) }]);
  }
  for (const [k, list] of ports) {
    const box = boxes.get(k.split("|")[0])!;
    const band = opts.portBand(box);
    list.sort((x, y) => x.other - y.other || x.plan.e.id.localeCompare(y.plan.e.id));
    const range = band.bottom - band.top - 16;
    const step = opts.spreadPorts && list.length > 1 ? Math.min(12, range / (list.length - 1)) : 0;
    list.forEach((it, i) => {
      const y = mid(box) + (i - (list.length - 1) / 2) * step;
      if (it.end === "s") it.plan.sy = y; else it.plan.ey = y;
    });
  }

  // 2. which columns each edge must cross, and at what channel y.
  const occupied = (i: number) => bandOf[i].boxes.map((b) => [b.y - CARD_PAD, b.y + b.h + CARD_PAD] as [number, number]);
  const isFree = (y: number, lo: number, hi: number) => {
    for (let i = lo; i <= hi; i++) for (const [t, bt] of occupied(i)) if (y > t && y < bt) return false;
    return true;
  };
  const channelUse = new Map<string, number>();
  const channelY = (lo: number, hi: number, want: number): number => {
    const iv: [number, number][] = [];
    for (let i = lo; i <= hi; i++) iv.push(...occupied(i));
    iv.sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const r of iv) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
    const free: [number, number][] = [];
    let cur = -Infinity;
    for (const [t, b] of merged) { if (t > cur) free.push([cur, t]); cur = Math.max(cur, b); }
    free.push([cur, Infinity]);
    let best = free[0], bestD = Infinity;
    for (const f of free) {
      const c = Math.min(Math.max(want, f[0]), f[1]);
      const d = Math.abs(c - want);
      if (d < bestD) { bestD = d; best = f; }
    }
    const key = `${lo}:${hi}:${best[0]}`;
    const n = channelUse.get(key) ?? 0;
    channelUse.set(key, n + 1);
    const lo2 = isFinite(best[0]) ? best[0] : best[1] - 48;
    const hi2 = isFinite(best[1]) ? best[1] : lo2 + 48;
    const span = hi2 - lo2;
    // several edges in one channel run side by side, 10px apart, inside it
    const y = lo2 + Math.min(span / 2, 12) + (n * 10) % Math.max(10, span - 24);
    return Math.min(y, hi2 - 6);
  };

  // 3. shapes: a list of lane requests (gap ordinal) and the channel y.
  type Shape = { plan: Plan; lanes: { gap: number; y0: number; y1: number }[]; build: (lx: number[]) => Pt[] };
  const shapes: Shape[] = plans.map((p) => {
    const { a, b, oa, ob, sy, ey } = p;
    const S: Pt = [p.fromSide === "right" ? a.x + a.w : a.x, sy];
    const T: Pt = [p.toSide === "left" ? b.x : b.x + b.w, ey];
    if (oa === ob) {
      return { plan: p, lanes: [{ gap: oa, y0: sy, y1: ey }], build: ([lx]) => [S, [lx, sy], [lx, ey], T] };
    }
    const fwd = oa < ob;
    const g0 = fwd ? oa : oa - 1;       // lane gap next to A
    const g1 = fwd ? ob - 1 : ob;       // lane gap next to B
    const lo = Math.min(oa, ob) + 1, hi = Math.max(oa, ob) - 1;
    if (g0 === g1) {
      if (Math.abs(sy - ey) < 1) return { plan: p, lanes: [], build: () => [S, [T[0], sy]] };
      return { plan: p, lanes: [{ gap: g0, y0: sy, y1: ey }], build: ([lx]) => [S, [lx, sy], [lx, ey], T] };
    }
    if (isFree(sy, lo, hi)) return { plan: p, lanes: [{ gap: g1, y0: sy, y1: ey }], build: ([lx]) => [S, [lx, sy], [lx, ey], T] };
    if (isFree(ey, lo, hi)) return { plan: p, lanes: [{ gap: g0, y0: sy, y1: ey }], build: ([lx]) => [S, [lx, sy], [lx, ey], T] };
    const hy = channelY(lo, hi, (sy + ey) / 2);
    return {
      plan: p,
      lanes: [{ gap: g0, y0: sy, y1: hy }, { gap: g1, y0: hy, y1: ey }],
      build: ([l0, l1]) => [S, [l0, sy], [l0, hy], [l1, hy], [l1, ey], T],
    };
  });

  // 4. lanes: spread evenly across each gap, ordered by where they run.
  const perGap = new Map<number, { shape: Shape; idx: number; y: number }[]>();
  for (const s of shapes) s.lanes.forEach((l, idx) => perGap.set(l.gap, [...(perGap.get(l.gap) ?? []), { shape: s, idx, y: Math.min(l.y0, l.y1) }]));
  const laneX = new Map<Shape, number[]>();
  for (const [g, list] of perGap) {
    const { left, right } = gap(g);
    list.sort((x, y) => x.y - y.y || x.shape.plan.e.id.localeCompare(y.shape.plan.e.id));
    const width = right - left - 2 * LANE_MARGIN;
    const step = list.length > 1 ? Math.min(14, width / (list.length - 1)) : 0;
    const centre = (left + right) / 2;
    list.forEach((it, i) => {
      const xs = laneX.get(it.shape) ?? [];
      xs[it.idx] = centre + (i - (list.length - 1) / 2) * step;
      laneX.set(it.shape, xs);
    });
  }

  // 5. points, simplified (no zero-length or collinear middle points).
  const routed: { e: RouteEdgeIn; pts: Pt[] }[] = shapes.map((s) => ({ e: s.plan.e, pts: simplify(s.build(laneX.get(s) ?? [])) }));

  // 6. labels: first free spot along the edge's own segments.
  const cards: RouteRect[] = [...boxesIn.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })), ...(opts.obstacles ?? [])];
  const placed: RouteRect[] = [];
  const hits = (r: RouteRect, list: RouteRect[], pad: number) =>
    list.some((o) => r.x < o.x + o.w + pad && o.x < r.x + r.w + pad && r.y < o.y + o.h + pad && o.y < r.y + r.h + pad);
  // Every routed segment, by edge: a label that covers ANOTHER edge's line
  // cannot say which line it names (2026-09-25: most labels on most maps did,
  // e.g. an "SSH" label sitting on the HTTP line into `fetch`).
  const lines = routed.flatMap(({ e, pts }) => pts.slice(0, -1).map((p, i) => ({ id: e.id, a: p, b: pts[i + 1] })));
  const onOtherLine = (r: RouteRect, id: string) => lines.some((s) => s.id !== id
    && Math.max(Math.min(s.a[0], s.b[0]), r.x + 1) <= Math.min(Math.max(s.a[0], s.b[0]), r.x + r.w - 1)
    && Math.max(Math.min(s.a[1], s.b[1]), r.y + 1) <= Math.min(Math.max(s.a[1], s.b[1]), r.y + r.h - 1));
  // Preference, most legible first: along a HORIZONTAL run of its own line
  // (the label reads along the line it names) clear of every other line; then
  // any of its segments clear of other lines; then the old rule (clear of
  // cards and labels only). Each pass tries full width before truncating —
  // a shortened label that is unambiguous beats a full one that is not (the
  // full text stays in the edge's title and the inspector).
  // A last, finer pass (every 5% of every segment) recovers labels the
  // clearer passes crowded out: a hidden label is the other failure.
  const T_STEPS = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];
  const T_FINE = Array.from({ length: 19 }, (_, i) => (i + 1) / 20);
  const PASSES = [
    { horizontal: true, avoidLines: true, ts: T_STEPS },
    { horizontal: false, avoidLines: true, ts: T_STEPS },
    { horizontal: true, avoidLines: false, ts: T_STEPS },
    { horizontal: false, avoidLines: false, ts: T_STEPS },
    { horizontal: false, avoidLines: false, ts: T_FINE },
  ];
  for (const { e, pts } of routed) {
    if (!e.labelW) { out.set(e.id, { points: pts, label: null, labelClear: true }); continue; }
    const segs = pts.slice(0, -1).map((p, i) => ({ a: p, b: pts[i + 1], len: Math.abs(pts[i + 1][0] - p[0]) + Math.abs(pts[i + 1][1] - p[1]) }))
      .map((s, i) => ({ ...s, i }))
      .sort((x, y) => y.len - x.len || x.i - y.i);
    let chosen: { cx: number; cy: number } | null = null;
    const widths = [...new Set([e.labelW, ...[0.75, 0.55, 0.4].map((f) => Math.max(MIN_LABEL_W, Math.round(e.labelW * f)))])]
      .filter((w) => w <= e.labelW);
    let w = e.labelW;
    passes: for (const pass of PASSES) {
      for (const tryW of widths) {
        for (const s of segs) {
          if (pass.horizontal && Math.abs(s.a[1] - s.b[1]) > 0.5) continue;
          for (const t of pass.ts) {
            const cx = s.a[0] + (s.b[0] - s.a[0]) * t, cy = s.a[1] + (s.b[1] - s.a[1]) * t;
            const r = { x: cx - tryW / 2, y: cy - e.labelH / 2, w: tryW, h: e.labelH };
            if (hits(r, cards, 2) || hits(r, placed, 2)) continue;
            if (pass.avoidLines && onOtherLine(r, e.id)) continue;
            chosen = { cx, cy };
            w = tryW;
            break passes;
          }
        }
      }
    }
    const clear = !!chosen;
    if (!chosen) { const s = segs[0]; chosen = { cx: (s.a[0] + s.b[0]) / 2, cy: (s.a[1] + s.b[1]) / 2 }; }
    if (clear) placed.push({ x: chosen.cx - w / 2, y: chosen.cy - e.labelH / 2, w, h: e.labelH });
    out.set(e.id, { points: pts, label: chosen, labelClear: clear, labelW: w });
  }
  return out;
}

function simplify(pts: Pt[]): Pt[] {
  const r: Pt[] = [];
  for (const p of pts) {
    const last = r[r.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 0.5 && Math.abs(last[1] - p[1]) < 0.5) continue;
    r.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  }
  for (let i = 1; i < r.length - 1; ) {
    const [a, b, c] = [r[i - 1], r[i], r[i + 1]];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) r.splice(i, 1); else i++;
  }
  return r;
}

/** An SVG path through the points with small rounded corners. */
export function roundedPath(pts: [number, number][], radius = 8): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
    const r = Math.min(radius, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const ax = x - Math.sign(x - px) * r, ay = y - Math.sign(y - py) * r;
    const bx = x + Math.sign(nx - x) * r, by = y + Math.sign(ny - y) * r;
    d += ` L${ax},${ay} Q${x},${y} ${bx},${by}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L${lx},${ly}`;
}
