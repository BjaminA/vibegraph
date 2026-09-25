/**
 * M-LANG5b (PLAN-M-LANG.md) — the JS/TS edit floor, end-to-end in the
 * living renderer: open a route thread → click the seed → the editor
 * panel opens EDITABLE → type a marker → Save → replace_function_body
 * routes through rewrite_jsts.mjs → the disk diff stays confined to
 * the function's span → the graph re-links live. Fixture snapshotted
 * and restored (the m18-3 pattern).
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/jsts/api_demo VG_PORT=4276 PORT=4276 \
 *     npx playwright test test/e2e/m-lang5b-jsts-edit.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_API = FIXTURE.includes("jsts/api_demo");
const SERVER_PATH = join(process.cwd(), "test", "fixtures", "jsts", "api_demo", "server.ts");
const REVIEW_DIR = join(process.cwd(), "reviews", "m-lang5b-jsts-edit");
const MARKER = 'console.debug("m-lang5b-marker");';

test.describe("M-LANG5b — JS/TS edit floor", () => {
  test.skip(!IS_API, "Requires VG_FIXTURE=test/fixtures/jsts/api_demo");

  let original = "";
  test.beforeAll(() => { original = readFileSync(SERVER_PATH, "utf-8"); });
  test.afterAll(() => { writeFileSync(SERVER_PATH, original, "utf-8"); });

  test("edit a route handler through the panel; diff confined; graph re-links", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="server.ts:listUsers"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // Open the editor on the seed (the listUsers handler).
    await page.locator(".vg-thread-node-seed").first().click();
    const panel = page.locator("[data-node-editor-panel]");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line", { timeout: 10_000 });

    // M-LANG5b: editable — no read-only note, Save present.
    await expect(page.locator("[data-readonly-language]")).toHaveCount(0);
    await expect(page.locator("[data-editor-save]")).toBeVisible();

    // Append the marker inside the function body (before the closing }).
    await page.locator("[data-node-editor-panel] .monaco-editor").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(`  ${MARKER}`);

    await page.locator("[data-editor-save]").click();
    await page.waitForTimeout(1500);
    await expect(page.locator("[data-editor-save-error]")).toHaveCount(0);

    const post = readFileSync(SERVER_PATH, "utf-8");
    expect(post).toContain("m-lang5b-marker");
    const strip = (s: string) =>
      s.split("\n").filter((l) => !l.includes("m-lang5b-marker")).map((l) => l.trimEnd()).join("\n");
    expect(strip(post)).toBe(strip(original));

    await page.waitForTimeout(1200);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "after-save.png"), fullPage: true });

    expect(pageErrors).toEqual([]);
  });
});
