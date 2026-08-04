/**
 * M5 wave 4 — three-way workflow video capture.
 *
 * Records one ~5s clip showing the full sync language end-to-end:
 *   1. Page boots, diagram renders.
 *   2. Toolbar Code button opens the read-only panel.
 *   3. Diagram selection (vg-chat-about-node) -> code pulses + scrolls.
 *   4. A different selection -> code pulses on a new range.
 *
 * Gated by VG_CAPTURE=1. Run:
 *   VG_CAPTURE=1 npx playwright test test/e2e/m5-workflow-capture.spec.ts
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "m5-code");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Top-level test.use(video) -- playwright forbids it inside describe.
test.use({
  video: {
    mode: "on",
    size: { width: 1280, height: 800 },
  },
});

async function saveVideo(
  page: import("@playwright/test").Page,
  target: string,
): Promise<void> {
  const video = page.video();
  if (!video) throw new Error("No video attached to page");
  await page.close();
  const src = await video.path();
  fs.copyFileSync(src, path.join(OUT_DIR, target));
}

test.describe("M5 three-way workflow video", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");

  test("code panel pulse-syncs as the diagram selection changes", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
    await page.waitForTimeout(800);

    // 1. Open the code view.
    await page.getByRole("button", { name: /code/i }).click();
    await page.waitForSelector("[data-code-view] .monaco-editor .view-line", { timeout: 15_000 });
    await page.waitForTimeout(800);

    // 2. Diagram-side selection on `greet` -> pulse + scroll to lines 15-20.
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("vg-chat-about-node", {
        detail: { nodeId: "module/greet.fn" },
      }));
    });
    await page.waitForTimeout(1200); // let the 600ms pulse run + settle

    // 3. Switch to `calculate_area` (lines 10-12) -- the pulse should
    //    fade then re-fire on a higher range, demonstrating the
    //    clear-and-reapply path.
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("vg-chat-about-node", {
        detail: { nodeId: "module/calculate_area.fn" },
      }));
    });
    await page.waitForTimeout(1200);

    // 4. One more selection on a class for variety -- Shape (line 23+).
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("vg-chat-about-node", {
        detail: { nodeId: "module/Shape.class" },
      }));
    });
    await page.waitForTimeout(1500);

    await saveVideo(page, "workflow-three-way-sync.webm");
  });
});
