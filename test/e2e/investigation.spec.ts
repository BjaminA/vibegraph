/**
 * The investigation board (2026-09-29) on flask_demo: pin a node from the
 * tooltip (the board opens with it), write a note, hand off — the handoff
 * carries the note and the code, and lands in
 * `.vibegraph/investigations/<name>.md` beside the saved `.json`.
 *
 *   npm run test:e2e-investigation
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

// Clicking a card opens the editor; the tooltip opens on HOVER (u3-hover-pin).
async function pinFromTooltip(page: Page, node: Locator) {
  await page.mouse.move(2, 2);
  await node.hover({ force: true });
  const tooltip = page.locator("[data-thread-tooltip]");
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await tooltip.locator("[aria-label='Pin']").click();
  await tooltip.locator("[data-investigate-pin]").click();
  await tooltip.locator("[aria-label='Close tooltip']").click();
}
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const DIR = join(process.cwd(), FIXTURE, ".vibegraph", "investigations");

test.describe("investigation board", () => {
  test.skip(!FIXTURE.includes("flask_demo"), "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");
  test.beforeAll(() => rmSync(DIR, { recursive: true, force: true }));
  test.afterAll(() => rmSync(DIR, { recursive: true, force: true }));

  test("pin from a tooltip, note it, hand it off", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // The seed: a function with a file, on screen at fit zoom.
    const card = page.locator(".vg-thread-node-seed").first();
    await pinFromTooltip(page, card);

    const board = page.locator("[data-investigation-panel]");
    await expect(board).toBeVisible();
    await expect(board.locator("[data-investigation-pin]")).toHaveCount(1);
    await expect(board.locator("[data-investigation-select]")).toHaveValue(/^investigation-\d{8}$/);

    await board.locator("[data-investigation-question]").fill("Why is the row written twice?");
    await board.locator("[data-investigation-note]").first().fill("no unique constraint on email");
    await board.locator("[data-investigation-question]").click(); // blur the note: saved
    await board.locator("[data-investigation-handoff]").click();
    const text = board.locator("[data-investigation-handoff-text] pre");
    await expect(text).toContainText("Why is the row written twice?");
    await expect(text).toContainText("> no unique constraint on email");
    await expect(text).toContainText("def main(");

    const files = readdirSync(DIR);
    const md = files.find((f) => f.endsWith(".md"))!;
    expect(files).toContain(md.replace(/\.md$/, ".json"));
    expect(readFileSync(join(DIR, md), "utf-8")).toContain("pinned on the thread `cli.py:main`");

    // Pinning the same node again does not duplicate it; the toolbar closes the board.
    await pinFromTooltip(page, card);
    await expect(board.locator("[data-investigation-pin]")).toHaveCount(1);
    await page.locator("[data-investigate-toggle]").click();
    await expect(board).toHaveCount(0);

    // Delete clears it from disk.
    await page.locator("[data-investigate-toggle]").click();
    await page.locator("[data-investigation-delete]").click();
    await expect(page.locator("[data-investigation-pin]")).toHaveCount(0);
    expect(existsSync(join(DIR, md.replace(/\.md$/, ".json")))).toBe(false);
  });
});
