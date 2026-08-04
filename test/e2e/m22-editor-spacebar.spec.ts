/**
 * Bug fix - the node editor must accept spaces (PLAN: snug-sleeping-ocean).
 *
 * Regression test for: "can't type past the first word - spacebar does
 * nothing" in the floating Monaco editor when it's open over a thread/
 * diagram canvas. react-flow's window-level Space-pan listener was
 * preventDefault'ing the spacebar; the fix isolates editor keydowns from
 * window (NodeEditorPanel) + disables react-flow's space-pan.
 *
 * The existing Mode-A test types `open("/tmp/m18.txt")` - no spaces - so
 * it never caught this. Here we replace the buffer with one spaced line
 * and assert the spaces land. No Save -> the fixture is never mutated.
 *
 * Gated on flask_demo.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m22-editor-spacebar.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("editor spacebar", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("typing spaced code in the editor over a thread keeps the spaces", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);

    // Click the seed (main) -> editor opens with main() loaded.
    await page.locator(".vg-thread-node-seed").first().click();
    await expect(page.locator("[data-node-editor-panel]")).toBeVisible({ timeout: 5_000 });
    await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line", { timeout: 10_000 });

    // Select-all and replace the whole buffer with one spaced line, typed
    // char by char (each Space is a real keydown - the bug's trigger).
    // Replacing the buffer keeps the line at the top, always within
    // Monaco's virtualized (visible-lines-only) render, so read-back is
    // deterministic regardless of where the editor opened / scrolled.
    await page.locator("[data-node-editor-panel] .monaco-editor").click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("x = 1 + 2");

    await expect(page.locator("[data-node-editor-panel]"))
      .toHaveAttribute("data-dirty", "true", { timeout: 5_000 });

    // The spaced statement must be present verbatim - if the spacebar were
    // swallowed it would read "x=1+2". Monaco may render spaces as
    // non-breaking spaces (char 160), so normalize those to plain spaces.
    const raw = await page.locator("[data-node-editor-panel] .monaco-editor").innerText();
    const normalized = [...raw].map((c) => (c.charCodeAt(0) === 160 ? " " : c)).join("");
    expect(normalized, "spaces were dropped - spacebar swallowed").toContain("x = 1 + 2");
    expect(normalized).not.toContain("x=1+2");

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
