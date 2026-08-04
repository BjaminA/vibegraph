/**
 * M4b wave 5 — big_demo seed video capture.
 *
 * Per PLAN.md S1.5 M4b: "big_demo gets a 5-second Playwright video clip
 * of seed-click -> thread-render on each of two seeds". Records two
 * .webm clips into reviews/m4b-thread/.
 *
 * Gated by VG_CAPTURE=1 so `npm test` stays clean. Run:
 *   VG_CAPTURE=1 VG_FIXTURE=test/fixtures/threads/big_demo \
 *     npx playwright test test/e2e/m4b-big-capture.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "m4b-thread");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BIG = FIXTURE.includes("big_demo");

// Top-level test.use(video) -- playwright forbids it inside describe.
test.use({
  video: {
    mode: "on",
    size: { width: 1280, height: 800 },
  },
});

async function seedThread(
  page: import("@playwright/test").Page,
  fnName: string,
  fnNodeId: string,
): Promise<void> {
  await page.goto("/");
  // M8.3.2: directory fixtures boot into the thread index — pivot to
  // the Files tab and click utils.py to land on its diagram.
  await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
  await page.click('[data-side-panel-tab="files"]');
  await page.click('[data-file-tree-row="utils.py"]');
  await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
  // Bring the target function into view so it's actually rendered in
  // the recorded video frame (utils.py has ~21 fns -- the seed might
  // otherwise sit off-screen).
  await page.locator(`.react-flow__node-functionDefNode:has-text("${fnName}")`).first()
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);

  // Set the chat context via the vg-* event bus -- bypasses react-flow
  // click interception from nested assignment cards. Event also opens
  // the chat panel; close it so the ThreadView canvas has the full
  // viewport height for fitView.
  await page.evaluate((id) => {
    document.dispatchEvent(new CustomEvent("vg-chat-about-node", {
      detail: { nodeId: id },
    }));
  }, fnNodeId);
  await page.getByTitle("Close chat").first().click();
  await page.getByRole("button", { name: "Thread", exact: true }).click();
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 15_000 });
}

async function saveVideo(
  page: import("@playwright/test").Page,
  target: string,
): Promise<void> {
  const video = page.video();
  if (!video) throw new Error("No video attached to page");
  await page.close();
  const src = await video.path();
  fs.copyFileSync(src, path.join(OUT_DIR, target));
}

test.describe("big_demo seed videos", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");
  test.skip(!IS_BIG, "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

  test("login_user thread renders without errors", async ({ page }) => {
    await seedThread(page, "login_user", "module/login_user.fn");
    // ~3.5s hold so the force-layout settle is visible end-to-end.
    await page.waitForTimeout(3500);
    await saveVideo(page, "login_user.webm");
  });

  test("logout_user thread renders without errors", async ({ page }) => {
    await seedThread(page, "logout_user", "module/logout_user.fn");
    await page.waitForTimeout(3500);
    await saveVideo(page, "logout_user.webm");
  });
});
