/**
 * Long container labels wrap, and nothing overlaps (2026-10-02, Ben's
 * screenshot: a `FOR [label, sid, doc] of [ [ …a long literal… ] ]` chip ran
 * far off its container to the right, read "glob_* â†' glob_a-1" (UTF-8
 * decoded as cp1252 by Python on Windows), and the FINALLY chip below was
 * buried under the box above it). Asserted on the painted rectangles, in
 * both orientations:
 *   - every chip stays inside its own container's width, on at most two lines;
 *   - no chip overlaps another chip or a card;
 *   - no two cards overlap;
 *   - no label carries mojibake.
 * And zoomed out (2026-10-07, Ben's screenshot: two nested `for … of` loops in
 * a test, the outer chip's second line under the inner chip, the inner chip
 * over the first card): below full zoom a chip grows only into the room the
 * layout reserved for it, on one line — the same checks hold at the
 * overview tier.
 *
 *   VG_FIXTURE=test/fixtures/threads/chip_long_demo VG_PORT=4267 PORT=4267 \
 *     npx playwright test test/e2e/thread-chip-long.spec.ts --workers=1
 */
import { test, expect, type Page } from "@playwright/test";

const IS_DEMO = (process.env.VG_FIXTURE ?? "").includes("chip_long_demo");

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 1 && h > 1 ? w * h : 0;
};

async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const containers = [...document.querySelectorAll(".react-flow__node-threadContainer")].map((n) => {
      const chip = n.querySelector(".vg-thread-container-chip");
      return { box: box(n), chip: chip ? { box: box(chip), text: (chip.textContent ?? "").trim(), lineH: parseFloat(getComputedStyle(chip).lineHeight) || 15 } : null };
    });
    const cards = [...document.querySelectorAll(".react-flow__node-threadNode")].map((n) => ({ box: box(n), text: (n.textContent ?? "").trim().slice(0, 40) }));
    return { containers, cards };
  });
}

const scale = (page: Page) => page.locator(".react-flow__viewport").evaluate((el) => Number(/scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)?.[1] ?? 1));

async function check(page: Page, expectChip: string, zoomedOut = false) {
  const zoom = 1;
  await page.waitForTimeout(1400);
  // Measure at 1:1 so a chip's two-line cap is in screen pixels.
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("vg-thread-zoom-reset")));
  if (zoomedOut) {
    // the overview tier (lod.ts: below 0.28), where chips grow with zoom-out
    for (let i = 0; i < 20 && (await scale(page)) >= 0.27; i++) { await page.locator(".react-flow__controls-zoomout").click(); await page.waitForTimeout(120); }
    expect(await scale(page)).toBeLessThan(0.28);
    await page.waitForTimeout(600);
  }
  const { containers, cards } = await measure(page);
  const chips = containers.filter((c) => c.chip).map((c) => ({ ...c.chip!, owner: c.box }));
  expect(chips.some((c) => c.text.startsWith(expectChip)), `the chip renders: ${chips.map((c) => c.text).join(" | ")}`).toBe(true);
  const problems: string[] = [];
  for (const c of chips) {
    if (/â|Ã/.test(c.text)) problems.push(`mojibake in "${c.text}"`);
    if (c.box.x + c.box.w > c.owner.x + c.owner.w + 1) problems.push(`"${c.text.slice(0, 40)}" runs ${Math.round(c.box.x + c.box.w - c.owner.x - c.owner.w)}px past its container`);
    if (c.box.h > 2 * c.lineH * zoom + 12) problems.push(`"${c.text.slice(0, 40)}" wraps onto more than two lines (${Math.round(c.box.h)}px)`);
  }
  for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
    const a = overlap(chips[i].box, chips[j].box);
    if (a) problems.push(`chip "${chips[i].text.slice(0, 30)}" × chip "${chips[j].text.slice(0, 30)}" = ${Math.round(a)}px²`);
  }
  for (const c of chips) for (const k of cards) {
    const a = overlap(c.box, k.box);
    if (a) problems.push(`chip "${c.text.slice(0, 30)}" × card "${k.text}" = ${Math.round(a)}px²`);
  }
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = overlap(cards[i].box, cards[j].box);
    if (a) problems.push(`card "${cards[i].text}" × card "${cards[j].text}" = ${Math.round(a)}px²`);
  }
  expect(problems).toEqual([]);
}

test.describe("long container labels", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/threads/chip_long_demo");

  for (const orientation of ["horizontal", "vertical"] as const) {
    test(`${orientation}: chips wrap inside their containers; no chip, card or box overlaps`, async ({ page }) => {
      await page.addInitScript((o) => { try { localStorage.setItem("vg-thread-orientation", o); } catch { /* ignore */ } }, orientation);
      await page.goto("/");
      await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
      await page.click('[data-thread-index-row][data-entry-id="probe.ts:module"]');
      await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
      await check(page, "FOR  [label, sid, doc] of");
      await check(page, "FOR  [label, sid, doc] of", true);
    });
  }

  for (const zoomedOut of [false, true]) {
    test(`nested for-of loops in a test: no chip on a chip or a card${zoomedOut ? ", zoomed out" : ""}`, async ({ page }) => {
      await page.goto("/");
      await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
      await page.locator('[data-thread-index-row][data-entry-id^="catalog.test.ts"]').first().click();
      await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
      const all = page.getByRole("button", { name: "All", exact: true });
      if (await all.count()) await all.first().click();
      await check(page, "FOR  w of", zoomedOut);
    });
  }
});
