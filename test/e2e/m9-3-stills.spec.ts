/**
 * M9.3 — depth-cue stills.
 *
 * Captures the three primitives in action on flask_demo:
 *   - cli-thread.png — full cli:main thread showing per-file wash
 *     (cli teal, models hue-1, db hue-2) + diagonal offset stepping
 *     down-and-right by depth.
 *   - route-POST.png — POST route thread shows the same per-file
 *     wash + cross-depth edges hitting db.
 *   - test-thread.png — pytest seed shows the test_flow file at
 *     hue-0 and the cross-file hops into models / db.
 *
 * Capture-only (VG_CAPTURE=1) so a normal `npm test` doesn't dump
 * PNGs into reviews/.
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "m9-depth");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("M9.3 depth-cue stills", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  async function captureEntry(
    page: import("@playwright/test").Page,
    entryId: string,
    file: string,
  ) {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click(`[data-thread-index-row][data-entry-id="${entryId}"]`);
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1700);
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: false });
  }

  test("M9.3 stills (cli + POST + test)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await captureEntry(page, "cli.py:main",                        "cli-thread.png");
    await captureEntry(page, "app.py:create_user_route",           "route-POST.png");
    await captureEntry(page, "test_flow.py:test_create_then_find", "test-thread.png");
  });
});
