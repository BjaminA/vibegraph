/**
 * Model entry-points in the thread launchpad, living-renderer proof.
 *
 * PyTorch model files are just nn.Module classes with forward() methods —
 * no routes / CLI / tests / cross-file imports, so entry-point discovery
 * found NOTHING and the thread index was blank ("no threads listed"). The
 * `model` kind surfaces each model's forward() as an entry point. This
 * spec asserts the launchpad now paints the model rows and that clicking
 * one opens its forward-path thread.
 *
 * Gated on cnn_demo (SmallCNN).
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/architecture/cnn_demo VG_PORT=4215 PORT=4215 \
 *     npx playwright test test/e2e/arch-model-threads.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_CNN = FIXTURE.includes("cnn_demo");

test.describe("model forward() surfaces as a thread entry point", () => {
  test.skip(!IS_CNN, "Requires VG_FIXTURE=test/fixtures/architecture/cnn_demo");

  test("launchpad lists the Model entry and clicking it opens the forward thread", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // The LEFT SIDEBAR (SidePanel → ThreadTree, default Threads tab) must
    // list the model — this is the surface that was blank for ML projects
    // (ThreadTree's kind-order array dropped the `model` kind).
    const sidebarRow = page.locator('[data-thread-tree-row][data-entry-id="model.py:SmallCNN.forward"]');
    await expect(sidebarRow).toHaveCount(1);
    await expect(sidebarRow).toContainText("SmallCNN.forward");

    // The launchpad model row paints with kind=model too.
    const row = page.locator('[data-thread-index-row][data-entry-id="model.py:SmallCNN.forward"]');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-entry-kind", "model");
    await expect(row).toContainText("SmallCNN.forward");

    // Clicking it opens the forward-path thread.
    await row.click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    // The forward thread paints real layer-application steps (F.relu, etc.).
    await expect(page.locator(".vg-thread-node").first()).toBeVisible();

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
