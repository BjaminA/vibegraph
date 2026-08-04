/**
 * Regression: closing the file view's side CodeView made the Claude chat
 * pop up as the full-width bottom bar.
 *
 * M28.3 docks the chat beneath an open code panel by setting chatOpen=true.
 * That flag was never reset, so when the code panel closed (regionOpen→false)
 * the chat survived as the full-width bottom bar (fullWidthChat = chatOpen &&
 * !regionOpen). A chat the *region* opened must retract when the region
 * closes; a chat the user opened via the star toggle must persist.
 *
 * Boot with VG_FIXTURE=test/fixtures/threads/big_demo.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_demo"), "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

const CODE_OPEN = 'button[title="Show source for the active file"]';
const CODE_CLOSE = 'button[title="Close code view"]';
const STAR_BTN = 'button[title^="Open Claude chat"]';

async function openFile(page: import("@playwright/test").Page, file: string) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
  await page.click('[data-side-panel-tab="files"]');
  await page.click(`[data-file-tree-row="${file}"]`);
  await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
}

test.describe("file view — chat retracts with the code panel", () => {
  test("opening the CodeView docks the chat; closing it retracts the chat", async ({ page }) => {
    await openFile(page, "login_manager.py");
    // No chat before any code panel opens.
    await expect(page.locator("[data-chat-panel]")).toHaveCount(0);

    // Open CodeView → chat docks beneath it (M28.3 — preserved).
    await page.click(CODE_OPEN);
    await expect(page.locator("[data-code-view]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-chat-panel]")).toHaveCount(1);

    // Close CodeView → the region-opened chat retracts; it must NOT pop up
    // as the full-width bottom bar.
    await page.click(CODE_CLOSE);
    await expect(page.locator("[data-code-view]")).toHaveCount(0);
    await expect(page.locator("[data-chat-panel]")).toHaveCount(0);
  });

  test("a chat the user opened via the star persists across a code-panel cycle", async ({ page }) => {
    await openFile(page, "login_manager.py");

    // User opens the chat from the star — it's theirs now.
    await page.click(STAR_BTN);
    await expect(page.locator("[data-chat-panel]")).toHaveCount(1);

    // Opening then closing a code panel must not retract the user's chat.
    await page.click(CODE_OPEN);
    await expect(page.locator("[data-code-view]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-chat-panel]")).toHaveCount(1);
    await page.click(CODE_CLOSE);
    await expect(page.locator("[data-code-view]")).toHaveCount(0);
    await expect(page.locator("[data-chat-panel]")).toHaveCount(1);
  });
});
