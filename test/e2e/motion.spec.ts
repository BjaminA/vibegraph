/**
 * Motion video capture for M3 Aesthetic Appendix verification.
 * Records four MP4s under reviews/m3-motion/, one per spec.
 *
 * Run: npx playwright test test/e2e/motion.spec.ts
 *
 * Each test runs in its own context with `recordVideo` enabled. Playwright
 * writes the MP4 to a temp dir; on test end we copy it to reviews/m3-motion/
 * with a stable filename so PRs/reviews can attach them.
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "m3-motion");
fs.mkdirSync(OUT_DIR, { recursive: true });

test.describe.configure({ mode: "serial" });

test.use({
  video: {
    mode: "on",
    size: { width: 1280, height: 800 },
  },
});

async function saveVideo(page: import("@playwright/test").Page, target: string) {
  const video = page.video();
  if (!video) throw new Error("No video attached to page");
  await page.close();
  const src = await video.path();
  const dest = path.join(OUT_DIR, target);
  fs.copyFileSync(src, dest);
}

test.describe("M3 motion specs", () => {
  test("first-load: captures node-enter (240ms) + edge-draw (320ms)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
    // Hold for ~2s so the keyframes finish and are visible in the video.
    await page.waitForTimeout(2000);
    await saveVideo(page, "first-load.webm");
  });

  test("node-exit: dispatches vg-hide-node and captures the 160ms ghost fade", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
    // Pick a real node ID from the rendered graph and hide it.
    const nodeId = await page.locator(".react-flow__node").first().getAttribute("data-id");
    if (!nodeId) throw new Error("No data-id on first react-flow node");
    await page.waitForTimeout(500); // settle initial-load motion
    await page.evaluate((id) => {
      document.dispatchEvent(new CustomEvent("vg-hide-node", { detail: { nodeId: id } }));
    }, nodeId);
    // 160ms exit + buffer to confirm DOM cleanup.
    await page.waitForTimeout(1500);
    await saveVideo(page, "node-exit.webm");
  });

  // The original view-transition capture drove the compose-palette FAB,
  // whose toggle button was removed pre-M12 (ComposePalette is mounted
  // but has no visible opener — park-don't-delete). The Code dock now
  // carries the same 280ms view-transition, so the capture drives that.
  test("view-transition: opens the Code dock (280ms enter) and closes (280ms exit)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
    await page.waitForTimeout(500); // settle initial-load motion
    const banner = page.locator("[data-key-banner]");
    if ((await banner.count()) > 0) await banner.locator("button").click();
    await page.getByRole("button", { name: /code/i }).click();
    await page.waitForSelector("[data-code-view]", { timeout: 10_000 });
    await page.waitForTimeout(500); // enter
    await page.keyboard.press("Escape"); // close
    await page.waitForTimeout(500); // exit
    await saveVideo(page, "view-transition.webm");
  });

  // The M-FV redesign turned edges OFF in the file view, so edge-draw
  // only paints in the thread view now — drive the capture there.
  test("edge-draw isolation: captures stroke-dashoffset on path mount", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
    await page.locator(".react-flow__node-functionDefNode").first().click();
    await page.getByRole("button", { name: "Thread", exact: true }).click();
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    // SVG <path> elements are technically not "visible" to Playwright's default
    // visibility check — use state: "attached" to confirm DOM presence.
    await page.waitForSelector(".react-flow__edge-path", { timeout: 15_000, state: "attached" });
    await page.waitForTimeout(2000);
    await saveVideo(page, "edge-draw.webm");
  });
});
