/**
 * File view — a `raise` shows its whole exception, not a mid-expression cut.
 *
 * Reported 2026-08-04: `raise ValueError(f"length mismatch: {len(preds)}
 * predictions vs {len(trues)} targets")` rendered truncated. Four separate
 * caps stacked, and fixing any one alone still clipped:
 *
 *   1. parse_cst.py capped `exc` at a bespoke 40 chars (everything else uses
 *      PREVIEW_MAX), so the IR itself only carried `ValueError(\n    f"length
 *      mismatch: {len(`;
 *   2. buildLayout's previewLines() handled assignment + return_stmt only, so
 *      a multi-line raise was sized for ONE line;
 *   3. contentLen() used the raw string length rather than longestLineLen, so
 *      width was computed from every line concatenated;
 *   4. RaiseNode passed no clampLines, leaving the shared 3-line CSS clamp to
 *      cut whatever the box did fit.
 *
 * This paints the real renderer, because 1 and 2-4 fail independently: an IR
 * assertion alone would pass while the card still clipped on screen.
 *
 * Boot (see package.json test:e2e-library):
 *   VG_FIXTURE=test/fixtures/system/library_only VG_PORT=4248 PORT=4248 \
 *     npx playwright test test/e2e/fileview-raise-full-text.spec.ts
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_LIBRARY = FIXTURE.includes("library_only");

// model.py builds this across three source lines:
//   raise ValueError(
//       f"image_size must be divisible by 4 (two 2x2 pools), got {image_size}"
//   )
const TAIL = "got {image_size}";

test.describe("file view — raise statements keep their full text", () => {
  test.skip(!IS_LIBRARY, "Requires VG_FIXTURE=test/fixtures/system/library_only");

  test("a multi-line raise renders its whole message, and the card fits it", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-side-panel-tab="files"]', { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="model.py"]');
    await page.waitForSelector(".react-flow__node-raiseNode", { timeout: 15_000 });

    const card = page.locator(".react-flow__node-raiseNode").filter({ hasText: "image_size" }).first();
    await expect(card).toHaveCount(1);

    // 1 — the tail of the message is present at all (the IR-level 40-char cap
    // cut everything after `f"image_size must be divisi`).
    await expect(card).toContainText(TAIL);

    // 2 — and it is actually VISIBLE, not clipped by the clamp or overflowing
    // the card's box. scrollHeight > clientHeight means text the user cannot
    // read, which is the bug as experienced even when the IR is correct.
    const text = card.locator(".vg-node-code").first();
    const clipped = await text.evaluate((el) => {
      const t = el as HTMLElement;
      return { over: t.scrollHeight - t.clientHeight, wide: t.scrollWidth - t.clientWidth };
    });
    expect(clipped.over, `raise text is vertically clipped by ${clipped.over}px`).toBeLessThanOrEqual(1);
    expect(clipped.wide, `raise text is horizontally clipped by ${clipped.wide}px`).toBeLessThanOrEqual(1);

    // 3 — the node grew for the extra source lines rather than staying
    // single-line-tall (previewLines now covers raise_stmt). Measured against
    // a single-line node in the SAME view, so the assertion is invariant to
    // react-flow's zoom (boundingBox is screen px, which the fit scales).
    const raiseBox = await card.boundingBox();
    const oneLine = page.locator(".react-flow__node-returnNode, .react-flow__node-callNode").first();
    const oneLineBox = await oneLine.boundingBox();
    expect(oneLineBox, "expected a single-line node to compare against").not.toBeNull();
    expect(raiseBox!.height,
      `a 3-line raise (${Math.round(raiseBox!.height)}px) must be taller than a single-line node (${Math.round(oneLineBox!.height)}px)`)
      .toBeGreaterThan(oneLineBox!.height);
  });
});
