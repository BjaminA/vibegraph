#!/usr/bin/env node
// Overlap audit for the webview, run against a live VibeGraph server.
//
//   node scripts/review_overlaps.mjs [http://localhost:4400] [thread-entry-id] [out-dir]
//
// For each surface it counts boxes that intersect when they should not:
// card on card, content spilling out of its own card, a label on a card, a
// label on a label. A surface passes with every count at zero. Screenshots
// land in out-dir.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const URL = process.argv[2] ?? "http://localhost:4400";
const THREAD = process.argv[3] ?? null;
const OUT = process.argv[4] ?? "/tmp/overlaps";
mkdirSync(OUT, { recursive: true });

// In the page: the rects of each selector, and the overlap counts between groups.
function audit(spec) {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth ? r : null; };
  const rects = (sel) => [...document.querySelectorAll(sel)].map((e) => ({ e, r: vis(e) })).filter((x) => x.r);
  const ov = (a, b, pad = 1) => a.left + pad < b.right && b.left + pad < a.right && a.top + pad < b.bottom && b.top + pad < a.bottom;
  const name = (e) => (e.getAttribute("data-id") ?? e.getAttribute("data-subsystem-id") ?? e.getAttribute("data-arch-id") ?? e.textContent ?? "").trim().slice(0, 40);
  const out = {};
  const pairs = (key, A, B, same) => {
    const hits = [];
    for (let i = 0; i < A.length; i++) for (let j = same ? i + 1 : 0; j < B.length; j++) {
      if (A[i].e === B[j].e || A[i].e.contains(B[j].e) || B[j].e.contains(A[i].e)) continue;
      if (ov(A[i].r, B[j].r)) hits.push(`${name(A[i].e)} × ${name(B[j].e)}`);
    }
    out[key] = { count: hits.length, sample: hits.slice(0, 3) };
  };
  const cards = rects(spec.cards);
  pairs("card×card", cards, cards, true);
  if (spec.labels) { const L = rects(spec.labels); pairs("label×card", L, cards, false); pairs("label×label", L, L, true); }
  if (spec.badges) pairs("badge×card", rects(spec.badges), cards, false);
  if (spec.spill) {
    // children that stick out of their own card
    const hits = [];
    for (const { e, r } of cards) for (const c of e.querySelectorAll(spec.spill)) {
      const cr = c.getBoundingClientRect();
      if (cr.width > 1 && (cr.right > r.right + 1 || cr.left < r.left - 1 || cr.bottom > r.bottom + 1)) hits.push(`${name(e)} ⊃ ${c.textContent.trim().slice(0, 30)}`);
    }
    out["spill out of card"] = { count: hits.length, sample: hits.slice(0, 3) };
  }
  if (spec.chrome) {
    const C = rects(spec.chromeSel);
    // The floating chat button is exempt against CARDS on a canvas that
    // opens larger than the screen (the architecture Overview opens at the
    // legibility floor, not fit-all): content there passes under the corner
    // button until panned. It still counts against every other chrome.
    if (spec.chrome === "all") pairs("chrome×card", spec.pannable ? C.filter((c) => !c.e.hasAttribute("data-floating-toggle")) : C, cards, false);
    pairs("chrome×chrome", C, C, true);
  }
  out.cards = cards.length;
  return out;
}
// Fixed surfaces that float over a view.
const CHROME = "[data-top-toolbar], [data-floating-toggle], [data-effects-panel], [data-arch-legend], [data-arch-lens-bar], [data-system-mode-toggle], [data-system-arch-toggle]";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(URL, { timeout: 120000 });
await p.waitForSelector("[data-thread-tree-row]", { timeout: 180000 });
const banner = p.locator("[data-key-banner]");
if (await banner.count()) await banner.locator("button").click().catch(() => {});
const report = {};
// Chrome: a banner covering a control (the deps banner sat over the canvas toggles).
const chromeCheck = async (name) => {
  report[name] = await p.evaluate(() => {
    const banners = [...document.querySelectorAll("[data-deps-banner], [data-key-banner]")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 1);
    const ctrls = [...document.querySelectorAll("button, [role=button], input")].filter((e) => !e.closest("[data-deps-banner], [data-key-banner]"));
    const hits = [];
    for (const c of ctrls) { const r = c.getBoundingClientRect(); if (r.width < 2) continue;
      if (banners.some((bn) => r.left < bn.right && bn.left < r.right && r.top < bn.bottom && bn.top < r.bottom)) hits.push((c.getAttribute("aria-label") ?? c.textContent ?? "").trim().slice(0, 30)); }
    return { "banner×control": { count: hits.length, sample: hits.slice(0, 4) }, cards: 0 };
  });
};
const run = async (name, spec) => { await p.waitForTimeout(1500); report[name] = await p.evaluate(audit, spec); await p.screenshot({ path: join(OUT, `${name}.png`) }); };

