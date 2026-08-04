/**
 * U5 — semantic-icon stills.
 *
 * Captures cli + POST route + GET route + test entry to show:
 *   - icons mapped per kindLabel (Terminal, Globe, FlaskConical,
 *     Plus, Database, Settings, Printer, Plug, …)
 *   - HTTP method pills on route handlers
 *   - cross-file halo on steps from other files
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "ui-u5");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("U5 icon stills", () => {
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

  test("U5 stills (cli + POST + GET + test)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await captureEntry(page, "cli.py:main",                           "cli-main.png");
    await captureEntry(page, "app.py:create_user_route",              "route-POST-create_user.png");
    await captureEntry(page, "app.py:get_user_route",                 "route-GET-get_user.png");
    await captureEntry(page, "test_flow.py:test_create_then_find",    "test-create_then_find.png");
  });
});
