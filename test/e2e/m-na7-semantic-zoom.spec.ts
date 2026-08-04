/**
 * M-NA7 — semantic zoom (PLAN-v5 §5.2, unblocked by NEXT-ACTIONS).
 *
 * The legibility floor made FIRST PAINT readable (seed-anchored 0.78);
 * these tiers make the OVERVIEW readable: at fit zoom a long thread
 * used to be a sub-3px-text smear. Now:
 *   - full   (first paint): cards as designed, body rows present;
 *   - overview (fit on a long thread): landmark labels + container
 *     chips render at inverse-zoom scale — genuinely legible on
 *     screen — while step labels yield to colored structure;
 *   - compact (mid zoom): every card's label rides outside the card
 *     at ~constant on-screen size.
 *
 * Gated on flask_demo (cli:main is long enough that fit < the
 * overview threshold). Boot: VG_FIXTURE=test/fixtures/threads/flask_demo
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("flask_demo"), "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

async function openCliMain(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
  await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800); // legibility-floor fit settles
}

test.describe("M-NA7 — semantic zoom tiers", () => {
  test("first paint is the full tier: body rows present", async ({ page }) => {
    await openCliMain(page);
    const seed = page.locator('.react-flow__node[data-id="cli:main"] .vg-thread-node');
    await expect(seed).toHaveAttribute("data-lod", "full");
    // A step's secondary metadata row renders in full tier (in-card
    // label, no external LOD label).
    expect(await page.locator("[data-lod-label]").count()).toBe(0);
  });

  test("fit zoom drops to overview: landmarks stay legible, steps yield to structure", async ({ page }) => {
    await openCliMain(page);
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(700);

    const seedCard = page.locator('.react-flow__node[data-id="cli:main"] .vg-thread-node');
    await expect(seedCard).toHaveAttribute("data-lod", "overview");

    // The seed is a landmark: its LOD label must render at a genuinely
    // readable ON-SCREEN size (the pre-NA7 smear was ~2px).
    const seedLabel = seedCard.locator("[data-lod-label]");
    await expect(seedLabel).toBeVisible();
    const labelBox = await seedLabel.boundingBox();
    expect(labelBox, "seed label box").not.toBeNull();
    expect(labelBox!.height, "seed label must be legible on screen at fit zoom").toBeGreaterThan(8);

    // Non-landmark steps drop their labels entirely (map metaphor:
    // city names at low zoom, not every street).
    const stepLabel = page.locator('.react-flow__node[data-id="cli:cmd_create"] [data-lod-label]');
    await expect(stepLabel).toHaveCount(0);

    // Container chips are landmarks too: their font scales with
    // inverse zoom (computed style is in flow px — full tier is 11px).
    const chip = page.locator(".vg-thread-container-chip").first();
    const chipFont = await chip.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(chipFont, "container chip should scale up at overview").toBeGreaterThan(20);
  });

  test("mid zoom is the compact tier: every label rides outside its card, readably", async ({ page }) => {
    await openCliMain(page);
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(500);

    // Zoom in from fit until a step card reports the compact tier
    // (each Controls click is a fixed zoom step; bound the loop).
    const step = page.locator('.react-flow__node[data-id="cli:cmd_create"] .vg-thread-node');
    let tier = await step.getAttribute("data-lod");
    for (let i = 0; i < 12 && tier !== "compact"; i++) {
      await page.locator(".react-flow__controls-zoomin").click();
      await page.waitForTimeout(120);
      tier = await step.getAttribute("data-lod");
    }
    expect(tier, "zooming in from fit must pass through the compact tier").toBe("compact");

    // In compact EVERY node keeps a label (outside the card), at a
    // readable on-screen size.
    const label = page.locator('.react-flow__node[data-id="cli:cmd_create"] [data-lod-label]');
    await expect(label).toBeVisible();
    const box = await label.boundingBox();
    expect(box!.height, "compact label must be legible on screen").toBeGreaterThan(8);
  });

  test("dead-sliver collapse: a too-narrow canvas becomes a breadcrumb, and comes back", async ({ page }) => {
    // 1000px: the canvas paints fine alone (~450px after the side +
    // effects panels), but the editor dock (minWidth 480) pushes the
    // visible strip under the 280px floor.
    await page.setViewportSize({ width: 1000, height: 800 });
    await openCliMain(page);
    await expect(page.locator("[data-thread-view] .react-flow")).toBeVisible();

    // Docking the editor leaves < 280px of canvas — the thread view
    // must collapse to an honest breadcrumb instead of a sliver of
    // clipped cards (NEXT-ACTIONS §4).
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator("[data-node-editor-panel]")).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(500); // dock transition + inset measure

    const crumb = page.locator("[data-thread-breadcrumb]");
    await expect(crumb).toBeVisible();
    await expect(crumb).toContainText("cli:main");
    await expect(crumb).toContainText("close a panel");
    await expect(page.locator("[data-thread-view] .react-flow")).toHaveCount(0);

    // Closing the editor restores the canvas.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-thread-breadcrumb]")).toHaveCount(0);
    await expect(page.locator("[data-thread-view] .react-flow")).toBeVisible();
  });
});
