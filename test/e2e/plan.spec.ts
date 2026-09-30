/**
 * THE PLAN in the app (2026-09-30): the Plan panel lists the hypothetical
 * project with each item's status and plan-vs-code verdict; a person agrees
 * (the file on disk changes, recorded as theirs); a realised planned thread
 * opens the real one; and the architecture map draws the plan as dashed
 * ghosts — alone (Plan) or over the real map, only what the code lacks
 * (Overlay).
 *
 *   npm run test:e2e-plan
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const ON = FIXTURE.includes("plan_demo");
const VG = join(process.cwd(), FIXTURE, ".vibegraph");
const PLAN = join(VG, "plan.json");
const REVIEW = join("reviews", "plan");

test.describe("the hypothetical plan", () => {
  test.skip(!ON, "Requires VG_FIXTURE=test/fixtures/plan/plan_demo");
  let original = "";
  let hadIgnore = false;
  test.beforeAll(() => {
    original = readFileSync(PLAN, "utf-8");
    hadIgnore = existsSync(join(VG, ".gitignore"));
    mkdirSync(REVIEW, { recursive: true });
  });
  test.afterAll(() => {
    writeFileSync(PLAN, original);
    rmSync(join(VG, "constraints.json"), { force: true });
    if (!hadIgnore) rmSync(join(VG, ".gitignore"), { force: true });
  });

  async function boot(page: Page) {
    await page.setViewportSize({ width: 1500, height: 940 });
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 20_000 });
    const banner = page.locator("[data-key-banner]");
    if (await banner.count()) await banner.locator("button").click();
  }

  test("the panel: statuses and verdicts, a person agrees, a realised thread opens", async ({ page }) => {
    await boot(page);
    await page.click("[data-plan-toggle]");
    const panel = page.locator("[data-plan-panel]");
    await expect(panel).toBeVisible();
    await expect(panel.locator("[data-plan-banner]")).toContainText("a plan, not the code");
    await expect(panel.locator("[data-plan-objective]")).toContainText("wear forecast within a minute");
    await expect(panel.locator("[data-plan-counts]")).toContainText("1 violated", { timeout: 15_000 });

    const dash = panel.locator('[data-plan-item="processes:dashboard"]');
    await expect(dash).toHaveAttribute("data-plan-status", "proposed");
    await expect(dash).toHaveAttribute("data-plan-verdict", "not-built");
    await expect(panel.locator('[data-plan-item="stack:postgres"]')).toHaveAttribute("data-plan-verdict", "drifted");
    await expect(panel.locator('[data-plan-item="policies:p1"]')).toHaveAttribute("data-plan-verdict", "violated");
    await expect(panel.locator('[data-plan-item="threads:POST /readings"] [data-plan-chain]')).toHaveText("validate  →  b1:insert  →  insert_reading");
    await page.screenshot({ path: join(REVIEW, "1-panel.png") });

    await dash.locator("[data-plan-agree]").click();
    await expect(dash).toHaveAttribute("data-plan-status", "agreed");
    const onDisk = JSON.parse(readFileSync(PLAN, "utf-8"));
    expect(onDisk.processes.find((p: { id: string }) => p.id === "dashboard").status).toBe("agreed");
    expect(onDisk.revision).toBe(4);
    expect(onDisk.changelog.at(-1)).toMatchObject({ rev: 4, by: "human", change: "agree processes dashboard" });

    await panel.locator('[data-plan-item="threads:POST /readings"] [data-plan-open-thread]').click();
    await expect(page.locator("[data-thread-view]")).toHaveAttribute("data-seed-id", /post_readings/, { timeout: 10_000 });
  });

  test("the map: the plan as dashed ghosts, alone and over the real map", async ({ page }) => {
    await boot(page);
    const system = page.locator('[data-toolbar-group="views"]').getByRole("button", { name: "System", exact: true });
    for (let i = 0; i < 8 && !(await page.locator("[data-system-view]").count()); i++) {
      if (i === 0 || (await system.getAttribute("data-active")) !== "true") await system.click();
      await page.waitForTimeout(3000);
    }
    await expect(page.locator("[data-system-view]")).toBeVisible();
    if ((await page.locator("[data-system-view]").getAttribute("data-system-mode")) !== "map") await page.locator("[data-system-arch-toggle]").click();
    const toggle = page.locator("[data-plan-view-toggle]");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-arch-source="planned"]')).toHaveCount(0);

    await toggle.locator('[data-plan-view="plan"]').click();
    // 3 processes + 4 tools; every one a dashed ghost.
    await expect(page.locator('[data-arch-source="planned"]')).toHaveCount(7, { timeout: 10_000 });
    await expect(page.locator('[data-arch-source="derived"]')).toHaveCount(0);
    await expect(page.locator('[data-arch-id="plan:dashboard"]')).toBeVisible();
    await page.mouse.move(2, 2);
    await page.screenshot({ path: join(REVIEW, "2-map-plan.png") });

    await toggle.locator('[data-plan-view="overlay"]').click();
    // Only what the code does not have yet: dashboard (not built), postgres
    // (drifted), redis (not built). The realised api, forecaster, flask and
    // sqlite3 are the real boxes beside them.
    await expect(page.locator('[data-arch-source="planned"]')).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator('[data-arch-id="plan:api"]')).toHaveCount(0);
    expect(await page.locator('[data-arch-source="derived"]').count()).toBeGreaterThan(0);
    await page.mouse.move(2, 2);
    await page.screenshot({ path: join(REVIEW, "3-map-overlay.png") });

    await toggle.locator('[data-plan-view="real"]').click();
    await expect(page.locator('[data-arch-source="planned"]')).toHaveCount(0);
  });
});
