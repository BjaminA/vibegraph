/**
 * M18.1 — <NodeEditorPanel> scaffold (PLAN-v3-revised §F).
 *
 * Gate (§F): "Click any node → panel opens with correct enclosing
 * function loaded; toggle switches modes; Save is a no-op."
 *
 * This spec paints the living renderer (per the test-the-living-renderer
 * rule — emitter equality isn't enough for a UI shell) and asserts:
 *   1. The toolbar Edit toggle opens the panel; with nothing selected it
 *      shows the empty state.
 *   2. Clicking the cli:main seed loads its *enclosing function* (main)
 *      into an editable Monaco — breadcrumb names the function, the
 *      editor shows the real source slice.
 *   3. The panel is Edit-only (M28.3): Intent mode is parked, so there's
 *      no mode toggle / composer — and the chat is docked beneath it.
 *   4. Editing then switching selection mid-edit raises the dirty-guard
 *      prompt; Discard & switch loads the new function.
 *
 * Gated on flask_demo: directory mode + a multi-function thread
 * (cli:main calls cmd_list / cmd_create) is what the panel needs.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m18-1-editor-panel.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect, type Page } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

// Open the cli:main thread and click its seed so the editor loads main().
async function openMainInEditor(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
  await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(700); // settle layout / fitView
  // Clicking the seed publishes vg-selection (source "thread"); App
  // auto-opens the editor and loads the enclosing function.
  await page.locator(".vg-thread-node-seed").first().click();
  await expect(page.locator("[data-node-editor-panel]")).toBeVisible({ timeout: 5_000 });
  await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line",
    { timeout: 10_000 });
}

test.describe("M18.1 — node editor panel scaffold", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("toolbar Edit opens the panel; empty until a node is selected", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const panel = page.locator("[data-node-editor-panel]");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    // Nothing selected yet → empty state, no Monaco.
    await expect(page.locator("[data-editor-empty]")).toBeVisible();
    await expect(page.locator("[data-editor-fn-name]")).toHaveText("select a node");
  });

  test("clicking the seed loads its enclosing function (main) into Monaco", async ({ page }) => {
    await openMainInEditor(page);

    // Breadcrumb names the enclosing function and the file.
    await expect(page.locator("[data-editor-fn-name]")).toHaveText("main");
    await expect(page.locator("[data-editor-breadcrumb]")).toContainText("cli.py");

    // The editor shows main()'s real source slice (lines 24-35 of cli.py),
    // which contains the ArgumentParser construction — proof the right
    // function span was sliced, not the whole file or a sibling.
    const panel = page.locator("[data-node-editor-panel]");
    await expect(panel).toContainText("argparse.ArgumentParser", { timeout: 5_000 });
    // And NOT the body of a sibling that isn't in main's span.
    await expect(panel).not.toContainText("def cmd_list");
  });

  test("editor is Edit-only — Intent mode is parked (M28.3)", async ({ page }) => {
    await openMainInEditor(page);

    // M28.3 — Intent (one-shot single-function rewrite) was a subset of the
    // Claude chat now docked under this column, so it's unmounted: no mode
    // toggle, no Intent composer. The panel is Edit-only.
    await expect(page.locator("[data-editor-mode-toggle]")).toHaveCount(0);
    await expect(page.locator("[data-editor-intent]")).toHaveCount(0);
    await expect(page.locator("[data-node-editor-panel]")).toHaveAttribute("data-mode", "edit");
    // The editable Monaco is the whole surface.
    await expect(page.locator("[data-node-editor-panel] .monaco-editor .view-line").first())
      .toBeVisible({ timeout: 5_000 });

    // And the chat is docked beneath it, present without a toggle click.
    await expect(page.locator("[data-chat-panel]")).toBeVisible({ timeout: 5_000 });
  });

  test("editing then switching selection raises the dirty-guard prompt", async ({ page }) => {
    await openMainInEditor(page);
    const panel = page.locator("[data-node-editor-panel]");

    // Type into Monaco → panel goes dirty.
    await panel.locator(".view-line").first().click();
    await page.keyboard.type("# dirty-edit\n");
    await expect(panel).toHaveAttribute("data-dirty", "true", { timeout: 5_000 });

    // Switch selection to a sibling function (cmd_list) via the same
    // selection bus a thread-node click uses. Done programmatically to
    // avoid hit-testing a node that the 44%-wide panel may overlap.
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("vg-selection", {
        detail: { filePath: "cli.py", irNodeId: "module/cmd_list.fn", source: "thread" },
      }));
    });

    // Dirty-guard prompt appears instead of silently discarding.
    const prompt = page.locator("[data-editor-dirty-prompt]");
    await expect(prompt).toBeVisible({ timeout: 5_000 });
    await expect(prompt).toContainText("cmd_list");

    // Discard & switch → prompt clears and cmd_list loads.
    await prompt.getByText("Discard & switch").click();
    await expect(prompt).toHaveCount(0);
    await expect(page.locator("[data-editor-fn-name]")).toHaveText("cmd_list", { timeout: 5_000 });
    await expect(panel).toContainText("list_users", { timeout: 5_000 });
  });
});
