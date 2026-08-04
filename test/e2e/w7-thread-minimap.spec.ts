/**
 * W7 — the thread view has a minimap (overview + viewport reference).
 *
 * The shared VgMiniMap was already wired into the thread view (M-FV.4); W7
 * verifies it on the painted view and adds a thread-tinted nodeColor so the
 * minimap dots match the node accents. This pins the contract so it can't
 * silently regress.
 *
 * Gated on flask_demo. Boot: VG_FIXTURE=test/fixtures/threads/flask_demo
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("flask_demo"), "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

test.describe("W7 — thread-view minimap", () => {
  test("minimap renders in the thread view with a dot per thread node", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);

    const minimap = page.locator(".react-flow__minimap");
    await expect(minimap).toBeVisible();

    const nodes = await page.locator("[data-thread-view] .vg-thread-node").count();
    expect(nodes).toBeGreaterThan(0);

    // M-NA7 — the old path-length proxy passed on a grey smear. The
    // custom minimap node (min-footprint floor) renders one rect per
    // thread node; each must paint at a genuinely visible on-screen
    // size, so a long L-R thread reads as colored structure.
    const dots = page.locator(".react-flow__minimap-node");
    expect(await dots.count(), "one minimap dot per thread node").toBeGreaterThanOrEqual(nodes);
    const sizes = await dots.evaluateAll((els) =>
      els.map((el) => {
        const b = el.getBoundingClientRect();
        return { w: b.width, h: b.height };
      }),
    );
    for (const s of sizes) {
      expect(s.h, "every minimap dot must be visibly tall (no sub-pixel smear)").toBeGreaterThan(1.5);
      expect(s.w, "every minimap dot must be visibly wide").toBeGreaterThan(1.5);
    }
  });
});
