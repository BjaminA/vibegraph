/**
 * The declared topology on the painted map (2026-10-02, topology brief
 * Modules 2, 4, 5, 6): the Resources lens draws the store as a box of zones
 * with principals and their grants (and the live drift), the Decisions lens
 * the verdict tree linked to its evidence, and the trace overlay steps through
 * a saved run, lighting each event's actor and zone and naming the write the
 * declaration does not grant.
 *
 *   VG_FIXTURE=test/fixtures/topology/topo_demo VG_PORT=4266 PORT=4266 \
 *     npx playwright test test/e2e/topology.spec.ts --workers=1
 */
import { test, expect, type Page } from "@playwright/test";

const IS_DEMO = (process.env.VG_FIXTURE ?? "").includes("topo_demo");

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
  await expect(page.locator('[data-arch-lens="resources"]')).toBeVisible({ timeout: 15_000 });
}

test.describe("the declared topology on the map", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/topology/topo_demo");

  test("Resources: the store is a box of zones, principals with grants, the live drift drawn", async ({ page }) => {
    await openMap(page);
    await page.locator('[data-arch-lens="resources"]').click();
    const box = page.locator('[data-arch-group="topo:store:docs"]');
    await expect(box).toBeVisible({ timeout: 10_000 });
    for (const z of ["requests", "verdicts", "evidence", "scratch"]) await expect(page.locator(`[data-arch-id="topo:zone:${z}"]`)).toBeVisible();
    await expect(page.locator('[data-arch-id="topo:zone:verdicts"]')).toContainText("writers svc-decider");
    await expect(page.locator('[data-arch-id="topo:zone:scratch"]')).toContainText("ON THE PLATFORM, NOT DECLARED");
    await expect(page.getByRole("group", { name: /^svc-decider to verdicts: write/ })).toBeVisible();
    await expect(page.getByRole("group", { name: /^svc-intake to verdicts: write · on the platform, NOT declared/ })).toBeVisible();
  });

  test("Decisions: the verdict tree with yes / no branches, each node's evidence and its zone's writers", async ({ page }) => {
    await openMap(page);
    await page.locator('[data-arch-lens="decisions"]').click();
    await expect(page.locator('[data-arch-group="topo:tree:verdict"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-arch-id="topo:dt:verdict:readings-ok"]')).toBeVisible();
    await expect(page.getByRole("group", { name: /^has-inspection to readings-ok: yes/ })).toBeVisible();
    await expect(page.getByRole("group", { name: /^readings-ok to reading: reads/ })).toBeVisible();
    await expect(page.locator('[data-arch-id="topo:zone:evidence"]')).toContainText("writers inspector");
    await expect(page.locator('[data-arch-group="topo:machine:request"]')).toBeVisible();
  });

  test("the trace overlay: stepping lights the event's actor and zone, and names the write no grant allows", async ({ page }) => {
    await openMap(page);
    await page.locator('[data-arch-lens="resources"]').click();
    const bar = page.locator("[data-topology-trace]");
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await bar.locator("select").selectOption("run");
    await expect(bar.locator("[data-topology-trace-step]")).toHaveAttribute("data-topology-trace-step", "1");
    await expect(page.locator('[data-arch-id="topo:zone:requests"]')).not.toHaveAttribute("data-arch-dim", "true");
    await expect(page.locator('[data-arch-id="topo:zone:evidence"]')).toHaveAttribute("data-arch-dim", "true");
    for (let i = 0; i < 7; i++) await bar.getByRole("button", { name: "next event" }).click();
    await expect(bar.locator("[data-topology-trace-step]")).toContainText("8/8 · svc-intake write verdicts — svc-intake has no declared write grant on verdicts");
    await expect(page.locator('[data-arch-id="topo:zone:verdicts"]')).not.toHaveAttribute("data-arch-dim", "true");
  });
});
