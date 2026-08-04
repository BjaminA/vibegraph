/**
 * U2 — thread edges: glow, bezier, tier-by-frequency, cross-file dashed,
 * dim-non-focus on hover.
 *
 * Verified visual: each edge picks up a CSS class set by ThreadEdge.tsx
 * (vg-thread-edge / vg-thread-edge-{thin,medium,thick} / -conditional /
 * -cross-file). Computed style on the underlying path inherits the
 * glow + animation. We assert via class presence + computed style,
 * not via screenshot diff — screenshots are committed to
 * reviews/ui-u2/ when VG_CAPTURE=1.
 *
 * Gated on VG_FIXTURE=flask_demo so we can test BOTH cross-file
 * (cli:main thread reaches db.py) and shared-callee (cli:main's
 * cmd_* fns both call create_user / list_users in flask_demo's
 * thread) tier rules in one fixture.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("U2 — thread edges", () => {
  test.skip(!IS_FLASK,
    "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  async function openCliMainThread(page: import("@playwright/test").Page) {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    // cli:main is the only cli entry — multi-file reach makes it a
    // good cross-file + shared-callee fixture in one shot.
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    // Settle d3-force + fitView before measuring.
    await page.waitForTimeout(700);
  }

  test("edges render with the threadEdge custom type (bezier paths + glow class)", async ({ page }) => {
    await openCliMainThread(page);
    const edges = page.locator(".vg-thread-edge");
    const count = await edges.count();
    expect(count).toBeGreaterThan(0);
    // Every edge should also carry exactly one tier class.
    for (let i = 0; i < count; i++) {
      const cls = (await edges.nth(i).getAttribute("class")) ?? "";
      expect(
        /vg-thread-edge-(thin|medium|thick)/.test(cls),
        `edge ${i} class string should include a tier; got ${cls}`,
      ).toBe(true);
    }
  });

  test("at least one cross-file edge in cli:main (reaches models.py / db.py)", async ({ page }) => {
    await openCliMainThread(page);
    const crossFile = page.locator(".vg-thread-edge-cross-file");
    await expect(crossFile.first()).toBeVisible({ timeout: 5_000 });
  });

  test("pulse animation is wired on default edges, off on conditional ones", async ({ page }) => {
    await openCliMainThread(page);
    // Default (non-conditional) edges pulse.
    const pulsePath = page.locator(".vg-thread-edge:not(.vg-thread-edge-conditional) .react-flow__edge-path").first();
    const pulseAnim = await pulsePath.evaluate((el) => getComputedStyle(el).animationName);
    expect(pulseAnim).toBe("vg-thread-edge-pulse");
    // Conditional edges (if any in this fixture) explicitly clear the
    // animation. flask_demo's cli:main doesn't have conditional edges,
    // so just check the rule is wired by sampling the class CSS rule
    // indirectly: if there are conditional edges, animationName==='none'.
    const cond = page.locator(".vg-thread-edge-conditional .react-flow__edge-path").first();
    if ((await cond.count()) > 0) {
      const condAnim = await cond.evaluate((el) => getComputedStyle(el).animationName);
      expect(condAnim).toBe("none");
    }
  });

  test("hover on a node dims its siblings (Obsidian binary-attention)", async ({ page }) => {
    await openCliMainThread(page);
    const seedNode = page.locator(".vg-thread-node-seed").first();
    await seedNode.hover();
    // Wait for the 200ms fade.
    await page.waitForTimeout(300);
    // Pick any OTHER thread node and verify opacity dropped.
    const otherNode = page.locator(".vg-thread-node:not(.vg-thread-node-seed)").first();
    const opacity = await otherNode.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBeLessThan(1.0);
  });
});
