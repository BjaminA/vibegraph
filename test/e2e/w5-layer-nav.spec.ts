/**
 * W5 — arch layer glyphs navigate to their thread.
 *
 * Model headers already opened their forward() thread; layer glyphs were
 * dead-ends. W5 makes a layer-glyph click open the owning model's forward()
 * data-path thread (the contract: every arch node links to its thread).
 *
 * Gated on cnn_demo (SmallCNN). Boot: VG_FIXTURE=test/fixtures/architecture/cnn_demo
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("cnn_demo"), "Requires VG_FIXTURE=test/fixtures/architecture/cnn_demo");

test.describe("W5 — layer glyph navigates to the forward thread", () => {
  test("clicking a layer glyph opens the model's forward() thread", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.getByRole("button", { name: "Arch" }).click();
    await expect(page.locator("[data-architecture-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);

    // A layer glyph carries a pointer cursor (the nav affordance).
    const glyph = page.locator("[data-layer-glyph]").first();
    await expect(glyph).toBeVisible();
    expect(await glyph.evaluate((e) => getComputedStyle(e).cursor)).toBe("pointer");

    await glyph.click();

    // Navigation lands on the forward thread.
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".vg-thread-node").first()).toBeVisible({ timeout: 10_000 });

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
