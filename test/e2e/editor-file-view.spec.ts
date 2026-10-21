/**
 * The side editor (2026-10-20, Ben):
 *   - a function is a VIEW of its file, not a snippet of its own: the editor's
 *     model is the whole file at its path, the function's lines are shown with
 *     the file's line numbers, and the language service checks it in its file
 *     (as a snippet, `queryUsers` — imported above the function — read
 *     "Cannot find name");
 *   - the breadcrumb's file segment opens the whole file; the function's
 *     segment returns to it;
 *   - the splitter between the code and the docked Claude chat moves it up
 *     and down, and the height is remembered.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/jsts/api_demo VG_PORT=4277 PORT=4277 \
 *     npx playwright test test/e2e/editor-file-view.spec.ts --reporter=list --workers=1
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const REVIEW_DIR = join(process.cwd(), "reviews", "editor-file-view");

const lineNumbers = async (page: Page) =>
  [...new Set((await page.locator("[data-node-editor-panel] .line-numbers").allInnerTexts()).map((s) => Number(s.trim())).filter((n) => n > 0))].sort((a, b) => a - b);

async function openListUsers(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
  await page.click('[data-thread-index-row][data-entry-id="server.ts:listUsers"]');
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(700);
  await page.locator(".vg-thread-node-seed").first().click();
  await expect(page.locator("[data-node-editor-panel]")).toBeVisible({ timeout: 10_000 });
  await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line", { timeout: 10_000 });
}

test.describe("the side editor: one file, several views", () => {
  test.skip(!FIXTURE.includes("jsts/api_demo"), "Requires VG_FIXTURE=test/fixtures/jsts/api_demo");

  test("a function is a view of its file; the breadcrumb opens the file and returns", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openListUsers(page);

    // the function's own lines, numbered as the file numbers them (11–17)
    await expect(page.locator("[data-editor-fn-name]")).toHaveAttribute("data-current", "true");
    await expect(page.locator("[data-editor-crumb-file]")).toHaveText("server.ts");
    await expect(page.locator("[data-editor-crumb-file]")).toHaveAttribute("data-current", "false");
    await expect.poll(() => lineNumbers(page)).toEqual([11, 12, 13, 14, 15, 16, 17]);

    // the model is the whole file, at its path; nothing in it is flagged
    await page.waitForTimeout(2500); // the TypeScript worker
    const diag = await page.evaluate(() => {
      const m = (window as unknown as { monaco: any }).monaco;
      const models = m.editor.getModels();
      const file = models.find((x: any) => x.uri.toString() === "file:///server.ts");
      const showing = models.filter((x: any) => x.getValue().includes("queryUsers(25)"));
      return {
        file: !!file && file.getValue().includes("app.listen(3000)"),
        // the red underlines are the ERRORS (hints — "could be inferred",
        // an unused parameter faded — are not underlined red)
        markers: showing.flatMap((x: any) => m.editor.getModelMarkers({ resource: x.uri }))
          .filter((k: any) => k.severity === m.MarkerSeverity.Error)
          .map((k: any) => `${typeof k.code === "object" ? k.code?.value : k.code}: ${k.message}`),
      };
    });
    expect(diag.file, "the editor's model is the whole file, named as the file").toBe(true);
    expect(diag.markers, "queryUsers is imported above the function: not an error in its file").toEqual([]);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "1-function-view.png") });

    // the cursor stays in the view: Ctrl+End is the function's end, not the
    // file's (typing in the hidden lines would edit text nobody can see)
    await page.locator("[data-node-editor-panel] .monaco-editor").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" // kept-in-view");
    await expect(page.locator("[data-node-editor-panel] .view-lines")).toContainText("kept-in-view");
    await expect(page.locator("[data-editor-save]")).toBeEnabled();
    await page.locator("[data-editor-cancel]").click();
    await expect(page.locator("[data-node-editor-panel] .view-lines")).not.toContainText("kept-in-view");
    await expect(page.locator("[data-node-editor-panel]")).toHaveAttribute("data-dirty", "false");
    await expect.poll(() => lineNumbers(page)).toEqual([11, 12, 13, 14, 15, 16, 17]);

    // the file segment opens the whole file
    await page.locator("[data-editor-crumb-file]").click();
    await expect(page.locator("[data-editor-crumb-file]")).toHaveAttribute("data-current", "true");
    await expect(page.locator("[data-editor-fn-name]")).toHaveAttribute("data-current", "false");
    await expect.poll(async () => (await lineNumbers(page))[0]).toBe(1);
    await expect(page.locator("[data-node-editor-panel] .view-lines")).toContainText('import { queryUsers, insertUser } from "./db";');
    await page.screenshot({ path: join(REVIEW_DIR, "2-file-view.png") });

    // and the function's segment returns to it
    await page.locator("[data-editor-fn-name]").click();
    await expect.poll(() => lineNumbers(page)).toEqual([11, 12, 13, 14, 15, 16, 17]);
    await expect(page.locator("[data-editor-fn-name]")).toHaveAttribute("data-current", "true");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the splitter moves the chat up and down, and the height is remembered", async ({ page }) => {
    await openListUsers(page);
    const chat = page.locator("[data-chat-panel]");
    const splitter = page.locator("[data-chat-splitter]");
    await expect(splitter).toBeVisible();
    const before = (await chat.boundingBox())!.height;
    const s = (await splitter.boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2 - 150, { steps: 8 });
    await page.mouse.up();
    const after = (await chat.boundingBox())!.height;
    expect(after).toBeGreaterThan(before + 120);
    // the editor above gave up the room: its bottom edge sits on the chat's top
    const panel = (await page.locator("[data-node-editor-panel]").boundingBox())!;
    const chatTop = (await chat.boundingBox())!.y;
    expect(Math.abs(panel.y + panel.height - chatTop)).toBeLessThan(4);
    await page.screenshot({ path: join(REVIEW_DIR, "3-chat-raised.png") });

    // the keyboard moves it too
    await splitter.focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => Math.round((await chat.boundingBox())!.height)).toBe(Math.round(after - 24));

    // remembered across a reload
    const kept = Math.round((await chat.boundingBox())!.height);
    await openListUsers(page);
    await expect.poll(async () => Math.round((await page.locator("[data-chat-panel]").boundingBox())!.height)).toBe(kept);
  });
});
