/**
 * The project's own direction in the Direction panel (2026-10-16): "Read from
 * the code" runs the zero-token census on the brief-intent fixture; the guarded
 * zones come back PROPOSED (and in the Inbox); a person agrees one, drops
 * another; a dropped rule stays dropped when the code is read again.
 *
 *   npm run test:e2e-project-direction
 */
import { test, expect } from "@playwright/test";
import { rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const ROOT = join(process.cwd(), FIXTURE);

test.describe("project direction", () => {
  test.skip(!FIXTURE.includes("brief/exchange_demo"), "Requires VG_FIXTURE=test/fixtures/brief/exchange_demo");
  test.afterAll(() => { rmSync(join(ROOT, ".vibegraph", "direction.json"), { force: true }); });

  test("read from the code, decided rule by rule, and a drop stands", async ({ page }) => {
    rmSync(join(ROOT, ".vibegraph", "direction.json"), { force: true });
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
    await page.click("[data-work-run-toggle]");
    await page.click("[data-sheet-tab='direction']");
    const section = page.locator("[data-project-direction]");
    await expect(section).toContainText("No project direction yet");
    await page.click("[data-direction-census]");
    await expect(page.locator("[data-direction-note]")).toContainText("rule(s) the code follows", { timeout: 60_000 });
    const partner = section.locator("[data-direction-rule]", { hasText: "Every write to partner_status is decided by verify" });
    await expect(partner).toHaveAttribute("data-direction-status", "proposed");
    await expect(partner).toContainText("1 only when it holds, 1 only when it fails");
    await expect(section).toContainText("Waiting for you");
    // the Inbox carries the same proposals
    await page.click("[data-sheet-tab='inbox']");
    await expect(page.locator("[data-inbox-kind='direction']").first()).toBeVisible();
    await page.click("[data-sheet-tab='direction']");
    const id = await partner.getAttribute("data-direction-rule");
    await page.click(`[data-direction-agree='${id}']`);
    await expect(section.locator(`[data-direction-rule='${id}']`)).toHaveAttribute("data-direction-status", "agreed");
    const quarantine = section.locator("[data-direction-rule]", { hasText: "Every write to quarantine" });
    const qid = await quarantine.getAttribute("data-direction-rule");
    await page.click(`[data-direction-drop='${qid}']`);
    await expect(section.locator(`[data-direction-rule='${qid}']`)).toHaveAttribute("data-direction-status", "dropped");
    await page.click("[data-direction-census]");
    await expect(section.locator(`[data-direction-rule='${qid}']`)).toHaveAttribute("data-direction-status", "dropped");
    await expect(section.locator(`[data-direction-rule='${id}']`)).toHaveAttribute("data-direction-status", "agreed");
  });
});
