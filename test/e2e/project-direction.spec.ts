/**
 * The project's own direction in the Direction panel (2026-10-16): "Read from
 * the code" runs the zero-token census on the brief-intent fixture; the guarded
 * zones come back PROPOSED (and in the Inbox); a person agrees one, drops
 * another; a dropped rule stays dropped when the code is read again.
 *
 *   npm run test:e2e-project-direction
 */
import { test, expect } from "@playwright/test";
import { readFileSync, rmSync } from "node:fs";
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

  test("2026-10-20: an agreed rule carries the two switches, flips at once, and the choice is stored", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
    await page.click("[data-work-run-toggle]");
    await page.click("[data-sheet-tab='direction']");
    const section = page.locator("[data-project-direction]");
    const agreed = section.locator("[data-direction-rule][data-direction-status='agreed']").first();
    await expect(agreed).toBeVisible({ timeout: 15_000 });
    const id = await agreed.getAttribute("data-direction-rule");
    const up = agreed.locator('[data-delivery="upfront"]');
    const broken = agreed.locator('[data-delivery="oncheck"]');
    // both on by default, as the old default mode meant — unless nothing checks it
    await expect(up).toHaveAttribute("aria-checked", "true");
    const checked = /checked by /.test((await agreed.textContent()) ?? "");
    if (checked) await expect(broken).toHaveAttribute("aria-checked", "true");
    else await expect(broken).toHaveAttribute("aria-disabled", "true");
    await up.click();
    await expect(up).toHaveAttribute("aria-checked", "false", { timeout: 250 });
    const stored = () => JSON.parse(readFileSync(join(ROOT, ".vibegraph", "direction.json"), "utf-8")).rules.find((r: { id: string }) => r.id === id)?.delivery;
    await expect.poll(stored, { timeout: 10_000 }).toEqual({ upfront: false, onCheck: checked });
    // a proposed or dropped rule has nothing to switch: it is not told at all
    await expect(section.locator("[data-direction-rule][data-direction-status='dropped'] [role='switch']")).toHaveCount(0);
  });
});
