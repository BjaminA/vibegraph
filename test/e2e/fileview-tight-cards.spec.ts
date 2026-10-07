/**
 * Cards fit their content (2026-10-07, Ben: "cards are extending excessively
 * horizontally … dead white space"). Measured before: every card kept 108px
 * on its right for the hover action strip, and short cards were held at a
 * 240px minimum — a median of 109px of nothing per card on the pump-wear
 * example. Now the strip rises ABOVE the card on hover, a card keeps a 16px
 * margin, and import / return / call cards are sized from the fonts they
 * paint. Pinned on a real file, at 1:1, from the painted rectangles:
 *   - the median card ends within 48px of its own rightmost text;
 *   - no LEAF card (no nested cards) carries more than 130px of it;
 *   - the action strip, on hover, shows ABOVE its card, not over its text.
 *
 *   VG_FIXTURE=test/fixtures/threads/big_demo VG_PORT=4211 PORT=4211 \
 *     npx playwright test test/e2e/fileview-tight-cards.spec.ts --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_demo"), "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

test("cards fit their content; the hover strip rides above the card", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
  await page.click('[data-side-panel-tab="files"]');
  await page.click('[data-file-tree-row="login_manager.py"]');
  await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
  const cards = page.locator("[data-fileview-mode-option=cards]");
  if ((await cards.getAttribute("aria-pressed")) !== "true") await cards.click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => { (document.querySelector(".react-flow__viewport") as HTMLElement).style.transform = "translate(0px,40px) scale(1)"; });
  await page.waitForTimeout(300);

  const rows = await page.evaluate(() => {
    const all = [...document.querySelectorAll(".react-flow__node")];
    return all.map((n) => {
      const r = n.getBoundingClientRect();
      const id = n.getAttribute("data-id") ?? "";
      let right = r.left;
      const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!t.textContent?.trim() || t.parentElement?.closest(".react-flow__node") !== n) continue;
        if (t.parentElement?.closest("[data-action-strip]")) continue;
        const range = document.createRange(); range.selectNodeContents(t);
        for (const rr of range.getClientRects()) right = Math.max(right, rr.right);
      }
      const kids = all.filter((k) => (k.getAttribute("data-id") ?? "").startsWith(`${id}/`));
      for (const k of kids) right = Math.max(right, k.getBoundingClientRect().right);
      return { id, leaf: kids.length === 0, dead: Math.round(r.right - right), w: Math.round(r.width) };
    }).filter((x) => x.w > 40);
  });
  expect(rows.length).toBeGreaterThan(8);
  const sorted = rows.map((r) => r.dead).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  expect(median, `median dead space ${median}px`).toBeLessThanOrEqual(48);
  const wide = rows.filter((r) => r.leaf && r.dead > 130);
  expect(wide, wide.map((r) => `${r.id}: ${r.dead}px of ${r.w}`).join("\n")).toEqual([]);

  // hover a leaf card: its strip is visible and sits above the card's top edge
  const leaf = rows.find((r) => r.leaf && r.w > 120)!;
  const card = page.locator(`.react-flow__node[data-id="${leaf.id}"]`);
  await card.hover({ force: true });
  await page.waitForTimeout(400);
  const geo = await card.evaluate((n) => {
    const s = n.querySelector("[data-action-strip]") as HTMLElement | null;
    return s ? { strip: s.getBoundingClientRect().bottom, top: n.getBoundingClientRect().top, opacity: getComputedStyle(s).opacity } : null;
  });
  expect(geo, "the card has an action strip").not.toBeNull();
  expect(Number(geo!.opacity), "shown on hover").toBeGreaterThan(0.5);
  expect(geo!.strip, "above the card, not over its text").toBeLessThanOrEqual(geo!.top + 4);
});
