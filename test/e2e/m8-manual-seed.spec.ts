/**
 * M8.3.3 — manual seed UX.
 *
 * Pin a function via the NodeActionStrip's pin button → server appends
 * to .vibegraph/manual_seeds.json + re-runs discovery + extraction →
 * the new entry appears in the side panel's Threads tab as kind=manual.
 *
 * This spec only runs when VG_FIXTURE points at flask_demo (the only
 * fixture with the SidePanel infra). To avoid mutating the committed
 * .vibegraph/manual_seeds.json, the test snapshots the file before the
 * pin click and restores it afterwards.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo PORT=4203 VG_PORT=4203 \
 *     npx playwright test test/e2e/m8-manual-seed.spec.ts
 *
 * (PORT goes to the server; VG_PORT goes to playwright.config.ts.)
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const SEEDS_PATH = FIXTURE
  ? path.resolve(FIXTURE, ".vibegraph", "manual_seeds.json")
  : null;

test.describe("M8.3.3 — manual seed UX", () => {
  let savedSeeds: string | null = null;

  test.beforeAll(() => {
    if (!IS_FLASK || !SEEDS_PATH) return;
    try {
      savedSeeds = readFileSync(SEEDS_PATH, "utf-8");
    } catch {
      savedSeeds = null;
    }
  });

  test.afterAll(() => {
    if (!IS_FLASK || !SEEDS_PATH) return;
    if (savedSeeds === null) return;
    writeFileSync(SEEDS_PATH, savedSeeds);
  });

  test("pin button appends to manual_seeds.json and surfaces in the side panel", async ({ page }) => {
    test.skip(!IS_FLASK,
      "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

    await page.goto("/");
    // Boot lands on the thread index. Switch to the Files tab and open
    // cli.py. `cmd_list` is a plain helper — not a route, not a test,
    // not called cross-file — so it's not auto-detected, which makes it
    // a clean target for the manual-seed flow: the new entry should
    // appear under kind=manual.
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="cli.py"]');
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });

    // The action strip is hover-revealed and react-flow's edge
    // interaction layer often intercepts the hover; dispatch
    // vg-add-manual-seed directly to avoid the flake while still
    // exercising the same server path the pin button takes (same
    // pattern m4b-aero-capture uses for vg-chat-about-node).
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("vg-add-manual-seed", {
        detail: { nodeId: "module/cmd_list.fn" },
      }));
    });

    // Re-discovery + re-extraction takes a few hundred ms; the new
    // envelope arrives via project-update; side panel re-renders.
    await page.waitForTimeout(2000);

    // First check the seeds file actually picked up the pin — if this
    // fails, the persistence path is broken regardless of what the UI
    // shows.
    if (SEEDS_PATH) {
      const after = JSON.parse(readFileSync(SEEDS_PATH, "utf-8"));
      const seeds = Array.isArray(after) ? after : (after.seeds ?? []);
      const found = seeds.find(
        (s: any) => s.file === "cli.py" && s.irNodeId === "module/cmd_list.fn",
      );
      expect(found, "manual_seeds.json should contain the new pin").toBeDefined();
    }

    // Switch back to Threads tab and confirm cli:cmd_list now appears.
    await page.click('[data-side-panel-tab="threads"]');
    await expect(
      page.locator('[data-thread-tree-row][data-entry-id="cli.py:cmd_list"]'),
    ).toBeVisible({ timeout: 5000 });
  });
});
