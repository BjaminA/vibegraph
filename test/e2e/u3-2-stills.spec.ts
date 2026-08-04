/**
 * U3.2 — colour-coding stills across every flask_demo entry point.
 *
 * One screenshot per thread, so a future tweak to colour_for_node.ts
 * shows up in a visual diff. Filed under reviews/ui-u3-2/.
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "ui-u3-2");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("U3.2 colour stills", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("colour stills for every flask_demo entry point", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entries = [
      { id: "cli.py:main",                             name: "cli-main" },
      { id: "app.py:create_user_route",                name: "route-create_user" },
      { id: "app.py:get_user_route",                   name: "route-get_user" },
      { id: "app.py:list_users_route",                 name: "route-list_users" },
      { id: "test_flow.py:test_create_then_find",      name: "test-create_then_find" },
      { id: "test_flow.py:test_list_returns_users",    name: "test-list_returns_users" },
    ];

    // ThreadIndex unmounts when a thread opens; reload between captures
    // to get a fresh launchpad each time.
    for (const e of entries) {
      await page.goto("/");
      await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
      const row = page.locator(`[data-thread-index-row][data-entry-id="${e.id}"]`);
      if ((await row.count()) === 0) {
        console.warn(`Skipping ${e.id} — row not found`);
        continue;
      }
      await row.click();
      await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
      // Move mouse off-canvas so we don't open a stray tooltip.
      await page.mouse.move(0, 0);
      await page.waitForTimeout(1600);
      await page.screenshot({ path: path.join(OUT_DIR, `${e.name}.png`), fullPage: false });
    }
  });
});
