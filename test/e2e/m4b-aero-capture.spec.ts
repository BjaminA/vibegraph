/**
 * M4b wave 5 — aero_demo seed still capture.
 *
 * Per PLAN.md S1.5 M4b: "aero_demo gets a screenshot per seed (clean,
 * fits the snapshot test)". This spec captures the compute_drag thread
 * to reviews/m4b-thread/aero_demo-compute_drag.png.
 *
 * Gated by VG_CAPTURE=1 so `npm test` stays clean. Run:
 *   VG_CAPTURE=1 VG_FIXTURE=test/fixtures/threads/aero_demo \
 *     npx playwright test test/e2e/m4b-aero-capture.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "m4b-thread");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_AERO = FIXTURE.includes("aero_demo");

test.describe("aero_demo seed still", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");
  test.skip(!IS_AERO, "Requires VG_FIXTURE=test/fixtures/threads/aero_demo");

  test("compute_drag thread renders cleanly", async ({ page }) => {
    await page.goto("/");
    // M8.3.2: directory fixtures now boot into the thread-index
    // launchpad. Switch to the Files tab in the side panel and click
    // main.py to land on the diagram view (existing test seeded the
    // chat context off a function-def node).
    await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="main.py"]');
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
    await page.waitForTimeout(600); // settle node-enter (240ms) + edge-draw (320ms)

    // Dispatch vg-chat-about-node to set compute_drag as the chat
    // context -- avoids react-flow click interception from nested
    // assignment cards. Same pattern motion.spec.ts uses for vg-hide-node.
    // The event also opens the chat panel; close it again so the
    // ThreadView canvas has the full viewport height for fitView.
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("vg-chat-about-node", {
        detail: { nodeId: "module/compute_drag.fn" },
      }));
    });
    await page.getByTitle("Close chat").first().click();
    await page.getByRole("button", { name: "Thread", exact: true }).click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 15_000 });

    // Let the force layout settle past first-tick reshuffles.
    await page.waitForTimeout(1000);
    const out = path.join(OUT_DIR, "aero_demo-compute_drag.png");
    await page.screenshot({ path: out, fullPage: false });
    expect(fs.statSync(out).size).toBeGreaterThan(8_000);
  });
});
