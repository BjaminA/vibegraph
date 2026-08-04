/**
 * U1.2 — chat panel layout + responsiveness.
 *
 * (Parked by M10-chat-removal, un-parked by the M25 chat revival.)
 *
 * Pre-fix bugs:
 *   (A) ChatPanel wrapped in ViewTransition; the wrapper's transform
 *       broke position:fixed and created a new stacking context, so
 *       the panel rendered in the wrong place and lost its zIndex
 *       battle against the SidePanel.
 *   (B) Even after un-wrapping, ChatPanel's `left: 0` overlapped the
 *       280px side panel column.
 *   (C) `send` useCallback was missing activeFilePath in deps (stale
 *       closure).
 *   (D) "No active file" error referred to removed module-node UI.
 *
 * Gated on flask_demo so the side-panel inset is exercised.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("U1.2 — chat panel layout", () => {
  // M25 chat revival: the M10 park-skip is lifted with the panel remounted.
  test.skip(!IS_FLASK,
    "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("chat panel clears the side panel and accepts input (directory mode)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // Open chat via the floating toggle. Drilling into a file first so
    // the chat actually has an active file (the recovery hint covered
    // by the empty-file path is tested separately below).
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="db.py"]');
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });

    // Floating chat toggle. Lucide MessageCircle icon → no obvious
    // aria-label; click by title.
    await page.getByTitle(/chat/i).first().click();
    const chat = page.locator("[data-chat-panel]");
    await expect(chat).toBeVisible({ timeout: 5_000 });

    // The chat panel's left edge clears the 280px side panel column.
    const box = await chat.boundingBox();
    expect(box, "chat panel should have a bounding box").not.toBeNull();
    // Playwright's boundingBox returns { x, y, width, height } — x is
    // the panel's left edge in CSS pixels.
    expect(box!.x).toBeGreaterThanOrEqual(280);

    // The textarea should be focusable (no overlay intercepting clicks).
    const textarea = chat.locator("textarea");
    await textarea.click();
    await expect(textarea).toBeFocused();
  });
});
