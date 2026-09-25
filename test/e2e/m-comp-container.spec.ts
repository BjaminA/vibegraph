/**
 * M-COMP — the container as a reader sees it.
 *
 * A round-trip finding is only useful if the loop it names is findable in
 * the view, so this spec both PINS the rendered container and leaves a
 * screenshot pair in reviews/m-comp/: the comprehension spelling beside the
 * spelled-out for-loop that performs the identical work.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/comprehension/comp_demo VG_PORT=4269 PORT=4269 \
 *     npx playwright test test/e2e/m-comp-container.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const SHOTS = join(process.cwd(), "reviews", "m-comp");

async function openThread(page, entryId: string) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
  await page.click(`[data-thread-index-row][data-entry-id="${entryId}"]`);
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(900);
  await page.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(600);
}

test.describe("M-COMP — the comprehension container in the thread view", () => {
  test.skip(!FIXTURE.includes("comp_demo"), "Requires VG_FIXTURE=test/fixtures/comprehension/comp_demo");
  test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

  test("a list comprehension draws a container, chipped like the loop it is", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await openThread(page, "fanout.py:fetch_comp");
    const box = page.locator('[data-thread-container][data-container-kind="comprehension"]');
    await expect(box).toHaveCount(1);
    // The chip splits at the first space: uppercased head, kept tail. The
    // noun is one word for exactly this reason.
    await expect(box).toContainText("LISTCOMP");
    await expect(box).toContainText("for uid in ids");
    // The repeated request is INSIDE the region, which is the whole claim.
    await expect(page.locator(".vg-thread-node").filter({ hasText: "requests.get" }).first())
      .toBeVisible();

    await page.screenshot({ path: join(SHOTS, "listcomp-container.png") });
    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  test("the spelled-out loop is drawn the same way — same work, same picture", async ({ page }) => {
    await openThread(page, "fanout.py:fetch_loop");
    await expect(page.locator('[data-thread-container][data-container-kind="for"]')).toHaveCount(1);
    await page.screenshot({ path: join(SHOTS, "for-loop-container.png") });
  });

  test("page_once: NO loop is drawn, because the one request runs once", async ({ page }) => {
    // The request lives in the comprehension's outermost iterable, which is
    // evaluated once. The extractor materialises a container only when the
    // thread actually walks a step inside it, and nothing the thread walks
    // is inside this one — so the reader sees a plain request with no loop
    // around it. The picture has to agree with the verdict (roundTrips = 0),
    // or the verdict is not checkable by eye.
    await openThread(page, "fanout.py:page_once");
    await expect(page.locator('[data-thread-container][data-container-kind="comprehension"]'))
      .toHaveCount(0);
    await expect(page.locator(".vg-thread-node").filter({ hasText: "requests.get" }).first())
      .toBeVisible();
    await page.screenshot({ path: join(SHOTS, "once-evaluated-iterable.png") });
  });
});
