/**
 * M-RUN2.3 — the example-data UI, in the living renderer:
 *
 *   1. Run on a thread that reads a MISSING data file → the side-effect
 *      consent gate lists the fs effect AND the missing-data offer
 *      ("data/signals.csv doesn't exist yet" + the draft button) — a real
 *      affordance, not a dead-end decline (the old client pre-gate is gone).
 *   2. Draft → the full stubbed content renders for consent.
 *   3. Confirm → captured value from the example file, provenance names the
 *      file + the throwaway copy, and the real tree never gets the csv.
 *
 * Boot (see package.json test:e2e-run2-data):
 *   VG_FIXTURE=test/fixtures/threads/instance_demo VG_PORT=4254 PORT=4254 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/run_effects/fake_claude_json.mjs" \
 *     FAKE_SYNTH_RESPONSE='label,value\n0,7\n1,9' \
 *     npx playwright test test/e2e/m-run2-data-ui.spec.ts --reporter=list --workers=1
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_DEMO = FIXTURE.includes("instance_demo");
const ROOT = join(process.cwd(), FIXTURE);
const SHOT_DIR = "reviews/m-run2";

test.use({ video: "on" });

test.describe("M-RUN2.3 — example-data UI", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/threads/instance_demo");

  async function openThread(page: Page, entryId: string) {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click(`[data-thread-index-row][data-entry-id="${entryId}"]`);
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1100);
  }

  test("missing-file offer → drafted content consent → sandboxed run with honest provenance", async ({ page }) => {
    await openThread(page, "reader.py:load_rows");
    const node = page.locator('.react-flow__node[data-id="reader:count_rows"]');
    await expect(node).toBeVisible({ timeout: 10_000 });
    const box = await node.boundingBox();
    if (!box) throw new Error("no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("[data-thread-tooltip]")).toBeVisible({ timeout: 5_000 });
    await page.locator("[data-run-to-here]").click();

    // ── 1. the gate: fs effect listed + the missing-data offer ──────────
    const gate = page.locator("[data-effect-gate]");
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText("open");
    const missing = page.locator('[data-missing-data="data/signals.csv"]');
    await expect(missing).toBeVisible();
    await expect(missing).toContainText("doesn't exist yet");
    await page.screenshot({ path: join(SHOT_DIR, "data-gate-offer.png") });

    // ── 2. draft → full content shown for consent ───────────────────────
    await page.locator('[data-synth-data-offer="data/signals.csv"]').click();
    const proposal = page.locator("[data-data-proposal]");
    await expect(proposal).toBeVisible({ timeout: 15_000 });
    await expect(proposal).toContainText("made up");
    await expect(page.locator("[data-data-content]")).toContainText("label,value");
    await expect(page.locator("[data-data-content]")).toContainText("1,9");
    await page.screenshot({ path: join(SHOT_DIR, "data-proposal.png") });

    // ── 3. confirm → sandboxed run, honest provenance, clean tree ───────
    await page.locator("[data-data-confirm]").click();
    const result = page.locator("[data-run-result]");
    await expect(result).toHaveAttribute("data-run-outcome", "ok", { timeout: 20_000 });
    await expect(result).toContainText("3"); // count = 3 example lines
    await expect(result).toContainText("example file data/signals.csv (3 lines)");
    await expect(result).toContainText("throwaway copy");
    expect(existsSync(join(ROOT, "data", "signals.csv"))).toBe(false);
    await page.screenshot({ path: join(SHOT_DIR, "data-run-result.png") });
  });
});
