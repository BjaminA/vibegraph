/**
 * M17.3-polish — visual review capture of the revised insert() thread.
 *
 * One-shot capture spec. Opens the flask_demo `insert` Public API entry
 * directly so the layout is small and isolated (no main → cmd_create →
 * create_user transitions cluttering the screenshot). Saves a still to
 * reviews/m17-control-flow-containers/insert-vertical.png.
 *
 * Run:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m17-3-polish-screenshot.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("M17.3-polish — insert thread visual review", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("capture insert thread with vertical source-order layout", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // Open the `insert` Public API entry directly — short thread, makes
    // the vertical execution-order layout legible without scrolling.
    await page.click('[data-thread-index-row][data-entry-id="db.py:insert"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });

    // Settle: ResizeObserver → layout → fitView animation → d3-force
    // settle. 1s is comfortable headroom.
    await page.waitForTimeout(1200);

    // Sanity: containers present, no JS errors.
    await expect(page.locator(".vg-thread-container-try").first()).toBeVisible();
    await expect(page.locator(".vg-thread-container-finally").first()).toBeVisible();
    expect(pageErrors).toEqual([]);

    const reviewDir = join(process.cwd(), "reviews", "m17-control-flow-containers");
    mkdirSync(reviewDir, { recursive: true });
    await page.screenshot({
      path: join(reviewDir, "insert-vertical.png"),
      fullPage: false,
    });
  });
});
