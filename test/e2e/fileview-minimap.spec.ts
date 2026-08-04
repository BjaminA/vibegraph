/**
 * M-FV.4 (W5) — the file view gains the thread-view minimap (shared
 * component, VgMiniMap), giving an overview + viewport rectangle for large
 * files. Hidden when a right-side dock (CodeView) narrows the canvas.
 *
 * Boot with VG_FIXTURE=test/fixtures/threads/big_demo.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_demo"), "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

async function openFile(page: import("@playwright/test").Page, file: string) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
  await page.click('[data-side-panel-tab="files"]');
  await page.click(`[data-file-tree-row="${file}"]`);
  await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
}

test.describe("file view — minimap (W5)", () => {
  test("renders the minimap with one marker per node", async ({ page }) => {
    await openFile(page, "login_manager.py");
    const minimap = page.locator(".react-flow__minimap");
    await expect(minimap).toBeVisible();
    // A marker per node — a real overview, not an empty box.
    await expect.poll(() => page.locator(".react-flow__minimap-node").count())
      .toBeGreaterThan(10);
  });

  test("minimap hides when the CodeView dock opens", async ({ page }) => {
    await openFile(page, "login_manager.py");
    await expect(page.locator(".react-flow__minimap")).toHaveCount(1);
    await page.click('button[title="Show source for the active file"]');
    await expect(page.locator("[data-code-view]")).toBeVisible({ timeout: 15_000 });
    // The dock narrows the canvas and would sit over the bottom-right
    // minimap, so it unmounts.
    await expect(page.locator(".react-flow__minimap")).toHaveCount(0);
  });
});
