/**
 * A large declared topology on the painted map (2026-10-05). The fixture has
 * 50 zones, 24 principals, every principal granted READ on every zone (1,200
 * read grants) and 60 write grants. Drawn one edge per grant, the Resources
 * lens laid out for ~0.4 s on every open and panned over 1,260 SVG paths.
 * Now the reads every principal holds are said on the cards, writes are always
 * drawn, a selected card draws its own reads without moving any card, and a
 * layout above the size threshold is computed behind a spinner. Since
 * 2026-10-12 zones FOLD into their groups (five prefixes of ten here): a group
 * is one card saying what all its zones share, its edges one per principal and
 * access, counted; selecting the group opens it.
 *
 *   VG_FIXTURE=test/fixtures/topology/scale_demo VG_PORT=4305 PORT=4305 \
 *     npx playwright test test/e2e/topology-scale.spec.ts --workers=1
 */
import { test, expect, type Page } from "@playwright/test";

const IS_SCALE = (process.env.VG_FIXTURE ?? "").includes("scale_demo");

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

const edgeCount = (page: Page) => page.locator(".react-flow__edge").count();
// 60 write grants, over the cap of 48: the access grid opens first, over the map
async function closeGrid(page: Page) {
  await expect(page.locator("[data-access-grid]")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Close the access grid" }).click();
  await expect(page.locator("[data-access-grid]")).toHaveCount(0);
}
const placeOf = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`).getAttribute("style").then((s) => /transform:[^;]+/.exec(s ?? "")?.[0] ?? "");

test.describe("a large declared topology stays readable and responsive", () => {
  test.skip(!IS_SCALE, "Requires VG_FIXTURE=test/fixtures/topology/scale_demo");

  test("zones fold into groups that say what they share, writes are drawn, opening takes no long task", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__long = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as any).__long.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true });
    });
    await openMap(page);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { (window as any).__long = []; });
    await page.locator('[data-arch-lens="resources"]').click();
    await closeGrid(page);
    await expect(page.locator('[data-arch-group="topo:store:warehouse"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-arch-id^="topo:zg:"]')).toHaveCount(5);
    await expect(page.locator('[data-arch-id^="topo:zone:"]')).toHaveCount(0);
    await expect(page.locator('[data-arch-id^="topo:pr:"]')).toHaveCount(24);
    // 60 write grants, one edge per principal and group; none of the 1,200 universal reads is an edge.
    expect(await edgeCount(page)).toBe(24);
    await expect(page.locator('[data-arch-id="topo:zg:stock_*"]')).toContainText("10 zones");
    await expect(page.locator('[data-arch-id="topo:pr:auditor"]')).toContainText("reads every zone");
    await page.waitForTimeout(500);
    const long: number[] = await page.evaluate(() => (window as any).__long);
    // Before the fold this lens alone cost a ~400 ms layout on the main thread.
    expect(Math.max(0, ...long), `long tasks: ${long.join(", ")}`).toBeLessThan(300);
  });

  test("a selected group opens into its zones; a selected zone draws its reads and no card moves", async ({ page }) => {
    await openMap(page);
    await page.locator('[data-arch-lens="resources"]').click();
    await closeGrid(page);
    await expect(page.locator('[data-arch-id="topo:zg:stock_*"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-arch-id="topo:zg:stock_*"]').click();
    await expect(page.locator('[data-arch-id^="topo:zone:"]')).toHaveCount(10);
    await expect.poll(() => edgeCount(page)).toBe(33);
    await expect(page.locator('[data-arch-id="topo:zone:stock_a01"]')).toContainText("read by all 24");
    await expect(page.locator('[data-arch-id="topo:zone:stock_a01"]')).toContainText("writers inventory-service");
    const watched = ["topo:zone:stock_a02", "topo:pr:picker-a05", "topo:zone:stock_a01"];
    const before = await Promise.all(watched.map((id) => placeOf(page, id)));

    await page.locator('[data-arch-id="topo:zone:stock_a01"]').click();
    await expect.poll(() => edgeCount(page)).toBe(33 + 24); // its 24 reads
    expect(await Promise.all(watched.map((id) => placeOf(page, id)))).toEqual(before);

    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
    await expect(page.locator('[data-arch-id^="topo:zone:"]')).toHaveCount(0);
    await expect.poll(() => edgeCount(page)).toBe(24);
  });

  test("above the size threshold the layout is computed behind a spinner", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__VG_LAYOUT_DEFER_AT = 10; // test-only: defer this small map
      (window as any).__spun = false;
      new MutationObserver(() => { if (document.querySelector("[data-arch-laying-out]")) (window as any).__spun = true; })
        .observe(document, { childList: true, subtree: true });
    });
    await openMap(page);
    await page.locator('[data-arch-lens="resources"]').click();
    await closeGrid(page);
    await expect(page.locator('[data-arch-id="topo:zg:stock_*"]')).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => (window as any).__spun)).toBe(true);
    await expect(page.locator("[data-arch-laying-out]")).toHaveCount(0);
    // The deferred layout is the same map.
    await expect(page.locator('[data-arch-id^="topo:zg:"]')).toHaveCount(5);
    expect(await edgeCount(page)).toBe(24);
  });
});
