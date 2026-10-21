/**
 * The "Now" block and docked panels (2026-10-16, the GUI pass): on a project
 * with code, the foot of the side panel says where the project stands — the
 * objective, the rules, the direction — and one next step; the step opens the
 * panel that acts on it, DOCKED beside the graph (the product default; the
 * other suites pin the centred sheet); the empty-roadmap prompt of the
 * build-from-empty flow is not shown on a project with code.
 *
 *   npm run test:e2e-now
 */
import { test, expect } from "@playwright/test";
import { rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";

test.describe("now strip", () => {
  test.skip(!FIXTURE.includes("brief/exchange_demo"), "Requires VG_FIXTURE=test/fixtures/brief/exchange_demo");
  test.afterAll(() => { rmSync(join(process.cwd(), FIXTURE, ".vibegraph", "direction.json"), { force: true }); });

  test("where the project stands, one next step, and the panel it opens docked", async ({ page }) => {
    rmSync(join(process.cwd(), FIXTURE, ".vibegraph", "direction.json"), { force: true });
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
    const strip = page.locator("[data-now-strip]");
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-now-objective]")).toContainText("Partners see only our signed decisions");
    await expect(page.locator("[data-now-item='rules']")).toContainText("3 rules");
    await expect(page.locator("[data-now-item='direction']")).toContainText("no direction yet");
    await expect(page.locator("[data-roadmap-state='empty']")).toHaveCount(0);
    // 2026-10-20 — the next step follows the setup's order (setup_state.ts):
    // the fixture's specs and rules are done, its groups are not
    await expect(page.locator("[data-now-next]")).toContainText("Propose the architecture groups (the Brief)");
    await expect(page.locator("[data-now-setup]")).toContainText("Setup guide · 2 of 6 steps done");
    // a chip opens its panel, docked beside the graph
    await page.click("[data-now-item='direction']");
    const sheet = page.locator("[data-panel-sheet='direction']");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-docked", "true");
    await expect(page.locator("[data-sheet-scrim]")).toHaveCount(0);
    // it lives at the foot of the side panel, never over the canvas, where each
    // view keeps its own bottom-edge controls (the map's story bar, the zoom)
    await expect(page.locator("[data-side-panel] [data-now-strip]")).toHaveCount(1);
    const s = (await strip.boundingBox())!, d = (await sheet.boundingBox())!;
    expect(s.x + s.width).toBeLessThanOrEqual(281);
    expect(s.x + s.width).toBeLessThanOrEqual(d.x);
    // reading the direction moves the strip: proposals now wait, and the tabs count them
    await page.click("[data-direction-census]");
    await expect(page.locator("[data-now-item='waiting']")).toContainText("waiting for you", { timeout: 30_000 });
    await expect(page.locator("[data-sheet-badge='direction']")).toBeVisible();
    await expect(page.locator("[data-now-next]")).toContainText("wait for you");
  });
});
