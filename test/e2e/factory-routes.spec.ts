/**
 * Factory-route discovery, living-renderer proof (NEXT-ACTIONS §2).
 *
 * flask_factory_demo has ZERO module-level decorated routes — handlers
 * live inside create_app() (decorators + add_url_rule) and on a
 * Blueprint. The thread index must list them as route entries, a
 * nested handler's thread must open, and the System card must read
 * "Flask backend" (framework recovered from route entry points), not
 * the generic "Backend" collapse.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_factory_demo VG_PORT=4246 PORT=4246 \
 *     npx playwright test test/e2e/factory-routes.spec.ts --reporter=list
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FACTORY = FIXTURE.includes("flask_factory_demo");

test.describe("factory-route discovery", () => {
  test.skip(!IS_FACTORY, "Requires VG_FIXTURE=test/fixtures/threads/flask_factory_demo");

  test("nested + add_url_rule + blueprint handlers appear as route rows", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    const routeRows = page.locator('[data-thread-index-row][data-entry-kind="route"]');
    await expect(routeRows).toHaveCount(4);
    for (const label of ["list_users", "create_user", "health", "list_orders"]) {
      await expect(
        routeRows.filter({ hasText: label }),
        `route row for ${label} missing`,
      ).toHaveCount(1);
    }
  });

  test("a factory-nested handler's thread opens and reaches the db layer", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    await page.locator('[data-thread-index-row][data-entry-id="app.py:list_users"]').click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    // The thread traces list_users -> query (db.py) — more than a lone seed.
    expect(await page.locator(".vg-thread-node").count()).toBeGreaterThan(1);
    await expect(page.locator(".vg-thread-node", { hasText: "query" }).first()).toBeVisible();
  });

  test("System card reads 'Flask backend', not the generic 'Backend' collapse", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.getByRole("button", { name: "System" }).click();
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 10_000 });

    const backend = page.locator('[data-subsystem-node][data-subsystem-kind="backend"]').first();
    await expect(backend).toContainText("Flask backend");
  });
});
