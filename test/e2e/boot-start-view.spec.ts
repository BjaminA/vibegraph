/**
 * Boot screen + first view (2026-09-24).
 *
 * The page shell paints the boot screen (src/shared/boot_markup.ts) beside
 * #root, so it is on screen before the bundle loads; the webview removes it
 * when the first parse lands. A tab that connects during the boot pass
 * waits for the finished envelope (server.ts sendParse), so the first view
 * is never a half-derived one. With VG_START_VIEW unset (the user default:
 * "architecture") a project with a derived architecture opens on the
 * System view's map, Overview lens.
 *
 * Boot:
 *   VG_START_VIEW=architecture VG_FIXTURE=test/fixtures/webstack/next_demo \
 *     VG_PORT=4337 PORT=4337 \
 *     npx playwright test test/e2e/boot-start-view.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("next_demo") || process.env.VG_START_VIEW !== "architecture",
  "Requires VG_START_VIEW=architecture and VG_FIXTURE=test/fixtures/webstack/next_demo");

const REVIEW_DIR = join(process.cwd(), "reviews", "boot");

test("the shell paints the boot screen; the app dismisses it onto the architecture overview", async ({ page, request }) => {
  // The shell, before any script runs: boot markup outside #root, and the
  // server's choice of first view.
  const html = await (await request.get("/")).text();
  expect(html).toContain("data-boot-screen");
  expect(html).toContain('<meta name="vg-start-view" content="architecture">');
  expect(html.indexOf("data-boot-screen")).toBeLessThan(html.indexOf('<div id="root">'));

  // A page that never runs the bundle keeps showing it (the static paint).
  await page.route("**/webview.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.goto("/");
  await expect(page.locator("[data-boot-screen]")).toBeVisible();
  await expect(page.locator("[data-boot-screen] .vg-boot-pulse")).toHaveCount(4);
  mkdirSync(REVIEW_DIR, { recursive: true });
  await page.screenshot({ path: join(REVIEW_DIR, "boot-screen.png") });
  await page.unroute("**/webview.js");

  // The real app: the screen goes once the parse lands, and the first view
  // is the map on the Overview lens.
  await page.goto("/");
  await expect(page.locator("[data-boot-screen]")).toHaveCount(0, { timeout: 30_000 });
  // It FADES: mid-fade the screen is see-through, not opaque until removal
  // (the entry animation's fill once held it at opacity 1).
  await page.goto("/");
  await page.waitForFunction(() => document.querySelector(".vg-boot-out"), null, { timeout: 30_000, polling: 16 });
  const mid = await page.evaluate(() => new Promise<number>((r) => setTimeout(() => {
    const el = document.querySelector(".vg-boot-out");
    r(el ? parseFloat(getComputedStyle(el).opacity) : 0);
  }, 150)));
  expect(mid).toBeLessThan(0.9);
  await expect(page.locator("[data-boot-screen]")).toHaveCount(0);
  await expect(page.locator('[data-system-view][data-system-mode="map"]')).toBeVisible();
  await expect(page.locator('[data-arch-lens="overview"][data-active="true"]')).toBeVisible();
  await expect(page.locator("[data-arch-node]").first()).toBeVisible();
  await page.screenshot({ path: join(REVIEW_DIR, "first-view.png") });
});
