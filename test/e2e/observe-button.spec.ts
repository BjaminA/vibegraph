/**
 * OBSERVE button (PLAN-M-RUNTIME.md phase 2) — B5's runtime sample, which
 * was MCP-only, surfaced as one press in the thread tooltip:
 *
 *   click the DYNAMIC node (`eng.run`, where `eng = make_engine()`) →
 *   [data-observe-node] renders → press → NOTHING has run yet: the SM3
 *   floor comes back with the offenses on the path and a token, rendered
 *   as [data-observe-consent] → confirm → [data-observe-result] reports
 *   the receiver's real runtime type (Engine) WITH the note that says a
 *   sample is not a fact, and the node's marker stays dynamic.
 *
 * The consent step is not an edge case here, it is THE path: observing a
 * dynamic target means running an unprovable one, which is exactly what
 * the floor exists to gate (test/mcp_observe_dynamic.test.mjs pins the
 * same sequence over MCP — the button and the tool share one code path).
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/observe_demo VG_PORT=4300 PORT=4300 \
 *     npx playwright test test/e2e/observe-button.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_OBSERVE = FIXTURE.includes("threads/observe_demo");

test.describe("Observe button — a runtime sample on a dynamic node", () => {
  test.skip(!IS_OBSERVE, "Requires VG_FIXTURE=test/fixtures/threads/observe_demo");

  test("consent first, then the real target, still labelled a sample", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id$="dispatch"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // Pin the tooltip on the dynamic dispatch.
    await page.locator(".vg-thread-node-dynamic", { hasText: "eng.run" }).first().click();

    const observeBtn = page.locator("[data-observe-node]");
    await expect(observeBtn).toBeVisible({ timeout: 10_000 });
    // The button names the receiver it would sample, so the press is informed.
    await expect(observeBtn).toContainText("eng");

    await observeBtn.click();

    // The floor answers FIRST, and nothing has run.
    const consent = page.locator("[data-observe-consent]");
    await expect(consent).toBeVisible({ timeout: 20_000 });
    await expect(consent).toContainText("Nothing has run");
    await expect(consent).toContainText("dynamic");

    await page.locator("[data-observe-confirm]").click();

    const result = page.locator("[data-observe-result]");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toHaveAttribute("data-observe-outcome", "ok");
    await expect(page.locator("[data-observed-target]")).toContainText("Engine");

    // The honesty label travels WITH the value — never separately, never
    // optional. src/server/observe.ts owns the wording; this pins that it
    // reaches the human who pressed the button.
    const note = page.locator("[data-observe-note]");
    await expect(note).toContainText("Runtime sample");
    await expect(note).toContainText("node stays dynamic");

    // And it does: an observation is an overlay, not a resolution.
    await expect(
      page.locator(".vg-thread-node-dynamic", { hasText: "eng.run" }).first(),
    ).toBeVisible();
  });
});
