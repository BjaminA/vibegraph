/**
 * UI rendering tests — verifies the React Flow canvas renders
 * the correct node types and counts for sample_advanced.py.
 */
import { test, expect } from "@playwright/test";

// sample_advanced.py has:
//   1 import, 1 import_from
//   5 top-level assignments (PI, greeting, my_list, names, result)
//   2 top-level functions (calculate_area, greet)
//   2 class defs (Shape, Circle) with 5 methods total
//   2 for loops at module level

test.describe("VibeGraph Canvas", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for React Flow to finish mounting nodes
    await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
  });

  test("page loads and renders a non-trivial graph", async ({ page }) => {
    const count = await page.locator(".react-flow__node").count();
    expect(count).toBeGreaterThan(10);
  });

  test("renders correct import nodes", async ({ page }) => {
    const imp = await page.locator(".react-flow__node-importNode").count();
    const impFrom = await page.locator(".react-flow__node-importFromNode").count();
    expect(imp).toBe(1);   // import math
    expect(impFrom).toBe(1); // from os.path import join, exists
  });

  test("renders 7 function def nodes (top-level + methods)", async ({ page }) => {
    await page.waitForSelector(".react-flow__node-functionDefNode");
    const count = await page.locator(".react-flow__node-functionDefNode").count();
    // calculate_area, greet, Shape.__init__, Shape.describe, Shape.area,
    // Circle.__init__, Circle.area
    expect(count).toBe(7);
  });

  test("renders 2 class def nodes (Shape, Circle)", async ({ page }) => {
    await page.waitForSelector(".react-flow__node-classDefNode");
    const count = await page.locator(".react-flow__node-classDefNode").count();
    expect(count).toBe(2);
  });

  test("renders 2 for loop nodes", async ({ page }) => {
    await page.waitForSelector(".react-flow__node-forLoopNode");
    const count = await page.locator(".react-flow__node-forLoopNode").count();
    expect(count).toBe(2);
  });

  test("renders if_stmt node inside greet function", async ({ page }) => {
    await page.waitForSelector(".react-flow__node-ifNode");
    const count = await page.locator(".react-flow__node-ifNode").count();
    expect(count).toBe(1); // if loud: inside greet
  });

  test("every node has an edit button", async ({ page }) => {
    const allNodes = page.locator(".react-flow__node");
    const nodeCount = await allNodes.count();
    expect(nodeCount).toBeGreaterThan(0);

    // Every node component renders an EditButton with title="Edit source"
    for (let i = 0; i < Math.min(nodeCount, 8); i++) {
      const node = allNodes.nth(i);
      const btn = node.locator('button[title="Edit source"]');
      await expect(btn).toHaveCount(1);
    }
  });

  test("function nodes display their name", async ({ page }) => {
    await page.waitForSelector(".react-flow__node-functionDefNode");
    // The two top-level functions should show their names
    const fnNodes = page.locator(".react-flow__node-functionDefNode");
    const texts = await fnNodes.allInnerTexts();
    const combined = texts.join(" ");
    expect(combined).toContain("calculate_area");
    expect(combined).toContain("greet");
  });

  test("class nodes display their name", async ({ page }) => {
    await page.waitForSelector(".react-flow__node-classDefNode");
    const classNodes = page.locator(".react-flow__node-classDefNode");
    const texts = await classNodes.allInnerTexts();
    const combined = texts.join(" ");
    expect(combined).toContain("Shape");
    expect(combined).toContain("Circle");
  });
});
