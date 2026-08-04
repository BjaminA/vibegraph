/**
 * M-FS10 (full-scope review 2026-07, P3) — opening a DIFFERENT thread is
 * a navigation: it closes a code dock left over from earlier context.
 * (The in-thread side-by-side flow — open the dock WHILE reading a
 * thread, edit against it — is pinned by m18-r1 and untouched.)
 *
 * Gated on flask_demo; runs in test:e2e-flask.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("flask_demo"), "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

test.describe("M-FS10 — thread navigation closes the stale code dock", () => {
  test("row-open of another thread dismisses the dock", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // Open a thread, then its file's code dock (the M18-r1 side-by-side).
    await page.click('[data-thread-index-row][data-entry-id="app.py:create_user_route"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Code" }).click();
    await expect(page.locator("[data-code-view]")).toBeVisible({ timeout: 10_000 });

    // Navigate to a DIFFERENT thread from the side panel: the stale dock
    // must not squeeze the fresh thread into a sliver.
    await page.click('[data-thread-tree-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-code-view]")).toHaveCount(0);
  });
});
