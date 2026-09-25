/**
 * M-ZOOM (PLAN-M-V5FORKS.md, PLAN-v5 §5.2) — thread and system are one
 * continuum, not two views.
 *
 * M-NA7 already gave each zoom band inside a thread its own rendering
 * contract (full / compact / overview — `src/webview/threads/lod.ts`,
 * whose header cites this very fork). What was missing was the band that
 * LEAVES the thread: keep zooming out and the system plane should arrive,
 * with the thread you came from still marked, and zooming back in should
 * descend into it.
 *
 * The honesty half: a view change is not a rendering change, so it is
 * announced at the overview tier BEFORE it happens, and it fires on
 * CROSSING rather than while you sit at the bottom of the range.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/polyglot/shop_demo VG_PORT=4304 PORT=4304 \
 *     npx playwright test test/e2e/m-zoom.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_POLYGLOT = FIXTURE.includes("shop_demo");

/**
 * Zoom out one step, up to `max` times, stopping as soon as `done()` is
 * true. Counting clicks instead would be flaky: the starting zoom is
 * whatever fitView chose for THIS thread on THIS viewport, so a fixed
 * count lands in a different band run to run.
 *
 * Two react-flow behaviours this has to survive: the control DISABLES at
 * minZoom (and Playwright waits out the whole test budget on a disabled
 * button rather than failing), and it goes away entirely when the last
 * band swaps the thread canvas for the system plane.
 */
async function zoomOutUntil(
  page: import("@playwright/test").Page,
  done: () => Promise<boolean>,
  max = 24,
): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    if (await done()) return true;
    const btn = page.locator(".react-flow__controls-zoomout");
    if (!(await btn.isVisible().catch(() => false))) break;
    if (await btn.isDisabled().catch(() => true)) break;
    await btn.click({ timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(120);
  }
  return done();
}

test.describe("M-ZOOM — zooming out of a thread arrives at the system plane", () => {
  test.skip(!IS_POLYGLOT, "Requires the polyglot shop_demo fixture");

  test("the last band leaves the thread, and the plane opens where you left", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 20_000 });

    const row = page.getByRole("button", { name: "create_order", exact: true }).first();
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await row.click();
    await page.waitForTimeout(800);

    // The thread canvas is up.
    await expect(page.locator(".vg-thread-node").first()).toBeVisible({ timeout: 10_000 });

    // The next band is ANNOUNCED before it is crossed - the transition is
    // asked for knowingly, not sprung on the reader.
    const hint = page.locator("[data-zoom-hint]");
    const sawHint = await zoomOutUntil(page, () => hint.isVisible().catch(() => false));
    expect(sawHint, "the overview tier names the next band before it arrives").toBe(true);
    await expect(hint).toContainText("system view");

    // Keep going: the system plane arrives, in THREAD mode, with the
    // thread we came from marked.
    const focused = page.locator('[data-thread-focused="true"]');
    const arrived = await zoomOutUntil(page, () => focused.isVisible().catch(() => false));
    expect(arrived, "zooming out past the last band leaves the thread").toBe(true);
    await expect(page.locator("[data-system-view]")).toBeVisible();
    await expect(focused).toHaveAttribute("data-entry-point-id", "api/app.py:create_order");
  });
});
