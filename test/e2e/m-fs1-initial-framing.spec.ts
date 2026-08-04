/**
 * M-FS1 (full-scope review 2026-07, P1) — initial thread framing frames
 * the THREAD BOUNDS on the cross axis, not the seed's lane.
 *
 * The legibility floor (2026-07-04) opens long threads seed-anchored at
 * a readable zoom, but it centred the SEED's lane vertically — and the
 * seed is always the first lane, so the canvas opened with a dead upper
 * half while lower lanes clipped below the fold. Now the whole cross
 * extent is framed: centred when it fits, anchored at the pad when not.
 *
 * Gated on flask_demo; runs in test:e2e-flask.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("flask_demo"), "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

test.describe("M-FS1 — initial thread framing", () => {
  test("cli:main opens with its cross extent framed, not seed-centred", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    // Both fit passes (60ms quick + 380ms settled) + the 300ms viewport
    // animation must land before measuring.
    await page.waitForTimeout(1200);

    const canvas = await page.locator("[data-thread-view]").boundingBox();
    expect(canvas).toBeTruthy();

    // Union of on-screen node rects (nodes + containers).
    const rects = await page.locator(".react-flow__node").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left };
      }),
    );
    expect(rects.length).toBeGreaterThan(3);
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));

    // The cross extent either fits (roughly centred: gap asymmetry small)
    // or is top-anchored — in BOTH cases nothing may hang above the
    // canvas, and dead space above must not dwarf the space below (the
    // old seed-centring gave topGap ≈ half the canvas).
    const topGap = top - canvas!.y;
    const bottomGap = canvas!.y + canvas!.height - bottom;
    expect(topGap, "thread must not clip above the canvas").toBeGreaterThanOrEqual(0);
    if (bottomGap >= 0) {
      // Fits vertically → framed: the gaps are within ~180px of each other.
      expect(Math.abs(topGap - bottomGap), `topGap=${topGap} bottomGap=${bottomGap} — cross extent should be framed, not seed-centred`).toBeLessThan(180);
    } else {
      // Doesn't fit → top-anchored near the pad.
      expect(topGap, "overflowing thread should anchor its top at the pad").toBeLessThan(120);
    }

    // The seed stays in view at the main-axis start.
    const seed = await page.locator(".react-flow__node").filter({ hasText: "main" }).first().boundingBox();
    expect(seed!.x - canvas!.x, "seed anchored at the left pad").toBeLessThan(canvas!.width * 0.35);
  });
});
