#!/usr/bin/env node
// How legible is the architecture map's layout? Measured, not eyeballed.
//
//   node --experimental-strip-types scripts/arch_layout_metrics.mjs <env.json | fixture-dir> [lens]
//
// For one model and lens, from the SAME layout function the GUI and the HTML
// artifact use (archLayout.ts):
//   size         the drawing's width × height in map units
//   aspect       width / height (a laptop's usable canvas is ~1.65)
//   fitZoom      the zoom that fits it all in a 1160×700 canvas (1440×900
//                minus the side panel and chrome); cards read at 13px × zoom
//   edgeLength   total routed edge length (shorter = related things closer)
//   crossings    pairs of routed edge segments that cross
//   groupOverlap group boxes that overlap without one containing the other
//   orphans      nodes whose model parent group is drawn but whose card
//                sits outside that group's box
import { readFileSync, existsSync } from "node:fs";
import { buildArchLayout, cardHeight } from "../src/webview/system/archLayout.ts";

export function measure(model, lens) {
  const l = buildArchLayout(model, lens);
  const cards = l.nodes.filter((n) => n.type === "archNode");
  const groups = l.nodes.filter((n) => n.type === "archGroup");
  const rect = (n) => {
    const w = Number(n.width ?? n.style?.width ?? 274), h = Number(n.height ?? n.style?.height ?? n.measured?.height ?? 0);
    return { x0: n.position.x, y0: n.position.y, x1: n.position.x + w, y1: n.position.y + h };
  };
  const cardRect = (n) => ({ x0: n.position.x, y0: n.position.y, x1: n.position.x + 274, y1: n.position.y + cardHeight(n.data.node) });
  const all = [...cards.map(cardRect), ...groups.map(rect)];
  const x0 = Math.min(...all.map((r) => r.x0)), y0 = Math.min(...all.map((r) => r.y0));
  const x1 = Math.max(...all.map((r) => r.x1)), y1 = Math.max(...all.map((r) => r.y1));
  const W = x1 - x0, H = y1 - y0;
  const fitZoom = Math.min(1160 / W, 700 / H, 1.2);
  const segs = [];
  let edgeLength = 0;
  for (const e of l.edges) {
    const p = e.data?.points ?? [];
    for (let i = 0; i + 1 < p.length; i++) {
      segs.push({ e: e.id, a: p[i], b: p[i + 1] });
      edgeLength += Math.abs(p[i + 1][0] - p[i][0]) + Math.abs(p[i + 1][1] - p[i][1]);
    }
  }
  // Orthogonal segments cross when one is horizontal, the other vertical,
  // and each spans the other's fixed coordinate strictly inside.
  let crossings = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], t = segs[j];
    if (s.e === t.e) continue;
    const h = s.a[1] === s.b[1] ? s : t.a[1] === t.b[1] ? t : null;
    const v = s.a[0] === s.b[0] ? s : t.a[0] === t.b[0] ? t : null;
    if (!h || !v || h === v) continue;
    const [hx0, hx1] = [Math.min(h.a[0], h.b[0]), Math.max(h.a[0], h.b[0])];
    const [vy0, vy1] = [Math.min(v.a[1], v.b[1]), Math.max(v.a[1], v.b[1])];
    if (v.a[0] > hx0 && v.a[0] < hx1 && h.a[1] > vy0 && h.a[1] < vy1) crossings++;
  }
  const gr = groups.map((g) => ({ id: g.id, ...rect(g) }));
  let groupOverlap = 0;
  for (let i = 0; i < gr.length; i++) for (let j = i + 1; j < gr.length; j++) {
    const a = gr[i], b = gr[j];
    const inter = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const contains = (p, q) => p.x0 <= q.x0 && p.y0 <= q.y0 && p.x1 >= q.x1 && p.y1 >= q.y1;
    if (inter && !contains(a, b) && !contains(b, a)) groupOverlap++;
  }
  let orphans = 0;
  const byGroup = new Map(gr.map((g) => [g.id.replace(/^group:/, ""), g]));
  for (const c of cards) {
    const parentGroup = c.data?.node?.group;
    const g = parentGroup ? byGroup.get(parentGroup) : null;
    if (!g) continue;
    const r = cardRect(c);
    if (!(r.x0 >= g.x0 && r.x1 <= g.x1 && r.y0 >= g.y0 && r.y1 <= g.y1)) orphans++;
  }
  return {
    lens, cards: cards.length, groups: groups.length,
    size: `${Math.round(W)}×${Math.round(H)}`, aspect: +(W / H).toFixed(2),
    fitZoom: +fitZoom.toFixed(2), cardTextPx: +(13 * fitZoom).toFixed(1),
    edgeLength: Math.round(edgeLength), crossings, groupOverlap, orphans,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  const lens = process.argv[3] ?? "overview";
  let model;
  if (arg.endsWith(".json")) {
    model = JSON.parse(readFileSync(arg, "utf-8")).architecture;
  } else {
    const { buildPolyglotEnvelope } = await import("./regen_polyglot.mjs");
    const { buildStackIndex } = await import("../src/server/stack.ts");
    const { buildCrossingIndex } = await import("../src/server/crossings.ts");
    const { archModelForEnvelope } = await import("../src/server/arch_envelope.ts");
    if (!existsSync(arg)) throw new Error(`no such fixture ${arg}`);
    const env = buildPolyglotEnvelope(arg).envelope;
    model = archModelForEnvelope(env, buildStackIndex(env, arg), buildCrossingIndex(env), arg);
  }
  console.log(JSON.stringify(measure(model, lens)));
}
