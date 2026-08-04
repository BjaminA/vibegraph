/**
 * M4b wave 4 — thread view toggle end-to-end.
 *
 * Drives the toolbar Thread button through a complete round-trip:
 *   1. Page boots, diagram renders.
 *   2. Click `calculate_area` function node -> becomes the chat context.
 *   3. Toolbar Thread button becomes enabled.
 *   4. Click it -> the extract-thread WS round-trip fires and the
 *      ThreadView replaces the DiagramCanvas.
 *   5. Click it again -> back to the diagram, thread state preserved.
 *
 * Uses sample_advanced.py (the default Playwright fixture) -- the thread
 * is shallow (single file, mostly external/dynamic terminals) but the
 * round-trip and toggle behaviour is the same load-bearing path the
 * aero_demo fixture exercises.
 */
import { test, expect } from "@playwright/test";

test.describe("VibeGraph thread view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
  });

  test("thread button is disabled until a function is selected", async ({ page }) => {
    // Toolbar Thread button is the 3rd button (Filters, Analyze, Thread).
    const threadBtn = page.getByRole("button", { name: "Thread", exact: true });
    await expect(threadBtn).toBeDisabled();
  });

  test("clicking thread on a selected function renders the thread view", async ({ page }) => {
    // Click a function_def node — calculate_area is at the top of the
    // sample file and is a reliable target.
    const fnNode = page.locator('.react-flow__node-functionDefNode').first();
    await fnNode.click();

    const threadBtn = page.getByRole("button", { name: "Thread", exact: true });
    await expect(threadBtn).toBeEnabled();

    await threadBtn.click();

    // The ThreadView container carries a data-thread-view attribute so
    // we can target it without DOM-structure fragility. It mounts once
    // the thread-update message arrives -- bound below by the seed
    // attribute carrying the seed's qualified name.
    const threadView = page.locator("[data-thread-view]");
    await expect(threadView).toBeVisible({ timeout: 10_000 });
    const seed = await threadView.getAttribute("data-seed-id");
    expect(seed).toMatch(/:calculate_area$/);

    // Seed node must be present in the rendered tree.
    await expect(page.locator(".vg-thread-node-seed")).toBeVisible();

    // Diagram canvas must be gone while in thread view.
    await expect(page.locator(".react-flow__node-functionDefNode")).toHaveCount(0);
  });

  test("toggle returns cleanly to the diagram view", async ({ page }) => {
    const fnNode = page.locator(".react-flow__node-functionDefNode").first();
    await fnNode.click();
    const threadBtn = page.getByRole("button", { name: "Thread", exact: true });
    await threadBtn.click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });

    // Click again -- back to diagram. The original function_def nodes
    // come back; the thread-view container is gone.
    await threadBtn.click();
    await expect(page.locator("[data-thread-view]")).toHaveCount(0);
    await expect(page.locator(".react-flow__node-functionDefNode").first()).toBeVisible();
  });
});