// System view — subsystems (expanded cards too)
await p.evaluate(() => { try { localStorage.removeItem("vg-system-mode"); } catch {} });
// The app may boot straight into the System view's map (the default first
// view); otherwise open the System view. Either way, start in Subsystems.
if (!(await p.locator("[data-system-view]").count())) await p.getByRole("button", { name: "System" }).click();
await p.waitForSelector("[data-system-view]", { timeout: 20000 });
if ((await p.locator("[data-system-view]").getAttribute("data-system-mode")) === "map") await p.locator("[data-system-arch-toggle]").click();
await p.waitForTimeout(1000);
await chromeCheck("chrome (system view)");
for (const x of await p.locator("[data-deps-banner] button").all()) await x.click().catch(() => {});
await run("system-subsystems", { chrome: "all", chromeSel: CHROME, cards: "[data-subsystem-node]", spill: "[data-subsystem-tool], [data-subsystem-subline], [data-subsystem-endpoint]" });
for (const btn of await p.locator("[data-subsystem-expand]").all()) await btn.click().catch(() => {});
await run("system-subsystems-expanded", { cards: "[data-subsystem-node]", spill: "[data-subsystem-tool], [data-subsystem-endpoint]" });
// System view — architecture map
await p.locator("[data-system-arch-toggle]").click();
await run("architecture-map", { chrome: "all", pannable: true, chromeSel: CHROME, cards: "[data-arch-node], [data-arch-group-label]", labels: ".react-flow__edge-textwrapper, .react-flow__edge-text" });
// The Bird's-eye lens: the densest reading of the same map, fitted to one screen.
await p.locator('[data-arch-lens="birdseye"]').click();
await run("architecture-birdseye", { chrome: "all", chromeSel: CHROME, cards: "[data-arch-node], [data-arch-group-label]", labels: ".react-flow__edge-textwrapper, .react-flow__edge-text" });
await p.locator('[data-arch-lens="overview"]').click();
await p.locator("[data-system-arch-toggle]").click();

// Thread view
if (THREAD) {
  await p.getByRole("button", { name: "Thread" }).click().catch(() => {});
  await p.goto(URL, { timeout: 180000 }); await p.waitForSelector("[data-thread-tree-row]", { timeout: 180000 });
  await p.locator(`[data-thread-tree-row][data-entry-id="${THREAD}"]`).click();
  await p.waitForSelector(".react-flow__node", { timeout: 60000 });
  // Walk the thread: a screenful at the opening zoom, then pan right and down
  // in steps, auditing each stop, so the dense middle of a thread is seen.
  const spec = { chrome: "self", chromeSel: CHROME, cards: ".react-flow__node-threadNode", labels: ".vg-thread-edge-label", badges: "[data-nest-badge]" };
  const total = {};
  let stops = 0;
  const pane = await p.locator(".react-flow__pane").boundingBox();
  for (const [dx, dy] of [[0, 0], [-500, 0], [-500, 0], [0, -300], [500, 0], [500, 0], [0, -300], [-500, 0], [-500, 0]]) {
    if (dx || dy) { await p.mouse.move(pane.x + 700, pane.y + 400); await p.mouse.down(); await p.mouse.move(pane.x + 700 + dx, pane.y + 400 + dy, { steps: 6 }); await p.mouse.up(); }
    await p.waitForTimeout(700);
    const r = await p.evaluate(audit, spec);
    stops++;
    for (const [k, v] of Object.entries(r)) {
      if (k === "cards") { total.cards = (total.cards ?? 0) + v; continue; }
      total[k] = total[k] ?? { count: 0, sample: [] };
      total[k].count += v.count; total[k].sample.push(...v.sample);
    }
    if (stops === 5) await p.screenshot({ path: join(OUT, "thread-middle.png") });
  }
  for (const v of Object.values(total)) if (v.sample) v.sample = [...new Set(v.sample)].slice(0, 3);
  report["thread (9 stops)"] = total;
}
await b.close();
for (const [k, v] of Object.entries(report)) {
  const bad = Object.entries(v).filter(([kk, vv]) => typeof vv === "object" && vv.count);
  console.log(`${k.padEnd(28)} cards ${String(v.cards).padStart(3)}  ${bad.length ? bad.map(([kk, vv]) => `${kk} ${vv.count}`).join(" · ") : "no overlaps"}`);
  for (const [kk, vv] of bad) for (const s of vv.sample) console.log(`    ${kk}: ${s}`);
}
