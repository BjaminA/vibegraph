/**
 * PARKED (M28.3) — Intent / "Mode B" was unmounted from the editor panel:
 * it was a strict subset of the Claude chat now docked under the code
 * column. The server place-intent path + place_intent.py stay on disk
 * (park-don't-delete), and this spec stays as the historical record, but
 * it's skipped and dropped from the test:e2e-flask runner because the
 * mode toggle / Intent composer it drives no longer render. Re-enable only
 * if Intent mode is ever re-mounted. (Same pattern as u3-hover-pin.)
 *
 * M18.5 — Mode B end-to-end (PLAN-v3-revised §F).
 *
 * Gate: "open a node, switch to Intent, type 'add a gender argument to the
 * create subparser', see gender=None appear in Monaco, Save, see arg added
 * in code view." This is the living-renderer test for the whole Mode B
 * loop: intent → Tier 1 heuristic placer → server dry-runs the op and
 * slices the new enclosing function as a preview → the proposal loads into
 * Edit-mode Monaco (the human-approval gate) → Save commits via the Mode A
 * path → the file changes on disk.
 *
 * This canonical intent is Tier-1 handled (place_intent's add_argument
 * rule), so the test is deterministic — no live LLM. The Tier 2 claude -p
 * fallback is wired but not exercised here (it may be absent in CI).
 *
 * Mutates the flask_demo cli.py fixture, so the original bytes are captured
 * up front and restored in afterAll.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m18-5-mode-b.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const CLI_PATH = join(process.cwd(), FIXTURE, "cli.py");
const SHOT_DIR = "reviews/m18-mode-b";

test.use({ video: "on" });

test.describe("M18.5 — Mode B end-to-end", () => {
  // M28.3 — Intent mode parked; the affordances this spec drives no longer
  // render. Skipped wholesale (see the park note in the file header).
  test.skip(true, "Intent mode parked in M28.3 — see file header");

  let original = "";
  test.beforeAll(() => {
    original = readFileSync(CLI_PATH, "utf-8");
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    writeFileSync(CLI_PATH, original, "utf-8");
  });

  test("intent → heuristic proposal previews in Monaco, Save commits it", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // Open main in the editor, then switch to Intent mode.
    await page.locator(".vg-thread-node-seed").first().click();
    await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line", { timeout: 10_000 });
    await page.locator('[data-editor-mode-btn="intent"]').click();
    await expect(page.locator("[data-editor-intent]")).toBeVisible();

    // Describe the change and generate.
    await page.locator("[data-editor-intent-input]").fill("add a gender argument to the create subparser");
    await page.screenshot({ path: join(SHOT_DIR, "intent-typed.png") });
    await page.locator("[data-editor-intent-generate]").click();

    // The proposal loads into Edit-mode Monaco with gender=None applied.
    await expect(page.locator("[data-node-editor-panel]"))
      .toHaveAttribute("data-mode", "edit", { timeout: 15_000 });
    const panel = page.locator("[data-node-editor-panel]");
    await expect(panel).toContainText("gender=None", { timeout: 10_000 });
    await expect(page.locator("[data-editor-note]")).toContainText("Proposed");
    await page.screenshot({ path: join(SHOT_DIR, "proposal-in-monaco.png") });

    // Human-approval gate: Save commits via the Mode A path.
    await expect(panel).toHaveAttribute("data-dirty", "true");
    await page.locator("[data-editor-save]").click();
    await expect(panel).toHaveAttribute("data-dirty", "false", { timeout: 10_000 });
    await expect(page.locator("[data-editor-save-error]")).toHaveCount(0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOT_DIR, "after-save.png") });

    // The argument really landed on disk.
    expect(readFileSync(CLI_PATH, "utf-8")).toContain("gender=None");
    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
