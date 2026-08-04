/**
 * U4 — top-down layout capture (video + stills).
 *
 * Records the new BFS-depth layered layout on flask_demo's cli:main
 * thread: seed at top, fan-out by layer, conn.* terminals at the
 * bottom — the eye traces main → cmd_create → create_user → insert →
 * conn.execute as a top-down path.
 *
 *   VG_CAPTURE=1 VG_FIXTURE=test/fixtures/threads/flask_demo \
 *     npx playwright test test/e2e/u4-capture.spec.ts
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "ui-u4");
fs.mkdirSync(OUT_DIR, { recursive: true });

test.use({
  video: { mode: "on", size: { width: 1440, height: 900 } },
});

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

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

test.describe("U4 top-down layout capture", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("cli:main — layered top-down flow", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(OUT_DIR, "rest.png"), fullPage: false });

    // Hover the seed → dim non-focus on the layered layout.
    const seed = page.locator(".vg-thread-node-seed").first();
    await seed.hover();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT_DIR, "hover-seed.png"), fullPage: false });

    // Hover deeper (db:insert is in row 3, mid-canvas) to show focus
    // shifting along the thread.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    const insert = page.locator('.react-flow__node[data-id="db:insert"]').first();
    await insert.hover();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT_DIR, "hover-insert.png"), fullPage: false });

    await saveVideo(page, "u4-top-down-layout.webm");
  });
});
