/**
 * M9.4 — external-effects panel stills.
 *
 * Three captures on flask_demo:
 *   - cli-list.png — list mode, full Family-2 rows for cli:main
 *   - route-list.png — POST route handler thread, panel shows DB
 *     writes + I/O sinks
 *   - edit-context.png — pinned tooltip on cli:main → panel swaps
 *     to file-source split-view scrolled to main()
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "m9-effects");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("M9.4 effects-panel stills", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  async function openThread(page: import("@playwright/test").Page, entryId: string) {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click(`[data-thread-index-row][data-entry-id="${entryId}"]`);
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1700);
  }

  test("list mode (cli + route)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openThread(page, "cli.py:main");
    await page.screenshot({ path: path.join(OUT_DIR, "cli-list.png"), fullPage: false });
    await openThread(page, "app.py:create_user_route");
    await page.screenshot({ path: path.join(OUT_DIR, "route-list.png"), fullPage: false });
  });

  test("edit context (pinned tooltip on cli:main)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openThread(page, "cli.py:main");
    await page.click('.react-flow__node[data-id="cli:main"]');
    await page.waitForSelector('[data-effects-panel][data-mode="edit"]', { timeout: 5_000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT_DIR, "edit-context.png"), fullPage: false });
  });
});
