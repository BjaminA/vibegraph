/**
 * File view CODE mode (2026-09-24). Ben: a toggle to turn off the card
 * ("bubble") view — the same grouping, each block as the actual code,
 * highlighted as the editor shows it, so the file reads more compactly.
 *
 * Boot with VG_FIXTURE=test/fixtures/threads/big_demo (utils.py: imports,
 * module state, and helpers called by login_url / login_remembered).
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_demo"), "Requires VG_FIXTURE=test/fixtures/threads/big_demo");
const REVIEW_DIR = join(process.cwd(), "reviews", "fileview-code-mode");

async function openUtils(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
  await page.click('[data-side-panel-tab="files"]');
  await page.click('[data-file-tree-row="utils.py"]');
  await page.waitForSelector('.react-flow__node[data-id="module/login_url.fn"]', { timeout: 15_000 });
}

test.describe("file view — cards / code toggle", () => {
  test("code mode shows each top-level block as highlighted source, grouped the same way; it persists", async ({ page }) => {
    await openUtils(page);
    await page.evaluate(() => localStorage.removeItem("vg-file-view-mode"));
    await expect(page.locator('[data-fileview-mode="cards"]')).toBeVisible();
    const cardCount = await page.locator(".react-flow__node").count();

    await page.locator('[data-fileview-mode-option="code"]').click();
    await expect(page.locator('[data-fileview-mode="code"]')).toBeVisible();
    const login = page.locator('.react-flow__node[data-id="module/login_url.fn"] [data-code-block]');
    await expect(login).toBeVisible({ timeout: 10_000 });
    await expect(login).toContainText("def login_url(");
    // Highlighted by the editor's own colorizer (Monaco token spans).
    await expect(login.locator("[data-code-block-body] span[class^='mtk']").first()).toBeAttached({ timeout: 10_000 });
    // The imports are ONE block; nested statements are not blocks.
    await expect(page.locator('.react-flow__node[data-id="code:imports"]')).toHaveCount(1);
    const blocks = await page.locator("[data-code-block]").count();
    expect(blocks, "fewer nodes than the card view: one per top-level block").toBeLessThan(cardCount);
    // The same grouping: imports left of the definitions.
    const x = async (id: string) => (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!.x;
    expect(await x("code:imports")).toBeLessThan(await x("module/login_url.fn"));
    // Every block holds all of its code: nothing scrolls, nothing is cut
    // (2026-09-25 — the box is sized from the lines' measured width).
    const clipped = await page.evaluate(() => [...document.querySelectorAll("[data-code-block]")].flatMap((blk) => {
      const body = blk.querySelector("[data-code-block-body]") as HTMLElement;
      const row = body.parentElement as HTMLElement;
      const b = blk.getBoundingClientRect(), r = body.getBoundingClientRect();
      const z = b.width / (blk as HTMLElement).offsetWidth;
      const overW = (r.left - b.left) / z + body.scrollWidth - (blk as HTMLElement).clientWidth;
      const overH = row.scrollHeight - row.clientHeight;
      return overW > 0.5 || overH > 0.5 ? [`${blk.closest(".react-flow__node")?.getAttribute("data-id")} w+${overW} h+${overH}`] : [];
    }));
    expect(clipped, "code blocks cut short").toEqual([]);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "code-mode.png") });

    // Remembered per viewer.
    await page.reload();
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="utils.py"]');
    await expect(page.locator('[data-fileview-mode="code"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-code-block]").first()).toBeVisible({ timeout: 10_000 });

    // And back to cards.
    await page.locator('[data-fileview-mode-option="cards"]').click();
    await expect(page.locator("[data-code-block]")).toHaveCount(0);
    await expect(page.locator('.react-flow__node[data-id="module/login_url.fn"]')).toBeVisible();
    await page.evaluate(() => localStorage.removeItem("vg-file-view-mode"));
  });
});
