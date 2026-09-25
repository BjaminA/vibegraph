/**
 * Bird's-eye, dispatchers and file stores in the GUI (2026-09-24), on
 * test/fixtures/arch/dispatch_demo: two Next routes run ops/bin/orchestrator.sh,
 * whose allow-list names four scripts; it exports CACHE_ROOT=…/output_cache
 * and a third route reads it.
 *
 * Boot:
 *   VG_START_VIEW=architecture VG_FIXTURE=test/fixtures/arch/dispatch_demo \
 *     VG_PORT=4338 PORT=4338 \
 *     npx playwright test test/e2e/arch-birdseye.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("dispatch_demo"), "Requires VG_FIXTURE=test/fixtures/arch/dispatch_demo");

const REVIEW_DIR = join(process.cwd(), "reviews", "birdseye");
const HUB = "hub:ops/bin/orchestrator.sh:module";

test("Bird's-eye draws the Browser, the dispatcher and the cache; the dispatcher's list drops down, downloads and opens threads", async ({ page }) => {
  mkdirSync(REVIEW_DIR, { recursive: true });
  await page.goto("/");
  await expect(page.locator('[data-system-view][data-system-mode="map"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-boot-screen]")).toHaveCount(0);

  // Overview already carries the dispatcher and the cache.
  await expect(page.locator(`[data-arch-id="${HUB}"]`)).toBeVisible();
  await expect(page.locator(`[data-arch-id="${HUB}"] [data-arch-chip="4 scripts"]`)).toBeVisible();
  await expect(page.locator('[data-arch-id="tool:output_cache/"]')).toContainText("file cache · CACHE_ROOT");

  // Bird's-eye: an actor in front of the web app, one arrow per pair.
  await page.locator('[data-arch-lens="birdseye"]').click();
  await expect(page.locator('[data-arch-lens="birdseye"][data-active="true"]')).toBeVisible();
  await expect(page.locator('[data-arch-kind="actor"]')).toContainText("Browser");
  await expect(page.locator(`[data-arch-id="${HUB}"]`)).toBeVisible();
  await expect(page.locator('[data-arch-id="tool:output_cache/"]')).toBeVisible();
  await page.screenshot({ path: join(REVIEW_DIR, "birdseye.png") });

  // The dispatcher's allow-list, by directory.
  await page.locator(`[data-arch-id="${HUB}"]`).click();
  const list = page.locator("[data-arch-dispatch]");
  await expect(list).toContainText("dispatches 4 scripts");
  await expect(list.locator('[data-arch-dispatch-dir="reports"]')).toContainText("reports/ (2)");
  await expect(list.locator('[data-arch-dispatch-dir="sync"]')).toContainText("sync/ (2)");
  await expect(list.locator("[data-arch-dispatch-callers]")).toContainText("named by 2 files");
  await page.screenshot({ path: join(REVIEW_DIR, "dispatch-list.png") });

  // Download: the same list as Markdown.
  const [dl] = await Promise.all([page.waitForEvent("download"), list.locator("[data-arch-dispatch-download]").click()]);
  expect(dl.suggestedFilename()).toBe("orchestrator-dispatch.md");
  const md = readFileSync((await dl.path())!, "utf-8");
  expect(md).toContain("## reports/");
  expect(md).toContain("- `ops/bin/sync/push.sh`");
  expect(md).toContain("- `web/app/api/run/route.ts`");

  // Selection is an OUTLINE, not a fade (2026-09-24): the clicked card rings,
  // everything else stays fully lit.
  const selection = () => page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".react-flow__node")];
    const sel = nodes.filter((n) => n.classList.contains("selected"));
    const others = nodes.filter((n) => !n.classList.contains("selected")).map((n) => parseFloat(getComputedStyle(n).opacity));
    const edges = [...document.querySelectorAll(".react-flow__edge")].map((e) => parseFloat(getComputedStyle(e).opacity));
    return {
      selected: sel.length,
      minOther: Math.min(1, ...others), minEdge: Math.min(1, ...edges),
      ring: sel[0] ? getComputedStyle(sel[0], "::after").animationName : null,
    };
  });
  const onMap = await selection();
  expect(onMap.selected).toBe(1);
  expect(onMap.ring).toContain("vg-select-breathe");
  expect(onMap.minOther).toBe(1);
  expect(onMap.minEdge).toBeGreaterThan(0.5); // weak edges are drawn at 0.55 by design, never faded further

  // A script in the list opens its thread.
  await list.locator('[data-arch-dispatch-script="ops/bin/reports/daily.sh:main"]').click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-system-view]")).toHaveCount(0);

  // The same in the thread view — once its opening fit has settled (a click
  // during the fit animation lands on a moving target).
  await page.waitForTimeout(800);
  await page.locator(".vg-thread-node").last().click();
  await expect.poll(async () => (await selection()).selected, { timeout: 5_000 }).toBe(1);
  const onThread = await selection();
  expect(onThread.ring).toContain("vg-select-breathe");
  expect(onThread.minOther).toBe(1);
});
