/**
 * System views (2026-10-06, field brief PROMPT-system-views): the map opens on
 * the project; Real speaks the plan's and the topology's words (the store by
 * its plan name and size, the outside caller, identities as badges, the
 * decision structures); the Overlay draws nothing twice; every mode has fewer
 * boxes as you zoom out; a mode switch keeps the zoom; a flow lights its path.
 *
 *   VG_FIXTURE=test/fixtures/system/views_demo VG_PORT=4311 PORT=4311 VG_START_VIEW=architecture \
 *     npx playwright test test/e2e/system-views.spec.ts --workers=1
 */
import { test, expect, type Page } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const cards = (page: Page) => page.locator("[data-arch-node]");

async function openMap(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-top-toolbar]", { timeout: 30_000 });
  const banner = page.locator("[data-key-banner]");
  if (await banner.count()) await banner.locator("button").click();
  // No thread is selected: the first view is the project's map.
  await expect(page.locator('[data-system-view][data-system-mode="map"]')).toBeVisible({ timeout: 30_000 });
  await expect(cards(page).first()).toBeVisible({ timeout: 15_000 });
}
async function at(page: Page, view: "real" | "plan" | "overlay", lens: string): Promise<number> {
  await page.locator(`[data-plan-view="${view}"]`).click();
  await page.locator(`[data-arch-lens="${lens}"]`).click();
  await page.waitForTimeout(800);
  return cards(page).count();
}
const zoomOf = (page: Page) => page.locator(".react-flow__viewport").evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);

