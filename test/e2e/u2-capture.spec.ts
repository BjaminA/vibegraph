/**
 * U2 — thread-edge visual capture.
 *
 * Records a ~6s clip showing the U2 edge language end-to-end:
 *   1. flask_demo boots, ThreadIndex shows.
 *   2. Open cli:main — cross-file thread reaches into models.py and db.py.
 *   3. Let the glow + pulse breathe for a beat (neuron-network feel).
 *   4. Hover the seed — siblings dim (Obsidian binary-attention).
 *   5. Hover a non-seed node — focus shifts.
 *
 * Gated by VG_CAPTURE=1. Run:
 *   VG_CAPTURE=1 VG_FIXTURE=test/fixtures/threads/flask_demo \
 *     npx playwright test test/e2e/u2-capture.spec.ts
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "ui-u2");
fs.mkdirSync(OUT_DIR, { recursive: true });

test.use({
  video: {
    mode: "on",
    size: { width: 1280, height: 800 },
  },
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

test.describe("U2 thread-edges capture", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("cli:main thread — glow, cross-file dash, dim-non-focus", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.waitForTimeout(500);

    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    // Let d3-force settle + fitView + pulse run a couple of cycles
    // (1600ms each) so the breathing glow is on camera.
    await page.waitForTimeout(2400);

    // Hover the seed — siblings drop to --attention-fade-opacity.
    const seed = page.locator(".vg-thread-node-seed").first();
    await seed.hover();
    await page.waitForTimeout(900);

    // Shift hover to a non-seed node so the focus changes on-screen.
    const other = page.locator(".vg-thread-node:not(.vg-thread-node-seed)").first();
    await other.hover();
    await page.waitForTimeout(900);

    await saveVideo(page, "u2-thread-edges.webm");
  });
});
