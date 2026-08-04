/**
 * M18.3 — Mode A end-to-end (PLAN-v3-revised §F).
 *
 * Gate: "open cli.py:main, type a call mid-function, save, see new call
 * node appear." This is the living-renderer test for the whole Mode A
 * loop: panel Save → op_replace_function_body on the server → file
 * re-parsed + threads re-extracted → project-update → the open thread
 * re-derives and the new node animates in.
 *
 * §F's example is print("hello"); we use a distinct call (open(...))
 * instead because the cli:main thread already has a `print` node (from
 * cmd_list), and the extractor dedupes external terminals by target — so
 * a second print would be invisible to a node-count assertion. open() is
 * unique, making "a new node appeared" genuinely observable. (Static
 * analysis only — the edited code is never executed.)
 *
 * It performs a REAL edit to the flask_demo cli.py fixture on disk, so the
 * original bytes are captured up front and restored in afterAll — the
 * fixture must stay canonical (vibegraph-fixtures: never leave a fixture
 * dirty).
 *
 * Gated on flask_demo. Video is recorded (relocated to reviews/m18-mode-a/
 * after the run); before/after stills are captured inline.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m18-3-mode-a.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const CLI_PATH = join(process.cwd(), FIXTURE, "cli.py");
const SHOT_DIR = "reviews/m18-mode-a";

test.use({ video: "on" });

test.describe("M18.3 — Mode A end-to-end", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  let original = "";
  test.beforeAll(() => {
    original = readFileSync(CLI_PATH, "utf-8");
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    // Restore the fixture to its canonical bytes regardless of outcome.
    writeFileSync(CLI_PATH, original, "utf-8");
  });

  test("editing main() and saving makes a new node appear in the thread", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    const nodes = page.locator(".vg-thread-node");
    const before = await nodes.count();

    // Click the seed (main) → editor opens with main() loaded.
    await page.locator(".vg-thread-node-seed").first().click();
    await expect(page.locator("[data-node-editor-panel]")).toBeVisible({ timeout: 5_000 });
    await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line", { timeout: 10_000 });
    await page.screenshot({ path: join(SHOT_DIR, "before-save.png") });

    // Type `print("hello")` as the first body line, the way a user would:
    // cursor to end of the `def main():` line, Enter (Monaco auto-indents
    // into the block), then the statement. Letting Monaco own the indent
    // avoids the double-indent that literal multi-line paste produces.
    await page.locator("[data-node-editor-panel] .monaco-editor").click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type('open("/tmp/m18.txt")');
    await expect(page.locator("[data-node-editor-panel]")).toHaveAttribute("data-dirty", "true", { timeout: 5_000 });

    // Save → commits through op_replace_function_body.
    await page.locator("[data-editor-save]").click();

    // Success signal is the STABLE dirty=false (the "Saved" note is
    // transient, auto-clearing after ~2s) + no inline error.
    await expect(page.locator("[data-node-editor-panel]"))
      .toHaveAttribute("data-dirty", "false", { timeout: 10_000 });
    await expect(page.locator("[data-editor-save-error]")).toHaveCount(0);
    // The re-extracted thread gains the new `open` node and re-renders.
    await expect
      .poll(async () => nodes.count(), { timeout: 10_000, message: "thread should gain a node after save" })
      .toBeGreaterThan(before);
    // M-NA7 — semantic zoom hides non-landmark label text at overview
    // zoom, so identify the node by its stable data-id, not text.
    const newNode = page.locator('.react-flow__node[data-id="external:open"] .vg-thread-node-external').first();
    await expect(newNode).toBeVisible({ timeout: 5_000 });

    // M10R follow-up — drawn is not enough: without a re-fit on thread
    // growth the new node can land outside the viewport (fitView last
    // ran before the edit) and the user reads it as "nothing happened".
    // toBeVisible() passes for off-screen nodes, so assert the node's
    // centre is inside the window viewport.
    await page.waitForTimeout(600); // let the growth re-fit settle
    const bb = await newNode.boundingBox();
    expect(bb, "new node should have a bounding box").not.toBeNull();
    const cx = bb!.x + bb!.width / 2;
    const cy = bb!.y + bb!.height / 2;
    const tv = (await page.locator("[data-thread-view]").boundingBox())!;
    const panelBox = await page.locator("[data-node-editor-panel]").boundingBox();
    const rightEdge = panelBox ? Math.min(tv.x + tv.width, panelBox.x) : tv.x + tv.width;
    expect(cx, "new node centre x inside visible canvas").toBeGreaterThan(tv.x);
    expect(cx, "new node centre x inside visible canvas").toBeLessThan(rightEdge);
    expect(cy, "new node centre y inside visible canvas").toBeGreaterThan(tv.y);
    expect(cy, "new node centre y inside visible canvas").toBeLessThan(tv.y + tv.height);

    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOT_DIR, "after-save.png") });

    // The edit really landed on disk.
    expect(readFileSync(CLI_PATH, "utf-8")).toContain('open("/tmp/m18.txt")');
    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  // M10R follow-up — the user-reported "nothing happens" case: the edit
  // target is a DEEP step (db._get_conn, far end of the L-R cascade),
  // not the seed. The new node extends the thread beyond the previous
  // extent; without a re-fit on thread growth it draws off-viewport and
  // the save looks like a no-op.
  test("editing a deep step re-fits the view so the new node is actually seen", async ({ page }) => {
    const DB_PATH = join(process.cwd(), FIXTURE, "db.py");
    const dbOriginal = readFileSync(DB_PATH, "utf-8");
    try {
      await page.goto("/");
      await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
      await page.click('[data-thread-index-row][data-entry-id="app.py:get_user_route"]');
      await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(700);

      const nodes = page.locator(".vg-thread-node");
      const before = await nodes.count();

      // Click the deep step → editor loads _get_conn. (M-NA7: id-based —
      // label text is tier-dependent under semantic zoom.)
      await page.locator('[data-thread-view] .react-flow__node[data-id="db:_get_conn"]')
        .first().click({ position: { x: 12, y: 12 } });
      await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line", { timeout: 10_000 });

      // First body line: a bare call to a not-yet-existing function —
      // surfaces as an `unresolved` thread node (R3).
      await page.locator("[data-node-editor-panel] .monaco-editor").click();
      await page.keyboard.press("ControlOrMeta+Home");
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("_print_db_path_caps()");
      await expect(page.locator("[data-node-editor-panel]")).toHaveAttribute("data-dirty", "true", { timeout: 5_000 });
      await page.locator("[data-editor-save]").click();
      await expect(page.locator("[data-node-editor-panel]"))
        .toHaveAttribute("data-dirty", "false", { timeout: 10_000 });
      await expect(page.locator("[data-editor-save-error]")).toHaveCount(0);

      await expect
        .poll(async () => nodes.count(), { timeout: 30_000, message: "thread should gain the unresolved node" })
        .toBeGreaterThan(before);
      const newNode = page.locator('.react-flow__node[data-id="unresolved:_print_db_path_caps"] .vg-thread-node').first();
      await expect(newNode).toBeVisible({ timeout: 5_000 });

      await page.waitForTimeout(800); // growth re-fit settles
      const bb = await newNode.boundingBox();
      expect(bb, "new node should have a bounding box").not.toBeNull();
      const cx = bb!.x + bb!.width / 2;
      const cy = bb!.y + bb!.height / 2;
      // "Inside the viewport" must mean the VISIBLE canvas: within the
      // thread view's box AND not buried under the editor panel that
      // overlays/limits its right side.
      const tv = (await page.locator("[data-thread-view]").boundingBox())!;
      const panel = await page.locator("[data-node-editor-panel]").boundingBox();
      const rightEdge = panel ? Math.min(tv.x + tv.width, panel.x) : tv.x + tv.width;
      expect(cx, "new node centre x inside visible canvas").toBeGreaterThan(tv.x);
      expect(cx, "new node centre x inside visible canvas").toBeLessThan(rightEdge);
      expect(cy, "new node centre y inside visible canvas").toBeGreaterThan(tv.y);
      expect(cy, "new node centre y inside visible canvas").toBeLessThan(tv.y + tv.height);
      await page.screenshot({ path: join(SHOT_DIR, "deep-step-after-save.png") });
    } finally {
      writeFileSync(DB_PATH, dbOriginal, "utf-8");
    }
  });
});
