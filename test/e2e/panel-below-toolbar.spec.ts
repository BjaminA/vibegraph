/**
 * Every right-edge panel sits BELOW the toolbar band, at every width.
 *
 * The band WRAPS: measured on a 900px-tall window its bottom edge is 48px
 * at 1800 wide, 82 at 1280 and 116 at 1100. W9 converted the two right
 * DOCKS to `--vg-toolbar-bottom` and left the panels on a hardcoded 56 —
 * so from 1280 down the Stack and Models panels lost their own headers
 * behind the second row. Reported from the C++ project.
 *
 * Also pinned: the panel must not overrun the bottom. Its max-height
 * applies to the CONTENT box, so 16px of padding and a 1px border sat
 * outside it and the Stack panel overran by 34px — invisible while the
 * limit was 80vh, because 80vh left room to spare.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/cpp/router_demo VG_PORT=4279 PORT=4279 \
 *     npx playwright test test/e2e/panel-below-toolbar.spec.ts --reporter=list --workers=1
 */
import { test, expect, type Page } from "@playwright/test";

const WIDTHS = [1800, 1280, 1100, 900];
const PANELS = ["Stack", "Models", "Edges"];

async function toolbarBottom(page: Page): Promise<number> {
  return page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--vg-toolbar-bottom")) || 0);
}

/** The open right-edge panel's box, found by position rather than by a
 *  per-panel selector so a new panel is covered the day it is added. */
async function openPanelBox(page: Page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll("div")]
      .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
      .filter((x) => !x.el.closest("[data-top-toolbar]"))
      .filter((x) => (x.cs.position === "fixed" || x.cs.position === "absolute")
        && x.r.width > 200 && x.r.height > 120 && x.r.left > window.innerWidth * 0.45)
      .sort((a, b) => a.r.top - b.r.top);
    const b = boxes[0];
    return b ? { top: Math.round(b.r.top), bottom: Math.round(b.r.bottom), vh: window.innerHeight } : null;
  });
}

test.describe("right-edge panels clear the toolbar band at every width", () => {
  test("no panel hides behind the wrapped toolbar, and none overruns the viewport", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // The band really does change height — if it stopped wrapping, this
    // test would pass for the wrong reason.
    const heights = new Set<number>();
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(500);
      heights.add(await toolbarBottom(page));
    }
    expect(heights.size, `the toolbar band never changed height: ${[...heights]}`).toBeGreaterThan(1);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(500);
      const bottom = await toolbarBottom(page);
      expect(bottom).toBeGreaterThan(0);
      for (const name of PANELS) {
        const btn = page.getByRole("button", { name: new RegExp(`^${name}$`) });
        if (!(await btn.count())) continue;
        await btn.click();
        await page.waitForTimeout(450);
        const box = await openPanelBox(page);
        expect(box, `${name} at ${width}px: no panel box found`).not.toBeNull();
        expect(box!.top, `${name} at ${width}px is UNDER the toolbar (band ends ${bottom})`)
          .toBeGreaterThanOrEqual(bottom);
        expect(box!.bottom, `${name} at ${width}px overruns the viewport`)
          .toBeLessThanOrEqual(box!.vh);
        await btn.click();
        await page.waitForTimeout(300);
      }
    }
    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
