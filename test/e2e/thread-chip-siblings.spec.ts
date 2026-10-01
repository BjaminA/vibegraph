/**
 * Sibling containers' chips never print on one spot (2026-10-01, Ben's
 * screenshot of a TS test thread: `FOR e of bundle.entities`, `TRY` and
 * `FOR … of bundle.labels` on top of each other). One called function is ONE
 * card however many blocks call it, so two sibling loops around it start at
 * the same corner — with different sizes when one loop does more, which the
 * identical-box fold cannot catch. chipPlacement.ts moves a later chip right
 * of an earlier one; asserted here on the painted rectangles.
 *
 *   VG_FIXTURE=test/fixtures/threads/chip_siblings_demo VG_PORT=4262 PORT=4262 \
 *     npx playwright test test/e2e/thread-chip-siblings.spec.ts --workers=1
 */
import { test, expect } from "@playwright/test";

const IS_DEMO = (process.env.VG_FIXTURE ?? "").includes("chip_siblings_demo");

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

test.describe("sibling container chips", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/threads/chip_siblings_demo");

  test("two loops sharing a card both show their chip, and the chips do not overlap", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="app.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1400);
    const chips = await page.$$eval(".vg-thread-container-chip", (els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { label: (el.textContent ?? "").trim(), box: { x: r.x, y: r.y, w: r.width, h: r.height } };
    }));
    const a = chips.find((c) => c.label.includes("e in entities"));
    const b = chips.find((c) => c.label.includes("label in labels"));
    expect(a, `both loop chips render: ${chips.map((c) => c.label).join(" | ")}`).toBeTruthy();
    expect(b).toBeTruthy();
    // The shape under test: the two chips would START on the same spot.
    expect(Math.abs(a!.box.y - b!.box.y), "the two containers share their top edge").toBeLessThan(4);
    const collisions: string[] = [];
    for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
      const area = overlap(chips[i].box, chips[j].box);
      if (area > 0) collisions.push(`"${chips[i].label}" × "${chips[j].label}" = ${Math.round(area)}px²`);
    }
    expect(collisions, "container chips must not overlap each other").toEqual([]);
  });
});
