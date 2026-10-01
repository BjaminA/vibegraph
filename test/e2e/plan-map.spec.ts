/**
 * The plan's content on the architecture map (2026-10-01). On the painted
 * view: a planned process card opens its threads as step chains coloured by
 * verdict (a missing step struck through); rules and questions sit on what
 * they are about; a boundary reads "· N keys"; in the Overlay a realised
 * process is its REAL box with a "planned ✓" chip, never a second card.
 *
 *   VG_FIXTURE=test/fixtures/plan/map_demo VG_PORT=4264 PORT=4264 \
 *     npx playwright test test/e2e/plan-map.spec.ts --workers=1
 */
import { test, expect, type Page } from "@playwright/test";

const IS_DEMO = (process.env.VG_FIXTURE ?? "").includes("map_demo");

async function openMap(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index], [data-system-view]", { timeout: 20_000 });
  const banner = page.locator("[data-key-banner]");
  if (await banner.count()) await banner.locator("button").click();
  const system = page.locator('[data-toolbar-group="views"]').getByRole("button", { name: "System", exact: true });
  for (let i = 0; i < 8 && !(await page.locator("[data-system-view]").count()); i++) {
    if (i === 0 || (await system.getAttribute("data-active")) !== "true") await system.click();
    await page.waitForTimeout(3000);
  }
  await expect(page.locator("[data-system-view]")).toBeVisible();
  if ((await page.locator("[data-system-view]").getAttribute("data-system-mode")) !== "map") await page.locator("[data-system-arch-toggle]").click();
  await expect(page.locator("[data-plan-view-toggle]")).toBeVisible({ timeout: 10_000 });
}

test.describe("the plan on the map", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/plan/map_demo");

  test("Plan view: threads open on their process with verdicts; rules, questions and keys where they belong", async ({ page }) => {
    await openMap(page);
    await page.locator('[data-plan-view="plan"]').click();
    const api = page.locator('[data-arch-id="plan:api"]');
    await expect(api).toBeVisible({ timeout: 10_000 });
    const chip = api.locator('[data-arch-plan-chip="threads"]');
    await expect(chip).toHaveText("2 threads");
    await expect(api.locator("[data-arch-plan-flows]")).toHaveCount(0);
    await chip.click();
    await expect(api.locator('[data-arch-plan-flow="POST /readings"]')).toHaveAttribute("data-verdict", "realised");
    await expect(api.locator('[data-arch-plan-flow="GET /forecasts"]')).toHaveAttribute("data-verdict", "not-built");

    const fc = page.locator('[data-arch-id="plan:forecaster"]');
    await fc.locator('[data-arch-plan-chip="threads"]').click();
    const drifted = fc.locator('[data-arch-plan-flow="forecast_all"]');
    await expect(drifted).toHaveAttribute("data-verdict", "drifted");
    await expect(drifted.locator('[data-missing="true"]')).toHaveText("publish_forecast");
    await expect(fc.locator('[data-arch-plan-chip="rules"]')).toHaveText("1 rule");
    await expect(page.locator('[data-arch-id="plan:dashboard"] [data-arch-plan-chip="open"]')).toHaveText("1 open");
    // The boundary api → sqlite3 carries three keys and the rule about it.
    await expect(page.getByText("SQL · 3 keys · 1 rule").first()).toBeVisible();
    await expect(page.locator("[data-plan-unplaced]")).toHaveCount(0);
  });

  test("Overlay: a realised process is its real box with a 'planned ✓' chip and its threads; only the unbuilt is a ghost", async ({ page }) => {
    await openMap(page);
    await page.locator('[data-plan-view="overlay"]').click();
    await expect(page.locator('[data-arch-id="plan:dashboard"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-arch-id="plan:api"]')).toHaveCount(0);
    const real = page.locator('[data-arch-source="derived"]').filter({ has: page.locator('[data-arch-plan-chip="planned"]') });
    expect(await real.count()).toBeGreaterThanOrEqual(2);
    await expect(real.locator('[data-arch-plan-chip="planned"]').first()).toHaveText("planned ✓");
    await expect(page.locator('[data-arch-source="derived"] [data-arch-plan-chip="threads"]').first()).toBeVisible();
  });
});
