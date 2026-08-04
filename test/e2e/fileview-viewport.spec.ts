/**
 * M-FV.1 (W4) — viewport behaviour for the file view.
 *
 * Three guarantees the brief asked for:
 *  1. the diagram re-fits when the window resizes (it used to fit only at
 *     mount, so a resize left content cropped or adrift);
 *  2. the CodeView dock is full-screenable (it was a fixed 44% right dock);
 *  3. the CodeView never silently clips a long line — wrap is on by default,
 *     with a toggle back to horizontal scroll.
 *
 * Boot with VG_FIXTURE=test/fixtures/threads/big_demo. login_manager.py is a
 * large file with long lines (e.g. the REMEMBER_COOKIE_* config reads).
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_demo"), "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

async function openFile(page: import("@playwright/test").Page, file: string, waitFor: string) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
  await page.click('[data-side-panel-tab="files"]');
  await page.click(`[data-file-tree-row="${file}"]`);
  await page.waitForSelector(waitFor, { timeout: 15_000 });
}

test.describe("file view — viewport (W4)", () => {
  test("diagram re-fits on window resize", async ({ page }) => {
    // A small file (config.py) so fitView isn't pinned at minZoom — the fit
    // scale genuinely varies with viewport, unlike a 500-line file.
    await page.setViewportSize({ width: 1400, height: 900 });
    await openFile(page, "config.py", ".react-flow__node");
    const viewport = page.locator(".react-flow__viewport");
    await expect(viewport).toBeVisible();
    await page.waitForTimeout(500); // mount fit settles
    const before = await viewport.getAttribute("style");

    // Shrink the window substantially. A mount-only fit would leave this
    // transform unchanged and the content overflowing the smaller viewport.
    await page.setViewportSize({ width: 720, height: 560 });
    await page.waitForTimeout(1200); // quick + settle re-fit passes (animated)
    const after = await viewport.getAttribute("style");
    expect(before).toBeTruthy();
    expect(after).toBeTruthy();
    // The viewport transform changed in response to the resize — proof a
    // re-fit ran. Without FitOnReflow, react-flow's `fitView` prop fires
    // only at mount, so this transform would be identical after a resize.
    expect(after).not.toEqual(before);
  });

  test("CodeView is full-screenable", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openFile(page, "login_manager.py", ".react-flow__node-classDefNode");
    await page.click('button[title="Show source for the active file"]');
    const panel = page.locator("[data-code-view]");
    await expect(panel).toBeVisible({ timeout: 15_000 });

    const docked = await panel.boundingBox();
    expect(docked).not.toBeNull();
    // Docked is the ~44% right column — clearly less than the viewport.
    expect(docked!.width).toBeLessThan(1400 * 0.75);

    await page.click("[data-code-view-fullscreen]");
    await expect(panel).toHaveAttribute("data-fullscreen", "true");
    const full = await panel.boundingBox();
    expect(full).not.toBeNull();
    // Full-screen covers (essentially) the whole viewport width.
    expect(full!.width).toBeGreaterThan(1400 * 0.95);
  });

  test("CodeView wrap defaults on and toggles", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openFile(page, "login_manager.py", ".react-flow__node-classDefNode");
    await page.click('button[title="Show source for the active file"]');
    await expect(page.locator("[data-code-view]")).toBeVisible({ timeout: 15_000 });

    const wrapBtn = page.locator("[data-code-view-wrap]");
    // Default: wrap ON (so long lines never clip silently).
    await expect(wrapBtn).toHaveAttribute("title", /Wrap long lines: on/);
    await wrapBtn.click();
    await expect(wrapBtn).toHaveAttribute("title", /Wrap long lines: off/);
  });
});
