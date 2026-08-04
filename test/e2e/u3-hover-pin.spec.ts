/**
 * U3.1 — thread-node hover tooltip: open / pin / Esc / edit surface.
 *
 * Repaired 2026-06-24 to the CURRENT tooltip surface (the spec had rotted —
 * it was in no npm suite, so the M23/M24/M25/M28 reworks drifted past it):
 *   1. Hover opens a floating tooltip near the node; its Monaco loads the
 *      function source (the edit-node-open path).
 *   2. PINNING IS THE PIN BUTTON, NOT A NODE CLICK. Clicking the node now
 *      opens the editor panel (handleNodeClick → vg-selection → setEditorOpen,
 *      which dismisses the tooltip by design, ThreadView M18.1). The Pin
 *      button (aria-label "Pin") pins; pointer-leave then no longer dismisses.
 *   3. Esc closes a pinned tooltip.
 *   4. The M25/M10 Ask-Claude footer is gone; the CST-patch Save remains.
 *   5. An external/terminal node shows a read-only placeholder, no Monaco.
 *
 * Gated on VG_FIXTURE=flask_demo (cli:main = function_def with editable
 * source + an external terminal). Wired into test:e2e-flask so it stays live.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("U3.1 — thread tooltip", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  async function openCliMainThread(page: Page) {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(900); // node-enter settle
  }

  // Hover a node open via its centre (clicking the node opens the editor, not
  // the tooltip — see header). Returns the tooltip locator.
  async function hoverOpen(page: Page, node: Locator): Promise<Locator> {
    await expect(node).toBeVisible({ timeout: 10_000 });
    const box = await node.boundingBox();
    if (!box) throw new Error("node has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const tooltip = page.locator("[data-thread-tooltip]");
    await expect(tooltip).toBeVisible({ timeout: 5_000 });
    return tooltip;
  }

  test("hover on the seed opens a tooltip and loads Monaco source", async ({ page }) => {
    await openCliMainThread(page);
    const tooltip = await hoverOpen(page, page.locator(".vg-thread-node-seed").first());
    await expect(tooltip).toHaveAttribute("data-tooltip-kind", "seed");
    // Pin first so Monaco mounts on a stable (non-hover-dismissable) tooltip.
    await tooltip.locator("[aria-label='Pin']").click();
    await expect(tooltip.locator(".monaco-editor").first()).toBeVisible({ timeout: 10_000 });
  });

  test("the Pin button pins — pointer-leave no longer dismisses", async ({ page }) => {
    await openCliMainThread(page);
    const tooltip = await hoverOpen(page, page.locator(".vg-thread-node-seed").first());
    await tooltip.locator("[aria-label='Pin']").click();
    await page.mouse.move(5, 5); // far from any node
    await page.waitForTimeout(600); // > HOVER_CLOSE_DELAY
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator("[aria-label='Unpin']")).toBeVisible(); // pin state flipped
  });

  test("Esc dismisses a pinned tooltip", async ({ page }) => {
    await openCliMainThread(page);
    const tooltip = await hoverOpen(page, page.locator(".vg-thread-node-seed").first());
    await tooltip.locator("[aria-label='Pin']").click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
  });

  test("Ask-Claude footer is gone, Save remains (M25/M10)", async ({ page }) => {
    await openCliMainThread(page);
    const tooltip = await hoverOpen(page, page.locator(".vg-thread-node-seed").first());
    await tooltip.locator("[aria-label='Pin']").click(); // keep it open while asserting
    await expect(tooltip.locator('input[placeholder*="Ask Claude"]')).toHaveCount(0);
    await expect(tooltip.getByRole("button", { name: /^save/i })).toBeVisible();
  });

  test("terminal node (external) shows a read-only placeholder, no editor", async ({ page }) => {
    await openCliMainThread(page);
    // Legibility floor (2026-07-04): the thread opens seed-anchored, so the
    // terminal node starts off-viewport (mouse.move can't reach it, and a
    // react-flow canvas doesn't scroll). Fit like a user first.
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(700);
    const ext = page.locator('.react-flow__node[data-id="external:print"]').first();
    const tooltip = await hoverOpen(page, ext);
    await expect(tooltip).toContainText(/external|library|no source|runtime/i);
    await expect(tooltip.locator(".monaco-editor")).toHaveCount(0);
  });
});
