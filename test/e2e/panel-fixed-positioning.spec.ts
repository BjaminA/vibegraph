/**
 * ViewTransition must not trap its fixed-position children.
 *
 * Reported 2026-08-04 as "clicking Edges on the file view, can't see any
 * visual changes". The toggles worked; the PANEL was off-screen.
 *
 * `.vg-view-enter` animates with `animation: … both`, so the final
 * keyframe's `transform: translateY(0)` persists after the animation ends.
 * Any transform — identity included — makes an element the containing block
 * for `position: fixed` descendants. All three panels wrapped in
 * ViewTransition (ComposePalette, FiltersPanel, AnalysisCard) are
 * position:fixed, so their `top`/`right` resolved against the wrapper rather
 * than the viewport. FiltersPanel's `top: 56` landed at y≈1056 — below a
 * 1000px window — and stretched the app shell 484px past its own height, so
 * focusing a checkbox scrolled the ENTIRE canvas up by that much and the
 * file's top (where predict.py's flow edges live) went out of view.
 *
 * ViewTransition now drops the animation class once the enter keyframe
 * settles. This pins the consequence, not the implementation: the panel is
 * where its CSS says, and the shell never becomes scrollable.
 *
 * Bundled into test:e2e-flask.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.use({ viewport: { width: 1400, height: 900 } });

test.describe("fixed panels are positioned against the viewport", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("the Edges panel opens on screen, and the shell never scrolls", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-side-panel-tab="files"]', { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="models.py"]');
    await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
    await page.waitForTimeout(800);

    const shell = () => page.evaluate(() => {
      const el = document.querySelector("[data-side-panel]")?.parentElement as HTMLElement | null;
      return el ? { over: el.scrollHeight - el.clientHeight, scrolled: el.scrollTop } : null;
    });
    expect((await shell())?.over, "shell must not overflow before opening a panel").toBeLessThanOrEqual(1);

    await page.locator('button:has-text("Edges")').first().click();
    // Past the 280ms enter animation, which is when the stale transform used
    // to settle in.
    await page.waitForTimeout(700);

    const panel = page.locator("[data-edge-toggle='showFlowEdges']");
    await expect(panel).toBeVisible();
    // The real assertion: on screen, not merely in the DOM. toBeInViewport
    // fails for an element parked below the fold.
    await expect(panel, "the Edges panel must open within the viewport").toBeInViewport();

    const opened = await shell();
    expect(opened?.over, "an open panel must not make the app shell scrollable").toBeLessThanOrEqual(1);

    // Clicking the toggle must not displace the canvas: with the shell
    // over-tall, focusing this checkbox scrolled everything up 484px.
    const paneBefore = await page.locator(".react-flow").boundingBox();
    await panel.click();
    await page.waitForTimeout(600);
    const paneAfter = await page.locator(".react-flow").boundingBox();

    expect(Math.abs(paneAfter!.y - paneBefore!.y),
      "toggling a filter must not scroll the canvas").toBeLessThanOrEqual(1);
    expect((await shell())?.scrolled, "the shell must not have been scrolled").toBeLessThanOrEqual(1);
  });

  test("the wrapper leaves no transform once the enter animation settles", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-side-panel-tab="files"]', { timeout: 15_000 });
    await page.locator('button:has-text("Edges")').first().click();
    await page.waitForTimeout(700);

    const wrapper = await page.evaluate(() => {
      const el = document.querySelector("[data-edge-toggle='showFlowEdges']")
        ?.closest("[data-view-transition]") as HTMLElement | null;
      return el ? { state: el.dataset.viewTransition, transform: getComputedStyle(el).transform } : null;
    });
    expect(wrapper?.state, "the wrapper should have settled after the animation").toBe("settled");
    expect(wrapper?.transform,
      "a settled wrapper must have NO transform — any transform re-traps fixed children").toBe("none");
  });
});
