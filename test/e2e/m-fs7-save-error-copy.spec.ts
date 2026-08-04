/**
 * M-FS7 (full-scope review 2026-07, P3) — the editor's save-error strip
 * speaks human first: "That edit isn't valid Python — nothing was
 * saved." with the raw rewriter detail demoted to the tail + tooltip.
 * The errorKind taxonomy is tool vocabulary, not reader copy (the m19
 * evidence-label lesson applied to the editor).
 *
 * Gated on flask_demo; runs in test:e2e-flask.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("flask_demo"), "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

test.describe("M-FS7 — save errors read as human copy", () => {
  test("an invalid-Python save shows the headline, not the raw taxonomy", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="app.py:create_user_route"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(900);

    const node = page.locator('.react-flow__node[data-id="models:create_user"]');
    await node.click({ force: true });
    await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line", { timeout: 15_000 });
    await page.waitForTimeout(500);

    // Break the source and save.
    await page.locator("[data-node-editor-panel] .monaco-editor").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("def broken(:");
    await page.locator("[data-editor-save]").click();

    const strip = page.locator("[data-editor-save-error]");
    await expect(strip).toBeVisible({ timeout: 10_000 });
    await expect(strip).toContainText("isn't valid Python");
    await expect(strip).toContainText("nothing was saved");
    // The taxonomy tag must not lead the line any more.
    await expect(strip).not.toContainText("[parse_error]");
    // The raw detail is still reachable for whoever needs it.
    const title = await strip.getAttribute("title");
    expect(title).toMatch(/parse_error|invalid Python|Syntax/i);
  });
});
