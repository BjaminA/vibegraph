/**
 * Containers never cover cards (2026-10-05). On a script thread — one helper
 * called from many `if` blocks, shared externals inside `try` blocks in
 * several functions, calls nested in arguments, tall cards — the `if`/`try`
 * boxes used to stretch from their own call site to wherever a shared card
 * was drawn, sit over the callees beside them, and let tall cards poke out:
 * on one 276-card thread 99 cards straddled a box edge. Now: no card
 * straddles a box, no chip sits on a card, no two sibling boxes overlap.
 *
 *   VG_FIXTURE=test/fixtures/threads/overlap_demo VG_PORT=4309 PORT=4309 \
 *     npx playwright test test/e2e/thread-container-overlap.spec.ts --workers=1
 */
import { test, expect } from "@playwright/test";

const IS_DEMO = (process.env.VG_FIXTURE ?? "").includes("overlap_demo");

test.describe("thread containers and cards", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/threads/overlap_demo");
  test.use({ viewport: { width: 1600, height: 1000 } });

  test("no card straddles a box, no chip sits on a card, no sibling boxes overlap", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
    await page.locator('[data-thread-index-row][data-entry-id^="bin/run-checks.ts"]').first().click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 15_000 });
    // "All": every card and box drawn.
    const all = page.getByRole("button", { name: "All", exact: true });
    if (await all.count()) await all.first().click();
    await expect(page.locator("[data-thread-container]").first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500); // cards measured, rows re-spaced, boxes re-sized
    // At reading zoom (cards and boxes at full size). Zoomed out, a chip grows
    // only into the room reserved for it — thread-chip-long.spec.ts checks
    // that tier.
    const scale = () => page.locator(".react-flow__viewport").evaluate((el) => Number(/scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)?.[1] ?? 1));
    for (let i = 0; i < 12 && (await scale()) < 0.75; i++) { await page.locator(".react-flow__controls-zoomin").click(); await page.waitForTimeout(150); }
    expect(await scale()).toBeGreaterThanOrEqual(0.75);
    await page.waitForTimeout(1500); // full-size cards measured, boxes re-sized
    const r = await page.evaluate(() => {
      const rect = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
      const inter = (a: any, b: any) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const inside = (p: any, q: any) => p.x >= q.x - 1 && p.y >= q.y - 1 && p.x + p.w <= q.x + q.w + 1 && p.y + p.h <= q.y + q.h + 1;
      const all = [...document.querySelectorAll(".react-flow__node")];
      const boxes = all.filter((n) => n.querySelector("[data-thread-container]")).map((n) => ({ id: n.getAttribute("data-id")!, r: rect(n), chip: n.querySelector("[data-container-chip]") ? rect(n.querySelector("[data-container-chip]")!) : null }));
      const cards = all.filter((n) => !n.querySelector("[data-thread-container]")).map((n) => ({ id: n.getAttribute("data-id")!, r: rect(n) }));
      const out: string[] = [];
      for (const b of boxes) for (const c of cards) {
        const a = inter(b.r, c.r);
        if (a > 1 && !inside(c.r, b.r)) out.push(`card ${c.id} straddles ${b.id}`);
        if (b.chip && inter(b.chip, c.r) > 1) out.push(`chip of ${b.id} on card ${c.id}`);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [p, q] = [boxes[i].r, boxes[j].r];
        if (inter(p, q) > 1 && !inside(p, q) && !inside(q, p)) out.push(`box ${boxes[i].id} overlaps ${boxes[j].id}`);
      }
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) if (inter(cards[i].r, cards[j].r) > 1) out.push(`card ${cards[i].id} on card ${cards[j].id}`);
      return { boxes: boxes.length, cards: cards.length, out };
    });
    expect(r.boxes).toBeGreaterThan(5);
    expect(r.cards).toBeGreaterThan(20);
    expect(r.out, r.out.slice(0, 12).join("\n")).toEqual([]);
  });
});
