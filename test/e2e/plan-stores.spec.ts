/**
 * Stores and zones on the painted map (2026-10-01, plan-architecture brief
 * Modules 1–2). In the Plan view the shared store is a group box with its
 * zones as cards INSIDE it, and a boundary that names a zone ends on that
 * zone's card, not on the store.
 *
 *   VG_FIXTURE=test/fixtures/plan/store_demo VG_PORT=4265 PORT=4265 \
 *     npx playwright test test/e2e/plan-stores.spec.ts --workers=1
 */
import { test, expect, type Page } from "@playwright/test";

const IS_DEMO = (process.env.VG_FIXTURE ?? "").includes("store_demo");

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

const inside = (inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }) =>
  inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;

test.describe("stores and zones on the map", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/plan/store_demo");

  test("Plan view: the store is a box, its zones are cards inside it, with their verdicts", async ({ page }) => {
    await openMap(page);
    await page.locator('[data-plan-view="plan"]').click();
    const group = page.locator('[data-arch-group="plan:storegroup:docs"]');
    await expect(group).toBeVisible({ timeout: 10_000 });
    await expect(group).toHaveAttribute("data-arch-group-kind", "store");
    const box = (await group.boundingBox())!;
    for (const z of ["requests", "verdicts", "archive"]) {
      const card = page.locator(`[data-arch-id="plan:zone:docs/${z}"]`);
      await expect(card).toBeVisible();
      expect(inside((await card.boundingBox())!, box), `zone ${z} drawn inside the store box`).toBe(true);
    }
    await expect(page.locator('[data-arch-id="plan:zone:docs/archive"]')).toContainText("not-built");
    await expect(page.locator('[data-arch-id="plan:zone:docs/requests"]')).toContainText("realised");
    await expect(page.locator('[data-arch-id="plan:zone:docs/verdicts"]')).toContainText("writers svc-decider");
    await expect(page.locator('[data-arch-id="plan:decider"]')).toContainText("runs as svc-decider");
  });

  test("Plan view: the two processes that meet only in the store are joined by dashed edges labelled by the family", async ({ page }) => {
    await openMap(page);
    await page.locator('[data-plan-view="plan"]').click();
    // A → B via requests, B → A via verdicts: the request → decision → verdict loop.
    await expect(page.getByRole("group", { name: /^Requester to Decider: via docs\/requests · request/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("group", { name: /^Decider to Requester: via docs\/verdicts · verdict/ })).toBeVisible();
  });

  test("Plan panel: the write matrix — who may write each zone, and who does", async ({ page }) => {
    await openMap(page);
    await page.click("[data-plan-toggle]");
    const m = page.locator("[data-plan-write-matrix]");
    await expect(m).toBeVisible({ timeout: 15_000 });
    await expect(m.locator('[data-write-cell="svc-decider|docs/verdicts"]')).toHaveAttribute("data-state", "writes");
    await expect(m.locator('[data-write-cell="svc-requester|docs/requests"]')).toHaveAttribute("data-state", "writes");
    await expect(m.locator('[data-write-cell="svc-requester|docs/verdicts"]')).toHaveAttribute("data-state", "none");
    await expect(page.locator('[data-plan-item="principals:auditor"]')).toBeVisible();
    // Module 8: an assumption's standing, from its recorded evidence.
    await expect(page.locator('[data-plan-question-state="refuted"]')).toHaveCount(1);
    await expect(page.locator('[data-plan-question-state="unverified"]')).toHaveCount(1);
  });
});
