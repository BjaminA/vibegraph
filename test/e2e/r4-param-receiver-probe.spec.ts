/**
 * §5.5a — parameter-bound receiver honesty, living-renderer proof.
 *
 * `conditions.get(...)` in aero's normalize_conditions, where
 * `conditions` is a FUNCTION PARAMETER. R4 only covered call-bound local
 * assignments (`conn = _get_conn()`), so a parameter-bound receiver
 * stayed `external` — sending the M13 resolver chasing a module named
 * `conditions` and painting "base module 'conditions' is not importable:
 * No module named 'conditions'", a lie about an ordinary parameter.
 *
 * This file began as a capture-only probe of that gap; §5.5a closes the
 * gap and the probe becomes an asserting spec. Asserts BOTH halves on the
 * painted view (mirrors r4-conn-honesty.spec.ts):
 *   1. Classification — the conditions.get terminal renders `dynamic`
 *      (amber --accent-warning, Shuffle, solid), never `external`.
 *   2. Message — the pinned tooltip names the binding form ("receiver
 *      'conditions' is a function parameter") and the dishonest
 *      import-failure line is gone.
 *
 * Gated on aero_demo.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/aero_demo VG_PORT=4207 PORT=4207 \
 *     npx playwright test test/e2e/r4-param-receiver-probe.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_AERO = FIXTURE.includes("aero_demo");

test.describe("§5.5a — param-bound receiver renders honest dynamic, not failed external", () => {
  test.skip(!IS_AERO, "Requires VG_FIXTURE=test/fixtures/threads/aero_demo");

  test("dynamic classification + honest 'function parameter' tooltip", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="main.py:compute_drag"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // 1 — classification on the painted node: dynamic marker channels.
    const node = page
      .locator(".vg-thread-node")
      .filter({ hasText: "conditions.get" })
      .first();
    await node.waitFor({ state: "visible", timeout: 10_000 });
    const marker = await node.evaluate((el) => ({
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
    await node.click();
    const tooltip = page.locator("[data-thread-tooltip]");
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });
    await expect(tooltip).toContainText(
      "receiver 'conditions' is a function parameter",
      { timeout: 5_000 },
    );
    // The lie must be gone — no module-import attempt, no failure line.
    await expect(tooltip).not.toContainText(/not importable/);
    await expect(tooltip).not.toContainText(/No module named/);

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
