/**
 * M-FS2 (full-scope review 2026-07, P1) — a receiver-resolved PROJECT
 * method is a real step in the thread: it paints as project code (not an
 * external chip) and clicking it opens the node editor.
 *
 * The defect this pins against: `engine.ignite()` rendered as an
 * `external:` terminal whose pinned tooltip claimed "`engine` isn't a
 * module available in the analysis environment" while the same thread
 * painted the method's if-container two nodes away — an on-screen
 * honesty contradiction with no edit path.
 *
 * Boot (see package.json test:e2e-receiver):
 *   VG_FIXTURE=test/fixtures/threads/receiver_demo VG_PORT=4249 PORT=4249 \
 *     npx playwright test test/e2e/m-fs2-receiver-step.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("receiver_demo"), "Requires VG_FIXTURE=test/fixtures/threads/receiver_demo");

test.describe("M-FS2 — receiver-resolved project method is an editable step", () => {
  test("engine.ignite paints as a step and opens the editor", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="main.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(900);

    // The step node exists; the external terminal does not.
    const step = page.locator('.react-flow__node[data-id="engine:Engine.ignite"]');
    await expect(step).toHaveCount(1);
    await expect(page.locator('.react-flow__node[data-id^="external:engine.Engine.ignite"]')).toHaveCount(0);

    // The method's own control flow rides in with it.
    await expect(page.locator('.react-flow__node[data-id*="ignite.fn/if@0"]')).toHaveCount(1);

    // Click → the node editor opens on the method (the affordance the
    // external chip never had).
    await step.click({ force: true });
    await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line", { timeout: 15_000 });
    await expect(page.locator("[data-node-editor-panel]")).toContainText("ignite");

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
