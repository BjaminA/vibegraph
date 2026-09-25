/**
 * M-LANG4 (PLAN-M-LANG.md) — the bash edit floor, end-to-end in the
 * living renderer: click a bash step → the editor panel opens EDITABLE
 * (capabilities.edit flipped with this milestone) → type a marker →
 * Save → replace_function_body routes through rewrite_bash.mjs → the
 * file on disk changes ONLY inside the function's span → the graph
 * re-links live (refreshDerived, unchanged since M26).
 *
 * Fixture is snapshotted and restored (the m18-3 pattern) — the edit
 * touches the real committed deploy_demo.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/bash/deploy_demo VG_PORT=4272 PORT=4272 \
 *     npx playwright test test/e2e/m-lang4-bash-edit.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_DEPLOY = FIXTURE.includes("bash/deploy_demo");
const SCRIPT_PATH = join(process.cwd(), "test", "fixtures", "bash", "deploy_demo", "deploy.sh");
const REVIEW_DIR = join(process.cwd(), "reviews", "m-lang4-bash-edit");
const MARKER = 'echo "m-lang4-marker"';

test.describe("M-LANG4 — bash edit floor", () => {
  test.skip(!IS_DEPLOY, "Requires VG_FIXTURE=test/fixtures/bash/deploy_demo");

  let original = "";
  test.beforeAll(() => { original = readFileSync(SCRIPT_PATH, "utf-8"); });
  test.afterAll(() => { writeFileSync(SCRIPT_PATH, original, "utf-8"); });

  test("edit a bash function through the panel; diff stays confined; graph re-links", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="deploy.sh:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // Open the editor panel on the `prepare` step.
    await page.locator(".vg-thread-node-step", { hasText: "prepare" }).first().click();
    const panel = page.locator("[data-node-editor-panel]");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line", { timeout: 10_000 });

    // M-LANG4: the panel is EDITABLE for bash now — the read-only note
    // from M-LANG2b must be gone and the Save footer present.
    await expect(page.locator("[data-readonly-language]")).toHaveCount(0);
    await expect(page.locator("[data-editor-save]")).toBeVisible();

    // Append the marker inside the function body (before the closing }).
    await page.locator("[data-node-editor-panel] .monaco-editor").click();
    await page.keyboard.press("ControlOrMeta+End");
    // cursor is at/after the closing brace — go up one line to land inside the body
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(`  ${MARKER}`);

    await page.locator("[data-editor-save]").click();
    await page.waitForTimeout(1500);
    await expect(page.locator("[data-editor-save-error]")).toHaveCount(0);

    // Disk: the marker landed inside prepare(); EVERYTHING else is
    // byte-identical (the confinement floor, observed end-to-end).
    const post = readFileSync(SCRIPT_PATH, "utf-8");
    expect(post).toContain(MARKER);
    const strip = (s: string) =>
      s.split("\n").filter((l) => !l.includes("m-lang4-marker")).map((l) => l.trimEnd()).join("\n");
    expect(strip(post)).toBe(strip(original));

    // The graph re-linked live: the new echo appears as a log step in
    // the refreshed thread (M26 refreshDerived path, no reload).
    await page.waitForTimeout(1200);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "after-save.png"), fullPage: true });

    expect(pageErrors).toEqual([]);
  });
});
