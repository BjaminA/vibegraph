/**
 * U3.3 — capture the edge-label feature in action.
 * Filed under reviews/ui-u3-3/.
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "ui-u3-3");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("U3.3 edge-label stills", () => {
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

  test("U3.3 stills (cli + route + test)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await captureEntry(page, "cli.py:main", "cli-main.png");
    await captureEntry(page, "app.py:create_user_route", "route-create_user.png");
    await captureEntry(page, "test_flow.py:test_create_then_find", "test-create_then_find.png");
  });
});
