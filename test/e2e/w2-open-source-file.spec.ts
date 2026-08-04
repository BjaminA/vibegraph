/**
 * W2 — node pin vs full-file panel: the "Open source file" affordance.
 *
 * Instead of a floating full-file panel that overlaps the pinned node card,
 * the node card gets an "Open source file" button that opens the node's file
 * in the file/diagram view (its whole-file context). And the pinned tooltip
 * is now dismissed when a detail dock (editor OR CodeView) opens, so they
 * never overlap.
 *
 * Gated on flask_demo. Boot: VG_FIXTURE=test/fixtures/threads/flask_demo
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("flask_demo"), "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

test.describe("W2 — open source file from the node card", () => {
  test("the card's Open-source-file button navigates to the file view", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="db.py:insert"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);

    // Hover a step node (has a file) → its card shows "Open source file".
    // (Clicking a node opens the editor; hover surfaces the tooltip.)
    const node = page.locator(".vg-thread-node").first();
    await node.hover();
    const tooltip = page.locator("[data-thread-tooltip]");
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });
    const openBtn = tooltip.locator("[data-open-source-file]");
    await expect(openBtn).toBeVisible();

    await openBtn.click();

    // Navigation lands on the file/diagram view (thread view gone, nodes painted).
    await expect(page.locator("[data-thread-view]")).toHaveCount(0, { timeout: 10_000 });
    await page.waitForSelector(".react-flow__node", { timeout: 10_000 });

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
