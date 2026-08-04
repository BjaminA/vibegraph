/**
 * M15.3 — verify file-placement heuristics route a new route handler
 * to app.py even when the user drops in cli.py.
 *
 * Success criterion (PLAN-v4 §3 / M15.2 Done clause):
 *   - Open cli.py's file diagram view.
 *   - Drag a Function kind into module scope (the canvas, no node target).
 *   - In the modal, edit the template to include `@app.route("/new")`.
 *   - The "Will write to:" footer reads `app.py` (the file containing
 *     existing @app.route handlers), NOT `cli.py`.
 *   - Click Insert.
 *   - app.py on disk has the new function; cli.py is unchanged.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m15-placement.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const APP_PY = FIXTURE ? path.resolve(FIXTURE, "app.py") : null;
const CLI_PY = FIXTURE ? path.resolve(FIXTURE, "cli.py") : null;

test.describe("M15.3 — file-placement heuristics", () => {
  test.skip(!IS_FLASK, "Needs VG_FIXTURE=test/fixtures/threads/flask_demo");

  let savedApp: string | null = null;
  let savedCli: string | null = null;

  test.beforeAll(() => {
    if (APP_PY) savedApp = readFileSync(APP_PY, "utf-8");
    if (CLI_PY) savedCli = readFileSync(CLI_PY, "utf-8");
  });
  test.afterAll(() => {
    if (APP_PY && savedApp != null) writeFileSync(APP_PY, savedApp, "utf-8");
    if (CLI_PY && savedCli != null) writeFileSync(CLI_PY, savedCli, "utf-8");
  });

  test("route handler dropped in cli.py is re-routed to app.py", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "warning" || msg.type() === "error") {
        console.log(`[webview ${msg.type()}]`, msg.text());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open cli.py's diagram view.
    await page.locator('[data-side-panel-tab="files"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-file-tree-row="cli.py"]').click();
    await page.waitForTimeout(1200);

    // Find a top-level node we can drop ON to trigger the add flow.
    // Use the `import argparse` import node; dropping a Function on a
    // non-body target falls through to ambiguous → user picks "after".
    // Actually simpler: drop on the main() function_def's HEADER area.
    // M14's gap-snap handles function_def targets; for an empty body
    // it sets data-resolved-position="inside_end". For a populated
    // body, the snap chooses a child gap. Either way the modal opens.
    const mainFn = page.locator('.react-flow__node[data-id="module/main.fn"]');
    await mainFn.waitFor({ state: "visible", timeout: 5_000 });
    const mainBox = await mainFn.boundingBox();
    if (!mainBox) throw new Error("no main.fn bounding box");

    // + Add → Function.
    await page.getByRole("button", { name: /add/i }).filter({ hasText: "Add" }).click();
    await page.locator('[role="menu"]').getByRole("menuitem", { name: /^Function$/ }).click();
    await page.waitForTimeout(150);

    // Drop on main()'s header (above the first child).
    const targetX = mainBox.x + mainBox.width / 2;
    const targetY = mainBox.y + 12;  // header strip
    await page.mouse.move(targetX, targetY - 50, { steps: 4 });
    await page.mouse.move(targetX, targetY, { steps: 6 });
    await page.waitForTimeout(300);
    await page.mouse.move(targetX + 1, targetY);
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(400);

    // Modal opens.
    const modal = page.locator('[role="dialog"][aria-label*="Add"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: "test-results/m15-modal-before-edit.png", fullPage: true });

    // Set Monaco's content via executeEdits — emits
    // onDidChangeModelContent, which @monaco-editor/react listens to
    // and forwards as onChange. The keyboard.type path eats spaces
    // after keywords (suspect: Monaco's word-boundary handling),
    // which executeEdits avoids.
    await page.evaluate(() => {
      const monaco = (window as any).monaco;
      const editors = monaco?.editor?.getEditors?.() ?? [];
      const editor = editors[editors.length - 1];
      if (!editor) throw new Error("no monaco editor found");
      const model = editor.getModel();
      const newText =
        '@app.route("/m15_smoke")\n' +
        'def m15_smoke():\n' +
        '    return "ok"\n';
      editor.executeEdits("m15-test", [{
        range: model.getFullModelRange(),
        text: newText,
        forceMoveMarkers: true,
      }]);
    });
    // Wait for source state to update + the debounced placement WS
    // round-trip to complete (200ms debounce + spawn + reply).
    await page.waitForTimeout(1500);

    // Verify "Will write to:" footer says app.py.
    await page.screenshot({ path: "test-results/m15-modal-after-edit.png", fullPage: true });
    const placementText = await modal.locator('[data-modal-placement-row]').textContent();
    console.log("=== M15.3 PLACEMENT ROW ===");
    console.log("  ", placementText);
    expect(placementText, "Will-write-to row should mention app.py").toContain("app.py");

    // Insert.
    await page.getByRole("button", { name: /Insert/i }).click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(300);

    // app.py on disk has the new function.
    if (!APP_PY || !CLI_PY) throw new Error("paths missing");
    const newApp = readFileSync(APP_PY, "utf-8");
    const newCli = readFileSync(CLI_PY, "utf-8");
    console.log("=== app.py diff sniff ===");
    console.log(newApp.split("\n").slice(-12).join("\n"));

    expect(newApp).toContain("m15_smoke");
    expect(newApp).toContain('@app.route("/m15_smoke")');
    // cli.py MUST be unchanged.
    expect(newCli, "cli.py should be untouched").toBe(savedCli);
    // Original app.py route handlers must still be present.
    expect(newApp).toContain("list_users_route");
    expect(newApp).toContain("get_user_route");
    expect(newApp).toContain("create_user_route");
  });
});