test.describe("system views", () => {
  test.skip(!FIXTURE.includes("views_demo"), "Requires VG_FIXTURE=test/fixtures/system/views_demo");
  test.use({ viewport: { width: 1600, height: 1000 } });

  test("opens on the project's map with no thread selected", async ({ page }) => {
    await openMap(page);
    expect(await cards(page).count()).toBeGreaterThan(3);
    // Subsystems remembered on a project with no subsystem tier still draws the map.
    await page.evaluate(() => localStorage.setItem("vg-system-mode", "subsystems"));
    await page.reload();
    await page.waitForSelector("[data-top-toolbar]", { timeout: 30_000 });
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  });

  test("Real Bird's-eye: at most 14 boxes, the store by its plan name and size, the outside caller, identities, the decision structures", async ({ page }) => {
    await openMap(page);
    const n = await at(page, "real", "birdseye");
    expect(n).toBeLessThanOrEqual(14);
    const store = page.locator('[data-arch-id="store:ledger"]');
    await expect(store).toContainText("order ledger");
    await expect(store).toContainText("7 zones");
    await expect(page.locator('[data-arch-kind="actor"]', { hasText: "partner system" })).toBeVisible();
    for (const id of ["decision:sm:order-phase", "decision:dt:release"]) await expect(page.locator(`[data-arch-id="${id}"]`)).toBeVisible();
    await expect(page.locator('[data-arch-badge="admin"]').first()).toBeVisible();
    await expect(page.locator('[data-arch-badge="decider"]').first()).toBeVisible();
    await expect(page.locator("[data-arch-id^='zone:']")).toHaveCount(0); // zones fold into the store here
  });

  test("Overlay: Real's boxes plus one 'planned, not built' chip; no zone twice at any level", async ({ page }) => {
    await openMap(page);
    const real = await at(page, "real", "birdseye");
    const over = await at(page, "overlay", "birdseye");
    expect(over).toBeLessThanOrEqual(real + 1);
    await expect(page.locator('[data-arch-id="plan:not-built"]')).toContainText("2 planned, not built");
    for (const lens of ["birdseye", "overview", "payloads"]) {
      await at(page, "overlay", lens);
      const ids = await page.locator("[data-arch-id*='zone:']").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.archId!));
      const keys = ids.map((id) => id.replace(/^plan:/, "").replace(/^zone:/, ""));
      expect(new Set(keys).size, `${lens}: ${ids.join(", ")}`).toBe(keys.length);
      expect(ids.filter((id) => id.startsWith("plan:")), lens).toEqual([]);
    }
  });

  test("every mode: detail ≥ overview ≥ Bird's-eye, Bird's-eye strictly fewer than detail", async ({ page }) => {
    await openMap(page);
    for (const view of ["real", "plan", "overlay"] as const) {
      const d = await at(page, view, "payloads");
      const o = await at(page, view, "overview");
      const b = await at(page, view, "birdseye");
      expect(d, `${view} detail ${d} ≥ overview ${o}`).toBeGreaterThanOrEqual(o);
      expect(o, `${view} overview ${o} ≥ bird's-eye ${b}`).toBeGreaterThanOrEqual(b);
      expect(b, `${view} bird's-eye ${b} < detail ${d}`).toBeLessThan(d);
    }
  });

  test("a mode switch keeps the zoom; a flow lights its path", async ({ page }) => {
    await openMap(page);
    await at(page, "real", "overview");
    await page.locator(".react-flow__controls-zoomin").click();
    await page.locator(".react-flow__controls-zoomin").click();
    await page.waitForTimeout(400);
    const z = await zoomOf(page);
    await page.locator('[data-plan-view="overlay"]').click();
    await page.waitForTimeout(800);
    expect(Math.abs((await zoomOf(page)) - z)).toBeLessThan(0.01);
    await page.locator('[data-plan-view="real"]').click();
    await page.locator("[data-arch-flows-toggle]").click();
    await page.locator('[data-arch-flow="order-request"]').click();
    for (const label of ["clerk app", "order decider", "partner gateway"]) {
      await expect(page.locator("[data-arch-node]", { hasText: label }).first()).not.toHaveAttribute("data-arch-dim", "true");
    }
    await expect(page.locator('[data-arch-id="decision:dt:release"]')).toHaveAttribute("data-arch-dim", "true");
  });

  test("in → process → out: the inspector's three bands, a row lights its path, payload chips on edges, words on cards at Detail", async ({ page }) => {
    await openMap(page);
    await at(page, "real", "overview");
    await expect(page.locator("[data-arch-io-word]")).toHaveCount(0); // words on cards only at Detail
    await page.locator("[data-arch-node]", { hasText: "order decider" }).first().click({ force: true });
    const card = page.locator("[data-node-io]");
    for (const b of ["in", "process", "out"]) await expect(card.locator(`[data-io-band="${b}"]`)).toBeVisible();
    const approver = card.locator('[data-io-row="in"]', { hasText: "the appointed approver" });
    await expect(approver).toContainText("read");
    await expect(approver.locator("[data-io-path]")).toContainText("admin appointer");
    const status = card.locator('[data-io-row="out"]', { hasText: "order status" });
    await expect(status.locator('[data-chip="json"]')).toHaveText("phase");
    await expect(status.locator("[data-io-path]")).toContainText("partner gateway");
    for (const w of ["read", "write", "decide"]) await expect(card.locator(`[data-io-word="${w}"]`)).toBeVisible();
    await card.locator('[data-io-word="decide"]').click();
    await expect(card.locator('[data-io-evidence="decide"]')).toContainText("order-phase");
    // a row lights its path: the decider, the zone and the next reader stay lit
    await status.click();
    await expect(page.locator('[data-arch-id="decision:dt:release"]')).toHaveAttribute("data-arch-dim", "true");
    await expect(page.locator("[data-arch-node]", { hasText: "partner gateway" }).first()).not.toHaveAttribute("data-arch-dim", "true");
    await page.locator("[data-arch-inspector-close]").click();
    await expect(page.locator('[data-arch-dim="true"]')).toHaveCount(0);
    await at(page, "real", "payloads");
    expect(await page.locator("[data-arch-edge-chips]").count()).toBeGreaterThan(0);
    await expect(page.locator('[data-edge-chip="op"]').first()).toBeVisible();
    expect(await page.locator("[data-arch-io-word]").count()).toBeGreaterThan(5);
  });
});
