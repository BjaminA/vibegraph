/**
 * U3.2 revised — capture the three-family palette in action.
 * Two stills filed to reviews/ui-feedback/.
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "ui-feedback");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("U3.2 revised palette stills", () => {
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

  test("revised palette stills (cli + test)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await captureEntry(page, "cli.py:main", "U3.2-revised-cli.png");
    await captureEntry(page, "test_flow.py:test_create_then_find", "U3.2-revised-test.png");
  });
});
