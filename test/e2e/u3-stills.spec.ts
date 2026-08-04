/**
 * U3.1 — capture stills for review.
 *   1. tooltip-hover:    cli:main seed hovered, tooltip with Monaco
 *   2. tooltip-pinned:   tooltip pinned, Ask-Claude input focused
 *   3. tooltip-terminal: external/parser.parse_args hovered, placeholder
 *   4. overlap-survey:   capture every other cli:main thread node's
 *                        layout to spot remaining overlaps the user
 *                        reported.
 *
 * Also captures one still per other entry-point in flask_demo so we can
 * check the layout invariants beyond cli:main.
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve(__dirname, "..", "..", "reviews", "ui-u3");
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("U3.1 stills + overlap survey", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture");
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("tooltip stills + overlap survey on flask_demo", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // ── cli:main: tooltip hover + pin + ask
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    // Move cursor off-canvas so the post-navigation mouse position
    // doesn't auto-open a tooltip when fitView settles a node under it.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1800);

    await page.screenshot({ path: path.join(OUT_DIR, "cli-main-layout.png"), fullPage: false });

    const seed = page.locator(".vg-thread-node-seed").first();
    await seed.hover();
    // Wait for Monaco to mount AND render its first line. The lighter-gray
    // empty rectangle was Monaco mid-mount; .view-line is the post-render
    // marker.
    await page.locator("[data-thread-tooltip] .monaco-editor .view-line").first()
      .waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, "tooltip-hover.png"), fullPage: false });

    await seed.click(); // pin
    await page.waitForTimeout(400);
    const askInput = page.locator('[data-thread-tooltip] input[placeholder*="Ask Claude"]');
    await askInput.click();
    await askInput.fill("Add input validation: name must be non-empty");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, "tooltip-pinned.png"), fullPage: false });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // ── terminal node tooltip
    const ext = page.locator('.react-flow__node[data-id="external:parser.parse_args"]').first();
    await ext.hover();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, "tooltip-terminal.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // ── overlap survey: every entry point in flask_demo
    const entries = [
      { id: "cli.py:main",                     name: "cli-main" },
      { id: "app.py:create_user_route",        name: "route-create_user" },
      { id: "app.py:get_user_route",           name: "route-get_user" },
      { id: "app.py:list_users_route",         name: "route-list_users" },
      { id: "test_flow.py:test_create_then_find", name: "test-create_then_find" },
      { id: "test_flow.py:test_list_returns_users", name: "test-list_returns_users" },
    ];

    for (const e of entries) {
      // Back to the index.
      await page.click('[data-side-panel-tab="threads"]').catch(() => {});
      await page.waitForTimeout(200);
      // Some entries might not exist; tolerate.
      const row = page.locator(`[data-thread-index-row][data-entry-id="${e.id}"]`);
      if ((await row.count()) === 0) continue;
      await row.click();
      await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT_DIR, `layout-${e.name}.png`), fullPage: false });
    }
  });
});
