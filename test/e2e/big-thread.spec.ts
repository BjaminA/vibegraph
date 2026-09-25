/**
 * Big threads stay interactive (measured first on a private production codebase's 3,988-step
 * page thread: 13 s to open, 73k DOM elements, panning at ~9 fps).
 *
 * The fixture (scripts/gen_big_thread.mjs) is one TypeScript entry script
 * walking 20 modules × 25 functions: a 1,002-node thread over 21 files,
 * above the fold threshold (thread_fold.ts FOLD_ABOVE).
 *
 *   - only what is on screen is drawn;
 *   - zooming out to the overview tier folds the thread into one card per
 *     file, framed below the toolbar, WITHOUT leaving for the system view;
 *   - clicking a file card jumps into that file's steps (no fly, no system
 *     transition), and clicking a step opens the editor with its code.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/big_thread VG_PORT=4341 PORT=4341 \
 *     npx playwright test test/e2e/big-thread.spec.ts --reporter=list --workers=1
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_thread"), "Requires VG_FIXTURE=test/fixtures/big_thread");
const REVIEW_DIR = join(process.cwd(), "reviews", "big-thread");

const dom = (page: Page) => page.evaluate(() => ({
  nodes: document.querySelectorAll(".react-flow__node").length,
  folded: document.querySelector("[data-thread-folded]")?.getAttribute("data-thread-folded") ?? null,
  zoom: +(document.querySelector("[data-thread-folded] .react-flow__viewport")?.getAttribute("style")?.match(/scale\(([\d.]+)\)/)?.[1] ?? 0),
}));

test("a 1,002-node thread: culled, folds by file, a card jumps in, a step opens its code", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let systemEvents = 0;
  await page.exposeFunction("__vgSystem", () => { systemEvents++; });
  await page.addInitScript(() => document.addEventListener("vg-zoom-to-system", () => (window as unknown as { __vgSystem: () => void }).__vgSystem()));
  await page.goto("/");
  await page.waitForSelector("[data-thread-index-row]", { timeout: 60_000 });
  const banner = page.locator("[data-key-banner]");
  if (await banner.count() > 0) await banner.locator("button").click();
  await page.locator('[data-thread-index-row][data-entry-id="run.ts:main"]').click();
  await page.waitForSelector(".react-flow__node", { timeout: 60_000 });
  await page.waitForTimeout(1500);

  // Drawn: a screenful, not the thread.
  const open = await dom(page);
  expect(open.folded).toBe("false");
  expect(open.nodes).toBeGreaterThan(0);
  expect(open.nodes).toBeLessThan(300);

  // Zoom out: the thread folds by file and stays a thread.
  const pane = await page.locator(".react-flow__pane").boundingBox();
  await page.mouse.move(pane!.x + pane!.width / 2, pane!.y + pane!.height / 2);
  for (let i = 0; i < 30 && (await dom(page)).folded !== "true"; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(600);
  const folded = await dom(page);
  expect(folded.folded).toBe("true");
  expect(folded.zoom).toBeGreaterThanOrEqual(0.14);
  expect(await page.locator("[data-thread-file-card]").count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator('[data-file-card-seed="true"]')).toBeVisible();
  mkdirSync(REVIEW_DIR, { recursive: true });
  await page.screenshot({ path: join(REVIEW_DIR, "folded.png") });

  // A file card jumps into that file's steps.
  await page.locator('[data-thread-file-card="src/mod5.ts"]').click();
  await expect.poll(async () => (await dom(page)).folded, { timeout: 10_000 }).toBe("false");
  const inFile = await dom(page);
  expect(inFile.zoom).toBeGreaterThanOrEqual(0.6);
  const step = page.locator('.react-flow__node[data-id^="src/mod5.ts:step5_"]').first();
  await expect(step).toBeVisible({ timeout: 10_000 });
  const box = await step.boundingBox();
  expect(box!.y).toBeGreaterThan(130); // framed below the floating toolbar

  // A step opens the editor with its code.
  await page.mouse.move(310, 880);
  await step.click({ position: { x: 20, y: 12 } });
  await expect(page.locator("[data-node-editor-panel] .view-lines")).toContainText("step5_", { timeout: 15_000 });
  await page.screenshot({ path: join(REVIEW_DIR, "file-card-then-step.png") });

  expect(systemEvents, "never left for the system view").toBe(0);
  expect(errors, errors.join("\n")).toEqual([]);
});
