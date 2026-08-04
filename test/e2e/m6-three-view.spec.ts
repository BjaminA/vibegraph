/**
 * M6 wave 1 — three-view switchability + runtime-state banner.
 *
 * PLAN.md S1.5 M6 Done: "three views switchable on sample_advanced.py
 * and aero_demo/; ... no silent feature-disabled states".
 *
 * The aero_demo variant runs only when VG_FIXTURE points at it (its
 * webServer is launched separately). The sample_advanced variant runs
 * under the default fixture.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_AERO = FIXTURE.includes("aero_demo");

test.describe("M6 wave 1 — three views switchable", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // M8.3.2: directory fixtures boot into the thread index. Single-
    // file fixtures still go straight to the diagram. Wait for either,
    // then drill into main.py via the file tree if we're in directory
    // mode.
    await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
    await page.waitForTimeout(600);
    if (await page.locator("[data-side-panel]").count() > 0) {
      await page.click('[data-side-panel-tab="files"]');
      await page.click('[data-file-tree-row="main.py"]');
      await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
      await page.waitForTimeout(400);
    }
  });

  // The KeyBanner (z-index 870) appears centered at the top because the
  // dev server boots without ANTHROPIC_API_KEY. It overlaps the
  // top-right toolbar and intercepts clicks; dismiss it before
  // interacting with toolbar buttons.
  async function dismissKeyBanner(page: import("@playwright/test").Page) {
    const banner = page.locator("[data-key-banner]");
    if (await banner.count() > 0) {
      await banner.locator("button").click();
    }
  }

  test("diagram, code, and thread are all reachable from the toolbar", async ({ page }) => {
    await dismissKeyBanner(page);
    // Diagram is the default view -- function-def nodes visible.
    await expect(page.locator(".react-flow__node-functionDefNode").first()).toBeVisible();

    // Seed a function for the thread toggle by clicking a function-def
    // node BEFORE opening the Code dock — the dock tiles over the right
    // 44% of the canvas and would cover the node (M-FV layout). Same
    // pattern as thread.spec.ts (M4b wave 4): handleNodeClick sets
    // chatContextNode but doesn't open chat, so we avoid the
    // ViewTransition animation race.
    const fnNode = page.locator(".react-flow__node-functionDefNode").first();
    await fnNode.scrollIntoViewIfNeeded();
    await fnNode.click();

    // Open the Code panel -- always enabled once a file is open.
    await page.getByRole("button", { name: /code/i }).click();
    await expect(page.locator("[data-code-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForSelector("[data-code-view] .monaco-editor .view-line", { timeout: 15_000 });

    // Thread toggle now enabled.
    await page.getByRole("button", { name: "Thread", exact: true }).click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".vg-thread-node-seed")).toBeVisible();

    // Toggle back to diagram -- function-def nodes return.
    await page.getByRole("button", { name: "Thread", exact: true }).click();
    await expect(page.locator(".react-flow__node-functionDefNode").first()).toBeVisible({ timeout: 5_000 });

    // Code panel is still open the whole time (overlay coexists).
    await expect(page.locator("[data-code-view]")).toBeVisible();
  });

  test("runtime-state banner is hidden when claude CLI is available (M7 wave 2)", async ({ page }) => {
    // Pre-M7 this test asserted the banner SHOWED when ANTHROPIC_API_KEY
    // was missing. After M7 wave 2 the chat panel routes through the
    // `claude` CLI subprocess instead of @anthropic-ai/sdk, so the banner
    // condition flipped: it appears only when `claude` is NOT on PATH.
    // In CI the claude CLI is present (it's how the test harness runs),
    // so the banner should stay hidden.
    await page.waitForLoadState("networkidle");
    await expect(page.locator("[data-key-banner]")).toHaveCount(0);
  });
});
