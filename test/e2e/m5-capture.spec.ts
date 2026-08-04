/**
 * M5 capture specs — code view + Monaco vibegraph-dark theme.
 *
 * Gated by VG_CAPTURE=1. Output: reviews/m5-code/.
 *
 *   # Wave 1: MonacoOverlay theme verification
 *   VG_CAPTURE=1 npx playwright test test/e2e/m5-capture.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "m5-code");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Workflow video is recorded separately by m5-workflow-capture.spec.ts
// to avoid playwright's "test.use(video) can't live inside describe"
// constraint that bit us in M4b. Run that spec separately with
// VG_CAPTURE=1.

test.describe("M5 wave 4 — code view pulse-highlight + three-way sync", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");

  test("pulse appears on the selected node's range", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: /code/i }).click();
    await page.waitForSelector("[data-code-view] .monaco-editor .view-line", { timeout: 15_000 });
    await page.waitForTimeout(400);

    // Select greet -> Monaco scrolls + pulses lines 15-20.
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("vg-chat-about-node", {
        detail: { nodeId: "module/greet.fn" },
      }));
    });
    // Catch the pulse mid-animation; 300ms is the midpoint of the 600ms
    // keyframe, the peak of the colour-mix.
    await page.waitForTimeout(300);
    const out = path.join(OUT_DIR, "wave4-pulse-greet.png");
    await page.screenshot({ path: out, fullPage: false });
    expect(fs.statSync(out).size).toBeGreaterThan(8_000);
    // Verify the pulse class actually landed on a line.
    const pulseCount = await page.locator("[data-code-view] .vg-pulse-line").count();
    expect(pulseCount).toBeGreaterThan(0);
  });
});

test.describe("M5 wave 2 — read-only CodeView panel", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");

  test("Code button opens panel showing active file source", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
    await page.waitForTimeout(600);

    // Code button is enabled as soon as a file is open (no node selection
    // required, unlike Thread).
    await page.getByRole("button", { name: /code/i }).click();
    await page.waitForSelector("[data-code-view]", { timeout: 10_000 });
    // Editor mounts after the file-source WS round-trip.
    await page.waitForSelector("[data-code-view] .monaco-editor .view-line", { timeout: 15_000 });
    await page.waitForTimeout(800);

    // Bbox sanity: panel must occupy the right side, full height.
    const bbox = await page.locator("[data-code-view]").boundingBox();
    expect(bbox?.height ?? 0).toBeGreaterThan(700);

    const out = path.join(OUT_DIR, "wave2-code-view.png");
    await page.screenshot({ path: out, fullPage: false });
    expect(fs.statSync(out).size).toBeGreaterThan(8_000);
  });
});

test.describe("M5 wave 1 — vibegraph-dark in MonacoOverlay", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");

  test("monaco overlay renders in vibegraph-dark theme", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
    await page.waitForTimeout(600);

    // Open the modal editor on a function via the vg-edit-node event.
    // Bypass react-flow click interception, same pattern as the m4b
    // capture specs.
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("vg-edit-node", {
        detail: { nodeId: "module/calculate_area.fn" },
      }));
    });
    // Wait for Monaco to mount and render syntax-highlighted source.
    await page.waitForSelector(".monaco-editor .view-lines .view-line", { timeout: 15_000 });
    // Give the theme a beat to apply post-mount.
    await page.waitForTimeout(700);

    // Sanity: Monaco mounts as a full-height panel on the right
    // (44% wide). Earlier capture run found the editor at y=947
    // height=5 because ViewTransition's transform created a new
    // containing block for position:fixed -- the wrapper was removed
    // and the bbox should now match the overlay's intent.
    const bbox = await page.locator(".monaco-editor").first().boundingBox();
    expect(bbox?.height ?? 0).toBeGreaterThan(400);
    expect(bbox?.y ?? 1000).toBeLessThan(100);

    const out = path.join(OUT_DIR, "wave1-monaco-overlay.png");
    await page.screenshot({ path: out, fullPage: false });
    expect(fs.statSync(out).size).toBeGreaterThan(8_000);
  });
});
