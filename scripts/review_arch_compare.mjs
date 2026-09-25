#!/usr/bin/env node
// Critical comparison of VibeGraph's architecture.html against Archify's
// render of the SAME model (and one of Archify's own examples), measured in a
// real browser. Not a test: a measuring instrument whose numbers feed
// reviews/m-arch/COMPARE.md.
//
//   node scripts/review_arch_compare.mjs <dir-with-html> <out-dir>
//
// The directory holds ours-<name>.html and archify-<name>.html pairs plus
// archify-example.html. For every page and viewport it records: page errors,
// requests leaving file://, load time, boxes and edges drawn, how many boxes
// are on screen at first paint, the rendered height of box labels at first
// paint (legibility), edges passing THROUGH an unrelated box, edge labels
// overlapping each other or a box, keyboard-focusable boxes, horizontal page
// overflow; and a screenshot per page × viewport × colour scheme.
import { chromium } from "playwright";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [dir, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const SEL = {
  ours: { node: ".n", nodeRect: ".n rect", edge: ".e", edgePath: ".e path", edgeLabel: ".e text", label: ".n text:not(.sub):not(.chip)" },
  archify: { node: "g[data-node-id]", nodeRect: "g[data-node-id] > rect", edge: "path[marker-end]", edgePath: "path[marker-end]", edgeLabel: "g[data-detail=context]:has(> rect.c-mask) > text", label: "g[data-node-id] text" },
};

const VIEWPORTS = [["desktop", 1440, 900], ["mobile", 390, 844]];

function measure(sel) {
  const vw = innerWidth, vh = innerHeight;
  const rects = [...document.querySelectorAll(sel.node)].map((g) => {
    const r = (g.querySelector("rect") ?? g).getBoundingClientRect();
    return { id: g.dataset.id ?? g.dataset.nodeId, r };
  }).filter((x) => x.r.width > 0);
  const onScreen = rects.filter(({ r }) => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh).length;
  const labelH = [...document.querySelectorAll(sel.label)].map((t) => t.getBoundingClientRect().height).filter((h) => h > 0).sort((a, b) => a - b);
  const inside = (p, r, pad) => p.x > r.left + pad && p.x < r.right - pad && p.y > r.top + pad && p.y < r.bottom - pad;
  let through = 0;
  const throughList = [];
  const paths = [...document.querySelectorAll(sel.edgePath)].filter((p) => p.getTotalLength && p.getTotalLength() > 0);
  for (const p of paths) {
    const len = p.getTotalLength(), ctm = p.getScreenCTM();
    if (!ctm) continue;
    const pts = [];
    for (let i = 0; i <= 60; i++) { const q = p.getPointAtLength((len * i) / 60); pts.push(new DOMPoint(q.x, q.y).matrixTransform(ctm)); }
    const ends = rects.filter(({ r }) => inside(pts[0], r, -6) || inside(pts[pts.length - 1], r, -6)).map((x) => x.id);
    const hit = rects.filter(({ id, r }) => !ends.includes(id) && pts.slice(2, -2).some((q) => inside(q, r, 3)));
    if (hit.length) { through++; throughList.push(hit.map((h) => h.id).join(",")); }
  }
  const lbl = [...document.querySelectorAll(sel.edgeLabel)].map((t) => t.getBoundingClientRect()).filter((r) => r.width > 0);
  const ov = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  let labelLabel = 0, labelBox = 0;
  for (let i = 0; i < lbl.length; i++) {
    for (let j = i + 1; j < lbl.length; j++) if (ov(lbl[i], lbl[j])) labelLabel++;
    if (rects.some(({ r }) => ov(lbl[i], r))) labelBox++;
  }
  const focusable = [...document.querySelectorAll(sel.node)].filter((g) => g.getAttribute("tabindex") !== null).length;
  return {
    boxes: rects.length, edges: paths.length, onScreen,
    labelPxMin: labelH.length ? +labelH[0].toFixed(1) : null,
    labelPxMedian: labelH.length ? +labelH[Math.floor(labelH.length / 2)].toFixed(1) : null,
    edgesThroughBox: through, throughSample: throughList.slice(0, 4),
    edgeLabels: lbl.length, labelOverlapsLabel: labelLabel, labelOverlapsBox: labelBox,
    focusableBoxes: focusable,
    hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    controls: [...document.querySelectorAll("button, input")].filter((b) => b.offsetParent !== null).map((b) => (b.getAttribute("aria-label") || b.textContent || b.placeholder || "").trim().slice(0, 32)).filter(Boolean),
  };
}

const browser = await chromium.launch();
const results = [];
const pages = readdirSync(dir).filter((f) => /^(ours|archify)-.*\.html$/.test(f)).sort();
for (const f of pages) {
  const kind = f.startsWith("ours") ? "ours" : "archify";
  for (const [vpName, w, h] of VIEWPORTS) {
    for (const scheme of ["dark", "light"]) {
      if (vpName === "mobile" && scheme === "light") continue;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [], external = [];
      page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
      page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`); });
      page.on("request", (r) => { if (!r.url().startsWith("file:") && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url()); });
      const t0 = Date.now();
      await page.goto("file://" + join(dir, f), { waitUntil: "load" });
      await page.waitForTimeout(1200);
      const loadMs = Date.now() - t0;
      const m = await page.evaluate(measure, SEL[kind]);
      const shot = `${f.replace(".html", "")}-${vpName}-${scheme}.png`;
      await page.screenshot({ path: join(out, shot) });
      results.push({ page: f, kind, viewport: vpName, scheme, loadMs, errors, external: [...new Set(external)], ...m, shot });
      await ctx.close();
    }
  }
}
await browser.close();
writeFileSync(join(out, "measurements.json"), JSON.stringify(results, null, 2));
for (const r of results) {
  if (r.scheme !== "dark") continue;
  console.log(`${r.page.padEnd(22)} ${r.viewport.padEnd(7)} load ${String(r.loadMs).padStart(5)}ms err ${r.errors.length} ext ${r.external.length} | boxes ${r.boxes} on-screen ${r.onScreen} edges ${r.edges} | label px min/med ${r.labelPxMin}/${r.labelPxMedian} | through-box ${r.edgesThroughBox} | edge labels ${r.edgeLabels} ov-label ${r.labelOverlapsLabel} ov-box ${r.labelOverlapsBox} | focusable ${r.focusableBoxes} | hOverflow ${r.hOverflow}`);
}
