/**
 * M8.3.4 — thread-index workflow video.
 *
 * PLAN-v2.md M8.3 done definition: "Playwright video (first-boot →
 * click entry point → toggle file tree → diagram) committed to
 * reviews/m8-thread-index/".
 *
 * Captures one ~6-second .webm:
 *   1. Boot lands on the thread index launchpad
 *   2. Click an entry point row → thread view renders
 *   3. Switch the side panel to the Files tab
 *   4. Click a file → diagram view loads
 *
 * Gated by VG_CAPTURE=1. Run:
 *   VG_CAPTURE=1 VG_FIXTURE=test/fixtures/threads/flask_demo \
 *     PORT=4203 VG_PORT=4203 \
 *     npx playwright test test/e2e/m8-capture.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "m8-thread-index");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.use({
  video: { mode: "on", size: { width: 1280, height: 800 } },
});

test.describe("M8.3 — thread index workflow video", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("first-boot → entry point → file tree → diagram", async ({ page }) => {
    await page.goto("/");

    // Step 1: index launchpad. Settle the row reveal so the user can
    // see the route / cli / test / public_api / manual groups.
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.waitForTimeout(900);

    // Step 2: click cli:main from the index — its compute-style thread
    // is small enough to render cleanly in the captured frame.
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    // Hold so the force-layout settle + fitView is visible end-to-end.
    await page.waitForTimeout(2500);

    // Step 3: switch side panel to the Files tab.
    await page.click('[data-side-panel-tab="files"]');
    await page.waitForTimeout(500);

    // Step 4: click models.py → diagram view loads.
    await page.click('[data-file-tree-row="models.py"]');
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
    await page.waitForTimeout(1500);

    const video = page.video();
    if (!video) throw new Error("No video attached to page");
    await page.close();
    const src = await video.path();
    fs.copyFileSync(src, path.join(OUT_DIR, "first-boot-to-diagram.webm"));
  });
});
