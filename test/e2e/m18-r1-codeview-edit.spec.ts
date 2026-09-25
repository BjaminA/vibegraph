/**
 * M18 refinement #1 + #3 — CodeView as a live, edit-routing surface.
 *
 * Two coupled behaviours, one flow:
 *  - #3 side-by-side: with the editor panel AND CodeView both open, the two
 *    right-edge surfaces tile (App-computed docks) instead of stacking — so
 *    neither occludes the other and the thread canvas stays visible.
 *  - #1 / R-1a: after a Mode A save, the *open* CodeView re-renders from the
 *    rebroadcast envelope (it shows raw file text, not IR, so it needs an
 *    explicit re-fetch). Pre-fix it showed stale source until re-navigation.
 *
 * Flow: open cli.py:main thread → click seed (editor opens) → open CodeView
 * (now co-open + tiled) → assert both visible and CodeView clean → insert a
 * unique marker in main(), Save → assert the marker appears in the still-open
 * CodeView (live refresh) and on disk.
 *
 * REAL edit to flask_demo/cli.py — original bytes captured up front and
 * restored in afterAll (vibegraph-fixtures: never leave a fixture dirty).
 *
 * This header used to claim "cli.py is 39 lines, so it fits the Monaco
 * viewport whole — no line virtualisation to defeat the text assertion."
 * That was never true, only nearly true: the dock rendered ~23 of the 39
 * lines and the assertion targets line 24, so the test passed by ONE line.
 * It went red the day the dock started reserving the toolbar's real
 * (wrapped) height instead of a hardcoded 48px. See revealTail below — the
 * claims under test are the content and the live refresh, neither of which
 * is about how many lines fit.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m18-r1-codeview-edit.spec.ts --reporter=list --workers=1
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const CLI_PATH = join(process.cwd(), FIXTURE, "cli.py");
const SHOT_DIR = "reviews/m18-codeview-edit";
const MARKER = 'open("/tmp/r1.txt")';

test.use({ video: "on" });

/** Scroll CodeView's Monaco to the tail before asserting on its text.
 *
 *  Monaco VIRTUALIZES: only the lines currently in the viewport exist in the
 *  DOM, so an unscrolled `toContainText` on this dock is really an assertion
 *  about the dock's pixel height. Called again after Save because a
 *  re-render from the new envelope may return Monaco to the top. */
async function revealTail(page: Page) {
  await page.locator("[data-code-view] .monaco-editor").hover();
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(250);
}

test.describe("M18 #1/#3 — CodeView edit-routing + live refresh", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  let original = "";
  test.beforeAll(() => {
    original = readFileSync(CLI_PATH, "utf-8");
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    writeFileSync(CLI_PATH, original, "utf-8");
  });

  test("editor + CodeView tile side-by-side; save live-refreshes CodeView", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // Open the editor on main() first (clean click, no panels covering the
    // canvas yet), then open CodeView so the two are co-open.
    await page.locator(".vg-thread-node-seed").first().click();
    const panel = page.locator("[data-node-editor-panel]");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line", { timeout: 10_000 });

    await page.locator('button[title="Show source for the active file"]').click();
    const codeView = page.locator("[data-code-view]");
    await expect(codeView).toBeVisible({ timeout: 5_000 });
    await page.waitForSelector("[data-code-view] .monaco-editor .view-line", { timeout: 10_000 });

    // #3 — both surfaces visible at once (tiled, not stacked/occluded).
    await expect(panel).toBeVisible();
    await expect(codeView).toBeVisible();
    // CodeView shows the real file and is clean (no marker yet).
    await revealTail(page);
    await expect(codeView).toContainText("def main():");
    await expect(codeView).not.toContainText(MARKER);
    await page.screenshot({ path: join(SHOT_DIR, "side-by-side.png") });

    // Edit main() in the panel — marker as the first body line.
    await page.locator("[data-node-editor-panel] .monaco-editor").click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(MARKER);
    await expect(panel).toHaveAttribute("data-dirty", "true", { timeout: 5_000 });

    // Save → op_replace_function_body → envelope rebroadcast.
    await page.locator("[data-editor-save]").click();
    await expect(panel).toHaveAttribute("data-dirty", "false", { timeout: 10_000 });
    await expect(page.locator("[data-editor-save-error]")).toHaveCount(0);

    // R-1a — the STILL-OPEN CodeView re-renders from the new envelope.
    await revealTail(page);
    await expect(codeView).toContainText(MARKER, { timeout: 10_000 });
    await page.screenshot({ path: join(SHOT_DIR, "after-save-refreshed.png") });

    // And the edit really landed on disk.
    expect(readFileSync(CLI_PATH, "utf-8")).toContain(MARKER);
    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  // Reported from the C++ project: "clicking on the code view opens up
  // another to the side". A click in CodeView publishes a selection, which
  // auto-opens the editor panel — and a TOP-LEVEL line (an import, a
  // constant) has no enclosing function, so the panel resolved to the whole
  // MODULE and loaded the same file the CodeView was already showing. Two
  // identical Monacos, side by side. The rule now: the editor panel never
  // targets the module of the file the code panel is already showing.
  test("a top-level click in CodeView never opens a second editor of the same file", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // Open cli.py in CodeView with the editor panel CLOSED.
    await page.locator('[data-thread-index-row][data-entry-id="cli.py:main"]').click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^Code$/ }).click();
    const codeView = page.locator("[data-code-view]");
    await expect(codeView).toBeVisible({ timeout: 10_000 });
    await page.waitForSelector("[data-code-view] .monaco-editor .view-line", { timeout: 15_000 });
    const panel = page.locator("[data-node-editor-panel]");

    const clickLine = async (lineNumber: number) => {
      await page.evaluate((n) => {
        const ed = (window as unknown as { monaco: { editor: { getEditors(): { focus(): void; setPosition(p: { lineNumber: number; column: number }): void }[] } } })
          .monaco.editor.getEditors()[0];
        ed.focus();
        ed.setPosition({ lineNumber: n, column: 1 });
      }, lineNumber);
      await page.waitForTimeout(900);
    };

    // cli.py line 1 is an import — top level, no enclosing function.
    await clickLine(1);
    await expect(panel).toHaveCount(0);

    // A line INSIDE a function still opens the editor on that function:
    // the useful path is untouched, only the redundant one is dropped.
    const fnLine = readFileSync(CLI_PATH, "utf-8").split("\n")
      .findIndex((l) => l.trim().startsWith("def ")) + 2;
    await clickLine(fnLine);
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const targeted = ((await panel.innerText()) ?? "").replace(/\s+/g, " ");
    expect(targeted).not.toContain("(module)");

    // And a top-level click with the panel OPEN leaves it on that function
    // rather than flipping it to the whole file.
    await clickLine(1);
    await page.waitForTimeout(900);
    await expect(panel).toBeVisible();
    expect(((await panel.innerText()) ?? "").replace(/\s+/g, " ")).not.toContain("(module)");
    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
