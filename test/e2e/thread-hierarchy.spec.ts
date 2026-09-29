/**
 * Thread hierarchy (2026-09-29, TODO "Thread hierarchy").
 *
 * flask_demo's `cli.py:main` walks through `db.py:insert`, which is an entry
 * point of its own, so:
 *   1. the Threads list nests db.py:insert under a caller (nested is the
 *      default; every thread is still listed once), and the flat list is one
 *      toggle away;
 *   2. inside cli.py:main, the step that IS insert's head carries a
 *      "sub-thread" badge, and clicking it opens that thread.
 *
 *   npm run test:e2e-thread-hierarchy
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("thread hierarchy", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("the Threads list nests sub-threads, and flattens on a toggle", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { try { localStorage.removeItem("vg-thread-index-layout"); } catch { /* */ } });
    await page.reload();
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    const ids = await page.$$eval("[data-thread-index-row]", (els) => els.map((e) => e.getAttribute("data-entry-id")));
    expect(new Set(ids).size, "every thread listed exactly once").toBe(ids.length);

    const insert = page.locator('[data-thread-index-item]:has([data-entry-id="db.py:insert"])');
    await expect(insert).toHaveAttribute("data-depth", /[1-9]/);
    await expect(insert.locator("[data-thread-index-note]")).toContainText("sub-thread of");

    // Folding the caller hides its sub-threads; unfolding brings them back.
    const parent = await page.locator("[data-thread-index-fold]").first().getAttribute("data-thread-index-fold");
    await page.click(`[data-thread-index-fold="${parent}"]`);
    const hiddenCount = await page.locator("[data-thread-index-row]").count();
    expect(hiddenCount).toBeLessThan(ids.length);
    await page.click(`[data-thread-index-fold="${parent}"]`);
    await expect(page.locator("[data-thread-index-row]")).toHaveCount(ids.length);

    await page.click("[data-thread-index-layout]");
    await expect(page.locator("[data-thread-index-layout]")).toHaveAttribute("data-thread-index-layout", "flat");
    const depths = await page.$$eval("[data-thread-index-item]", (els) => els.map((e) => e.getAttribute("data-depth")));
    expect(depths.every((d) => d === "0")).toBe(true);
    await expect(page.locator("[data-thread-index-note]")).toHaveCount(0);

    // The choice persists per viewer.
    await page.reload();
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await expect(page.locator("[data-thread-index-layout]")).toHaveAttribute("data-thread-index-layout", "flat");
    await page.click("[data-thread-index-layout]");
  });

  test("a step that starts another thread is badged, and the badge opens it", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });

    const badge = page.locator('[data-subthread-badge="db.py:insert"]').first();
    await expect(badge).toBeAttached({ timeout: 10_000 });
    // The seed never badges itself.
    await expect(page.locator('[data-subthread-badge="cli.py:main"]')).toHaveCount(0);

    await badge.scrollIntoViewIfNeeded();
    await badge.click({ force: true });
    await expect(page.locator("[data-thread-view]")).toHaveAttribute("data-seed-id", /insert/, { timeout: 10_000 });
  });
});
