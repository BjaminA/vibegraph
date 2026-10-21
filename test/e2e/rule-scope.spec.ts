/**
 * The rule form's scope picker, grouped and coloured (2026-10-19,
 * PLAN-M-RULES M1): on the fleet example the form offers the architecture's
 * processes, the threads by kind, the scripts, the protocols by role, the
 * project's own code — libraries and runtime folded — each chip in its kind's
 * colours; the preview says how many threads the picked scope reaches, and
 * the stored rule carries exactly that scope.
 *
 *   npm run test:e2e-rule-scope
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const FILE = join(process.cwd(), FIXTURE, ".vibegraph", "constraints.json");

test.describe("rule scope picker", () => {
  test.skip(!FIXTURE.includes("fleet-telemetry"), "Requires VG_FIXTURE=examples/fleet-telemetry");
  let original = "";
  test.beforeAll(() => { original = readFileSync(FILE, "utf-8"); });
  test.afterAll(() => { writeFileSync(FILE, original); });

  test("groups from the facts, coloured chips, a live reach, and the stored scope is what was picked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
    await page.locator("[data-rules-toggle]").click();
    await expect(page.locator('[data-panel-sheet="rules"]')).toBeVisible();
    await page.locator("[data-constraint-form-toggle]").click();
    const picker = page.locator("[data-scope-picker]");
    await expect(picker).toBeVisible();

    // the groups, open and folded as their facts deserve
    for (const id of ["architecture", "threads", "scripts", "protocols", "code"]) await expect(picker.locator(`[data-scope-group="${id}"]`)).toHaveAttribute("data-open", "true");
    await expect(picker.locator('[data-scope-group="runtime"]')).not.toHaveAttribute("data-open", "true");
    await expect(picker.locator('[data-scope-subgroup="Public API"] [data-scope-more]')).toContainText(/\+\d+ more/);
    await expect(picker.locator('[data-scope-subgroup="Routes · flask"] [data-scope-option="ep:telemetry/app.py:ingest_route"]')).toContainText("/ingest");
    await expect(picker.locator('[data-scope-subgroup="Databases"] [data-scope-option="stack:sqlite3"]')).toBeVisible();

    // each chip in its kind's colours: a process (route) and a store (database) differ
    const colour = (key: string) => picker.locator(`[data-scope-option="${key}"]`).first().evaluate((el) => getComputedStyle(el).color);
    expect(await colour("ep:telemetry/app.py:ingest_route")).not.toBe(await colour("stack:sqlite3"));
    await expect(picker.locator('[data-scope-option="stack:sqlite3"]').first()).toHaveAttribute("data-chip", "store");

    // search narrows across groups
    await picker.locator("[data-scope-search]").fill("ingest");
    await expect(picker.locator('[data-scope-group="threads"]')).toBeVisible();
    await expect(picker.locator('[data-scope-option="stack:sqlite3"]')).toHaveCount(0);
    await picker.locator("[data-scope-search]").fill("");

    // pick a route and a database: the preview says what that reaches
    await picker.locator('[data-scope-subgroup="Routes · flask"] [data-scope-option="ep:telemetry/app.py:ingest_route"]').click();
    await expect(picker.locator("[data-scope-reach]")).toHaveAttribute("data-scope-reach", "1");
    await picker.locator('[data-scope-subgroup="Databases"] [data-scope-option="stack:sqlite3"]').click();
    const reach = Number(await picker.locator("[data-scope-reach]").getAttribute("data-scope-reach"));
    expect(reach).toBeGreaterThan(1);
    await expect(picker.locator('[data-scope-picked] [data-scope-option]')).toHaveCount(2);

    await page.fill("[data-constraint-text]", "Ingest writes go through telemetry.storage; nothing on these threads opens its own sqlite3 connection.");
    await page.click("[data-constraint-add]");
    await expect.poll(() => {
      const c = JSON.parse(readFileSync(FILE, "utf-8")).constraints.find((x: { text: string }) => x.text.startsWith("Ingest writes go through"));
      return c ? JSON.stringify(c.scope) : null;
    }, { timeout: 10_000 }).toBe(JSON.stringify({ entryPointIds: ["telemetry/app.py:ingest_route"], stack: ["sqlite3"] }));
  });
});
