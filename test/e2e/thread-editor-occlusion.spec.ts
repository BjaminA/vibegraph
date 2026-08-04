/**
 * Thread view × editor dock — no dead surfaces over the nodes.
 *
 * User report (2026-06-12, fixed pre-M27): with the editor docked, a
 * "big black rectangle" sat adjacent to the panel covering thread
 * nodes. Two surfaces composed into it:
 *   1. The ExternalEffectsPanel is positioned at right:0 — under the
 *      editor dock — yet its width was still reserved out of the
 *      canvas: a dead black strip exactly where nodes had been.
 *   2. The react-flow MiniMap floats over the canvas's bottom-right —
 *      at strip width it lands on the nodes themselves.
 * And the whole-fit could capture a MID-TRANSITION canvas width (the
 * dock's `right` animates 280ms), leaving the thread's tail clipped
 * under the editor.
 *
 * Pinned here: editor open → no minimap, no effects panel, and every
 * thread node inside the VISIBLE canvas (left of the editor edge);
 * editor closed → minimap and effects panel return.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/thread-editor-occlusion.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("thread view × editor dock occlusion", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("editor open: no minimap, no effects panel, every node visible left of the dock", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="app.py:get_user_route"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(900);

    // Baseline: minimap + effects panel are part of the no-editor view.
    await expect(page.locator(".react-flow__minimap")).toBeVisible();
    await expect(page.locator("[data-effects-panel]")).toBeVisible();

    // Open the editor via the seed node.
    await page.locator(".vg-thread-node-seed").first().click();
    await page.waitForSelector("[data-node-editor-panel] .monaco-editor", { timeout: 10_000 });
    // Dock transition (280ms) + settle re-fit (380ms + 300ms travel).
    await page.waitForTimeout(1_300);

    await expect(page.locator(".react-flow__minimap")).toHaveCount(0);
    await expect(page.locator("[data-effects-panel]")).toHaveCount(0);

    // Legibility floor (2026-07-04): the dock-open re-fit may leave the
    // thread seed-anchored with its tail honestly off-frame (not covered
    // — out of view, pannable). The occlusion claim under test is that a
    // USER-TRIGGERED fit respects the dock's edge, so click Controls fit
    // and then assert nothing lands under the editor.
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(700);

    // Every thread node must sit inside the visible canvas — between
    // the view's left edge and the editor dock's left edge. This is
    // the actual user-facing claim ("nothing covers my nodes").
    const offenders = await page.evaluate(() => {
      const tv = document.querySelector("[data-thread-view]")!.getBoundingClientRect();
      const panel = document.querySelector("[data-node-editor-panel]")!.getBoundingClientRect();
      const rightEdge = Math.min(tv.right, panel.left);
      const bad: string[] = [];
      document.querySelectorAll(".vg-thread-node").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > rightEdge + 2 || r.left < tv.left - 2) {
          bad.push(`${el.textContent?.slice(0, 24)} @${Math.round(r.left)}-${Math.round(r.right)}`);
        }
      });
      return bad;
    });
    expect(offenders, `nodes outside the visible canvas:\n  ${offenders.join("\n  ")}`).toEqual([]);

    // Close the editor — both surfaces come back.
    await page.locator("[data-node-editor-panel] button").first().click();
    await page.waitForTimeout(900);
    await expect(page.locator(".react-flow__minimap")).toBeVisible();
    await expect(page.locator("[data-effects-panel]")).toBeVisible();
  });
});
