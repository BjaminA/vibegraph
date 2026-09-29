/**
 * Navigation hops + the Journeys lens (2026-09-29) on
 * test/fixtures/journeys/journeys_demo — five Next App Router pages linked by
 * `<Link href>`, `router.push` and `redirect` literals:
 *
 *   map      the Journeys lens draws the five pages and the five links
 *            between them (the unmatched `/archive` is counted on its page);
 *   tooltip  a Link on the home page's thread says where it goes, and the
 *            target button opens that page's thread.
 *
 *   npm run test:e2e-journeys
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const REVIEW_DIR = join(process.cwd(), "reviews", "journeys");

async function boot(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
  const banner = page.locator("[data-key-banner]");
  if (await banner.count() > 0) await banner.locator("button").click();
}

test.describe("journeys", () => {
  test.skip(!FIXTURE.includes("journeys/journeys_demo"), "Requires VG_FIXTURE=test/fixtures/journeys/journeys_demo");
  test.beforeAll(() => mkdirSync(REVIEW_DIR, { recursive: true }));

  test("the Journeys lens draws the pages and the links between them", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.removeItem("vg-system-mode"); localStorage.removeItem("vg-arch-lens"); } catch { /* */ } });
    await boot(page);
    await page.getByRole("button", { name: "System" }).click();
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 10_000 });
    await page.locator("[data-system-arch-toggle]").click();
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "map");
    await page.locator('[data-arch-lens="journeys"]').click();
    await expect(page.locator('[data-arch-lens="journeys"]')).toHaveAttribute("data-active", "true");
    await expect(page.locator('[data-arch-id="page:app/page.tsx:HomePage"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-arch-id^="page:"]')).toHaveCount(5);
    await expect(page.locator('[data-arch-id="page:app/orders/page.tsx:OrdersPage"]')).toContainText("1 link to no page");
    await expect(page.locator(".react-flow__edge")).toHaveCount(5);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(REVIEW_DIR, "journeys-lens.png") });
  });

  test("a Link's tooltip names the page it goes to and opens its thread", async ({ page }) => {
    await boot(page);
    await page.click('[data-thread-index-row][data-entry-id="app/page.tsx:HomePage"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);
    // The /orders link: find the Link card whose tooltip names /orders.
    const links = page.locator(".vg-thread-node", { hasText: "Link" });
    const n = await links.count();
    expect(n).toBeGreaterThan(0);
    let found = false;
    for (let i = 0; i < n && !found; i++) {
      await links.nth(i).click({ force: true });
      const nav = page.locator('[data-crossing][data-crossing-path="/orders"]');
      if (await nav.count()) {
        await expect(nav).toContainText("Navigates to: /orders");
        await nav.locator('[data-crossing-target="app/orders/page.tsx:OrdersPage"]').click();
        found = true;
      } else {
        await page.keyboard.press("Escape");
      }
    }
    expect(found, "a Link card carries the /orders navigation").toBe(true);
    await expect(page.locator("[data-thread-view]")).toHaveAttribute("data-seed-id", /OrdersPage/, { timeout: 10_000 });
  });
});
