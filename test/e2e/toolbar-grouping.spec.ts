/**
 * Toolbar grouping (NEXT-ACTIONS §2) — the bar reads as three clusters,
 * not nine peer buttons:
 *
 *   views (Code / Thread / System / Arch)
 *   | canvas tools (Edges / Edit)
 *   | Claude actions (Draft / Describe / Build) — Analyze unmounted 2026-08-03
 *
 * Groups are single flex items so wrapping breaks BETWEEN groups, never
 * inside one; dividers are 1px --border-edge rules. Fixture-agnostic —
 * the toolbar mounts on every fixture, so this spec is deliberately
 * ungated (like canvas.spec).
 */
import { test, expect } from "@playwright/test";

test.describe("toolbar grouping", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-toolbar-group]", { timeout: 15_000 });
  });

  test("three groups render in reading order with dividers", async ({ page }) => {
    const groups = page.locator("[data-toolbar-group]");
    await expect(groups).toHaveCount(3);
    const names = await groups.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-toolbar-group")),
    );
    expect(names).toEqual(["views", "tools", "claude"]);

    // Dividers on the 2nd and 3rd group only.
    const borders = await groups.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).borderLeftWidth),
    );
    expect(borders[0]).toBe("0px");
    expect(borders[1]).toBe("1px");
    expect(borders[2]).toBe("1px");
  });

  test("buttons live in their semantic group", async ({ page }) => {
    const views = page.locator('[data-toolbar-group="views"]');
    for (const label of ["Code", "Thread", "System", "Arch"]) {
      await expect(views.getByRole("button", { name: label, exact: true })).toHaveCount(1);
    }
    const tools = page.locator('[data-toolbar-group="tools"]');
    for (const label of ["Edges", "Edit"]) {
      await expect(tools.getByRole("button", { name: label, exact: true })).toHaveCount(1);
    }
    const claude = page.locator('[data-toolbar-group="claude"]');
    // Draft is unconditional; Describe/Build are availability-gated.
    for (const label of ["Draft"]) {
      await expect(claude.getByRole("button", { name: label, exact: true })).toHaveCount(1);
    }
    // No stray ToolButton outside a group (the re-linking chip is not a button).
    const allButtons = await page.locator("[data-toolbar-group] button").count();
    const barButtons = await page
      .locator("[data-toolbar-group]")
      .first()
      .locator("xpath=..")
      .locator("button")
      .count();
    expect(allButtons).toBe(barButtons);
  });

  test("groups wrap as units at narrow width — no row splits inside a group", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.waitForTimeout(300);
    for (const name of ["views", "tools", "claude"]) {
      const group = page.locator(`[data-toolbar-group="${name}"]`);
      const buttons = group.locator("button");
      const n = await buttons.count();
      if (n < 2) continue;
      const tops: number[] = [];
      for (let i = 0; i < n; i++) {
        const box = await buttons.nth(i).boundingBox();
        if (box) tops.push(box.y);
      }
      const spread = Math.max(...tops) - Math.min(...tops);
      expect(spread, `group ${name} split across rows`).toBeLessThan(4);
    }
  });
});
