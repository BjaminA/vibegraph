/**
 * Thread ranks (2026-09-25), end-to-end in the living renderer, on
 * test/fixtures/thread_rank/route_demo — a a private production codebase-shaped Next route.
 *
 *   Primary       → the seed and the model round trip, the seed's remit
 *                   badge saying what it holds;
 *   + Secondary   → the two guards folded to one line each, the client
 *                   set-up, the helper, the output;
 *   remit badge   → opens the helper's local work in place, and closes it;
 *   All           → every node, no badges (the raw thread);
 *   reload        → the chosen level is remembered.
 *
 * The server boots on primary here (VG_THREAD_RANK=primary; every other
 * suite pins "all"). Screenshots land in reviews/thread-rank/.
 *
 *   npm run test:e2e-thread-rank
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const REVIEW_DIR = join(process.cwd(), "reviews", "thread-rank");
const ENTRY = "app/api/interpret/route.ts:POST";

async function openThread(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
  await page.click(`[data-thread-index-row][data-entry-id="${ENTRY}"]`);
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-thread-rank-control]")).toBeVisible();
  await page.waitForTimeout(700);
}

const cards = (page: Page) => page.locator(".vg-thread-node");
const labels = async (page: Page) =>
  (await page.locator(".vg-thread-node [data-node-label]").allInnerTexts()).map((s) => s.trim()).sort();

test.describe("thread ranks", () => {
  test.skip(!FIXTURE.includes("thread_rank/route_demo"), "Requires VG_FIXTURE=test/fixtures/thread_rank/route_demo");
  test.beforeAll(() => mkdirSync(REVIEW_DIR, { recursive: true }));

  test("primary → + secondary → open a remit → all, and the level is remembered", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openThread(page);

    // Primary: two cards, and the seed says what it is holding.
    const control = page.locator("[data-thread-rank-control]");
    await expect(control).toHaveAttribute("data-level", "1");
    await expect(cards(page)).toHaveCount(2);
    expect(await labels(page)).toEqual(["POST", "openai.chat.completions.create"]);
    await expect(control.locator("[data-rank-count]")).toHaveText("2 of 22");
    const seedBadge = page.locator(".vg-thread-node-seed [data-remit-badge]");
    await expect(seedBadge).toHaveText("+17");
    await expect(seedBadge).toHaveAttribute("title", /^17 hidden: 9 local ops, 2 guards/);
    await page.waitForTimeout(900); // the level change re-fits over ~700 ms
    await page.screenshot({ path: join(REVIEW_DIR, "1-primary.png") });

    // + Secondary: guards read as one line each; the constructor is set-up.
    await control.locator('[data-rank-level="2"]').click();
    await expect(control).toHaveAttribute("data-level", "2");
    await expect(cards(page)).toHaveCount(8);
    await expect(page.locator('[data-fold="guard"]')).toHaveCount(2);
    await expect(page.locator('[data-fold="guard"]').first()).toContainText("returns if");
    expect(await labels(page)).toContain("returns if !apiKey");
    await page.waitForTimeout(900); // the level change re-fits over ~700 ms
    await page.screenshot({ path: join(REVIEW_DIR, "2-secondary.png") });

    // Opening the helper's remit shows its four local ops in place.
    const helper = page.locator(".vg-thread-node", { has: page.locator("[data-node-label]", { hasText: /^rateLimit$/ }) });
    await helper.locator("[data-remit-badge]").click();
    await expect(cards(page)).toHaveCount(12);
    await expect(helper.locator("[data-remit-badge]")).toHaveAttribute("data-remit-open", "true");
    await page.waitForTimeout(900); // the level change re-fits over ~700 ms
    await page.screenshot({ path: join(REVIEW_DIR, "3-remit-open.png") });
    await helper.locator("[data-remit-badge]").click();
    await expect(cards(page)).toHaveCount(8);

    // All: the raw thread, no folds, no badges.
    await control.locator('[data-rank-level="3"]').click();
    await expect(cards(page)).toHaveCount(19); // 22, less three nested calls the nests toggle folds
    await expect(page.locator("[data-remit-badge]")).toHaveCount(0);
    await expect(page.locator('[data-fold="guard"]')).toHaveCount(0);
    await expect(control.locator("[data-rank-count]")).toHaveText("19 of 22");

    // Remembered across a reload.
    await control.locator('[data-rank-level="2"]').click();
    await openThread(page);
    await expect(page.locator("[data-thread-rank-control]")).toHaveAttribute("data-level", "2");
    await expect(cards(page)).toHaveCount(8);

    expect(errors).toEqual([]);
  });

  // 2026-09-28 — the same ranks beside the source. The route's round trip is
  // written on line 17 and is primary beside the entry point (line 4); the rateLimit call on
  // line 10 is secondary; the toggle takes every mark away.
  test("code view: the gutter marks each ranked line, primary on the round trip; the toggle hides them", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row$="route.ts"]');
    await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
    await page.click('button[title="Show source for the active file"]');
    await expect(page.locator("[data-code-view]")).toBeVisible({ timeout: 15_000 });
    await page.waitForSelector("[data-code-view] .monaco-editor .view-line", { timeout: 15_000 });

    const toggle = page.locator("[data-code-view-ranks]");
    await expect(toggle).toHaveAttribute("data-ranks-on", "true");
    await expect(toggle).not.toHaveAttribute("data-ranked-lines", "0");
    const lineWith = (rank: number) => page.locator(`[data-code-view] .margin-view-overlays > div:has(.vg-rank-gutter-${rank}) .line-numbers`);
    await expect(lineWith(1)).toHaveText(["4", "17"]); // the entry point itself, and its round trip
    expect(await lineWith(2).allInnerTexts()).toContain("10");
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(REVIEW_DIR, "4-code-view-ranks.png") });

    await toggle.click();
    await expect(toggle).toHaveAttribute("data-ranks-on", "false");
    await expect(page.locator("[data-code-view] .vg-rank-gutter")).toHaveCount(0);
  });
});
