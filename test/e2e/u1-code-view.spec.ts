/**
 * U1.1 — code view fix.
 *
 * Pre-fix bugs (caught here so they don't regress):
 *   (A) Pencil/edit → MonacoOverlay: server's getSourceSnippet falls
 *       back to resolvedPyFile when filePath is missing; in directory
 *       mode that's the project root *directory*, so fs.readFileSync
 *       throws EISDIR and the overlay hangs on "Loading…" forever.
 *   (B) Toolbar Code → CodeView: handleGetFileSource compared the
 *       wire-format relative path against projectParse keys (absolute)
 *       — the `in` check always failed, returning file-source-error.
 *
 * This spec exercises both paths in flask_demo and asserts both
 * populate within a reasonable timeout. Gated on VG_FIXTURE=flask_demo;
 * directory-mode is where the bugs lived.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("U1.1 — code view", () => {
  test.skip(!IS_FLASK,
    "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("pencil edit on a function-def populates MonacoOverlay (directory mode)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    // Drill into db.py so the action strip is reachable on a function-def
    // node.
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="db.py"]');
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });

    // Dispatch vg-edit-node directly to avoid the hover-reveal flake
    // on the NodeActionStrip's pencil button. Same shape as the manual-
    // seed test in m8-manual-seed.spec.ts.
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("vg-edit-node", {
        detail: { nodeId: "module/query.fn" },
      }));
    });

    // MonacoOverlay should mount and populate (not stay on "Loading…").
    const overlay = page.locator("[data-monaco-overlay]");
    await expect(overlay).toBeVisible({ timeout: 5000 });
    // Monaco renders the source via .view-line elements once loaded.
    await page.waitForSelector("[data-monaco-overlay] .monaco-editor .view-line",
      { timeout: 10_000 });
    // Sanity that some recognisable source slice ended up rendered.
    await expect(overlay).toContainText("def query", { timeout: 5_000 });
  });

  test("toolbar Code populates CodeView with the active file (directory mode)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="models.py"]');
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });

    // Click the Code toolbar button — title matches /code/i exact-style.
    await page.getByRole("button", { name: "Code", exact: true }).click();
    const codeView = page.locator("[data-code-view]");
    await expect(codeView).toBeVisible({ timeout: 5000 });
    await page.waitForSelector("[data-code-view] .monaco-editor .view-line",
      { timeout: 10_000 });
    // The file's actual contents should be in the view (find_user is in
    // models.py).
    await expect(codeView).toContainText("find_user", { timeout: 5_000 });
  });
});
