/**
 * M-LANG3 (PLAN-M-LANG.md) — the JS/TS read-only experience in the
 * LIVING renderer:
 *
 *   1. the launchpad lists the express ROUTE entries (GET/POST /users);
 *   2. the route thread paints: a cross-file step into db.ts, effect
 *      terminals, and a DYNAMIC marker for the param-receiver call;
 *   3. Monaco holds a `typescript` model;
 *   4. affordance-must-match-operation: NO run-to-here, NO Save — jsts
 *      has no edit/run floor until M-LANG5b.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/jsts/api_demo VG_PORT=4268 PORT=4268 \
 *     npx playwright test test/e2e/m-lang3-jsts.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_API = FIXTURE.includes("jsts/api_demo");
const REVIEW_DIR = join(process.cwd(), "reviews", "m-lang3-jsts");

test.describe("M-LANG3 — JS/TS read-only experience", () => {
  test.skip(!IS_API, "Requires VG_FIXTURE=test/fixtures/jsts/api_demo");

  test("route entries, thread markers, typescript Monaco, gated affordances", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");

    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    const row = page.locator('[data-thread-index-row][data-entry-id="server.ts:listUsers"]');
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    await expect(page.locator(".vg-thread-node-external").first()).toBeVisible();
    await expect(page.locator(".vg-thread-node-dynamic").first()).toBeVisible();
    await expect(page.locator(".vg-thread-node-unresolved")).toHaveCount(0);

    const stepLabels = await page.locator(".vg-thread-node-step").allTextContents();
    expect(stepLabels.join(" ")).toContain("queryUsers");

    const stepNode = page.locator(".vg-thread-node-step", { hasText: "queryUsers" }).first();
    await stepNode.click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-run-to-here]")).toHaveCount(0);

    await page.waitForSelector(".monaco-editor", { timeout: 10_000 });
    const languages = await page.evaluate(() => {
      const m = (window as any).monaco;
      if (!m?.editor) return [];
      return m.editor.getModels().map((mod: any) => mod.getLanguageId());
    });
    expect(languages).toContain("typescript");
    expect(languages).not.toContain("python");

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "jsts-thread.png"), fullPage: true });

    expect(pageErrors).toEqual([]);
  });
});
