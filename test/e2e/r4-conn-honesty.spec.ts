/**
 * R4 — head-local receiver honesty, living-renderer proof.
 *
 * `conn.execute(...)` where `conn = _get_conn()` is a method call on a
 * runtime-bound LOCAL receiver. Pre-R4 it was classified `external`,
 * which sent the M13 resolver chasing a module named `conn` and painted
 * the tooltip with "base module 'conn' is not importable: No module
 * named 'conn'" — a lie about a perfectly ordinary local binding.
 *
 * Asserts BOTH halves of the fix on the painted view:
 *   1. Classification — the conn.execute terminal renders as `dynamic`
 *      (amber --accent-warning, Shuffle, solid), never `external`.
 *   2. Message — the pinned tooltip states the honest reason
 *      ("receiver 'conn' is a local binding from _get_conn()") and the
 *      dishonest import-failure line is gone.
 *
 * Gated on flask_demo.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/r4-conn-honesty.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("R4 — conn.execute renders honest dynamic, not failed external", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("dynamic classification + honest receiver-binding tooltip", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="db.py:insert"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // 1 — classification on the painted node: dynamic marker channels
    // (same channels the R3 spec pins: accent, icon, opacity).
    const connNode = page
      .locator(".vg-thread-node")
      .filter({ hasText: "conn.execute" })
      .first();
    await connNode.waitFor({ state: "visible", timeout: 10_000 });
    const marker = await connNode.evaluate((el) => ({
      className: el.className,
      kindLabel: el.getAttribute("data-kind-label"),
      iconName: el.getAttribute("data-icon-name"),
      accentVar: el.getAttribute("data-accent-var"),
      opacity: parseFloat(getComputedStyle(el).opacity),
    }));
    expect(marker.className).toContain("vg-thread-node-dynamic");
    expect(marker.className).not.toContain("vg-thread-node-external");
    expect(marker.kindLabel).toBe("DYNAMIC");
    expect(marker.iconName).toBe("Shuffle");
    expect(marker.accentVar).toBe("--accent-warning");
    expect(marker.opacity).toBeCloseTo(1, 1); // solid — a confident call

    // 2 — the honest message, on the pinned tooltip.
    await connNode.click();
    const tooltip = page.locator("[data-thread-tooltip]");
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });
    await expect(tooltip).toContainText(
      "receiver 'conn' is a local binding from _get_conn()",
      { timeout: 5_000 },
    );
    // The lie must be gone — no module-import attempt, no failure line.
    await expect(tooltip).not.toContainText(/not importable/);
    await expect(tooltip).not.toContainText(/No module named/);

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
