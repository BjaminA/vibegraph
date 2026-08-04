/**
 * U2 — three stills for the human review pass.
 *   1. rest:  cli:main thread settled, no hover (glow + cross-file dashes)
 *   2. hover: seed hovered (dim-non-focus binary attention)
 *   3. wide:  full viewport with side-panel visible (context)
 *
 * Gated by VG_CAPTURE=1 to stay out of `npm test`.
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "ui-u2");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("U2 thread-edges stills", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("rest / hover / wide", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.waitForTimeout(2400);

    await page.screenshot({ path: path.join(OUT_DIR, "rest.png"), fullPage: false });

    const seed = page.locator(".vg-thread-node-seed").first();
    await seed.hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, "hover.png"), fullPage: false });

    // Move mouse off so subsequent shot is clean again.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, "wide.png"), fullPage: true });
  });
});
