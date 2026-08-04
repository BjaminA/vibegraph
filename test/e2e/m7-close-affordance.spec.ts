/**
 * M7 cleanup — close affordance for MonacoOverlay + CodeView.
 *
 * Regression: pencil icon opened the editor but the X close button used
 * --text-muted at 11px, making it perceptually invisible next to the
 * accented Save button, and there was no keyboard escape hatch. Users
 * felt the panel was "stuck open". See bug #1 in the post-M7 cleanup pass.
 *
 * Asserts:
 *   - Clicking pencil mounts MonacoOverlay within 3s with a live Monaco
 *     editor instance (the load-state path actually resolves).
 *   - Clicking the visible X button unmounts the overlay.
 *   - Re-opening + pressing Escape unmounts the overlay.
 *   - Same close-affordance contract for the CodeView side panel.
 */
import { test, expect } from "@playwright/test";

test.describe("M7 cleanup — close affordance", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
    await page.waitForTimeout(400);
  });

  test("MonacoOverlay: pencil opens, X closes, Escape closes", async ({ page }) => {
    const fnNode = page.locator(".react-flow__node-functionDefNode").first();
    await fnNode.scrollIntoViewIfNeeded();
    await fnNode.hover();

    // The edit pencil is the first ActionButton in NodeActionStrip,
    // labelled "Edit source". Hovering the node reveals it, but it's
    // there at low opacity from the start so getByTitle finds it.
    await fnNode.getByTitle("Edit source").click();

    const overlay = page.locator("[data-monaco-overlay]");
    await expect(overlay).toBeVisible({ timeout: 3_000 });
    // Loading state must actually resolve to a real editor within the
    // same window. If this fails we're back to bug #1's symptom.
    await expect(overlay.locator(".monaco-editor .view-line").first())
      .toBeVisible({ timeout: 3_000 });

    // X button closes.
    await overlay.locator("[data-monaco-overlay-close]").click();
    await expect(overlay).toHaveCount(0);

    // Re-open + Escape closes. The action strip is hover-revealed
    // (post-M7 cleanup fix #2), so we re-hover before clicking the
    // pencil — same as a real user would naturally do.
    await fnNode.hover();
    await fnNode.getByTitle("Edit source").click();
    await expect(page.locator("[data-monaco-overlay]")).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-monaco-overlay]")).toHaveCount(0);
  });

  test("CodeView: toolbar opens, X closes, Escape closes", async ({ page }) => {
    // Dismiss the runtime-state banner if present so the toolbar is clickable.
    const banner = page.locator("[data-key-banner]");
    if (await banner.count() > 0) await banner.locator("button").click();

    await page.getByRole("button", { name: /code/i }).click();
    const codeView = page.locator("[data-code-view]");
    await expect(codeView).toBeVisible({ timeout: 10_000 });
    await page.waitForSelector("[data-code-view] .monaco-editor .view-line", { timeout: 15_000 });

    await codeView.locator("[data-code-view-close]").click();
    await expect(codeView).toHaveCount(0);

    // Re-open + Escape.
    await page.getByRole("button", { name: /code/i }).click();
    await expect(page.locator("[data-code-view]")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-code-view]")).toHaveCount(0);
  });
});
