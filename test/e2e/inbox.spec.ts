/**
 * The decision inbox in the GUI (2026-10-06, direction review M11): the
 * toolbar shows how many decisions wait; the panel lists them with their
 * evidence; Agree / Reject run the store's own operation and the count
 * follows. Fixture: views_demo's plan holds one proposed process (archiver).
 *
 *   VG_FIXTURE=test/fixtures/system/views_demo VG_PORT=4313 PORT=4313 \
 *     npx playwright test test/e2e/inbox.spec.ts --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const PLAN = join(resolve(FIXTURE || "."), ".vibegraph", "plan.json");

test.describe("decision inbox", () => {
  test.skip(!FIXTURE.includes("views_demo"), "Requires VG_FIXTURE=test/fixtures/system/views_demo");
  test.use({ viewport: { width: 1600, height: 1000 } });
  let saved = "";
  test.beforeAll(() => { saved = readFileSync(PLAN, "utf-8"); });
  test.afterEach(() => { writeFileSync(PLAN, saved); });

  test("the toolbar counts what waits; the panel decides it through the store's own operation", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-top-toolbar]", { timeout: 30_000 });
    const banner = page.locator("[data-key-banner]");
    if (await banner.count()) await banner.locator("button").click();
    await expect(page.locator("[data-inbox-badge]")).toHaveText("1", { timeout: 20_000 });
    await page.locator("[data-inbox-toggle]").click();
    const item = page.locator('[data-inbox-item="plan:processes:archiver"]');
    await expect(item).toContainText("new plan process archiver");
    await expect(item).toContainText("order archiver");
    await item.locator("[data-inbox-reject]").click();
    await expect(page.locator("[data-inbox-message]")).toContainText("archiver", { timeout: 15_000 });
    await expect(page.locator('[data-inbox-item="plan:processes:archiver"]')).toHaveCount(0);
    const plan = JSON.parse(readFileSync(PLAN, "utf-8"));
    expect(plan.processes.find((p: { id: string }) => p.id === "archiver")?.status ?? "dropped").toBe("dropped");
  });
});
