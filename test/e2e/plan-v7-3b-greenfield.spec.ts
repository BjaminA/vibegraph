/**
 * PLAN-v7 Stage 3b (gate) — greenfield: describe → drafted architecture →
 * ALL-GHOST system view → ratify, on a BLANK project (zero .py files).
 *
 * The whole-system inversion proven on its hardest case: there is no honest
 * tier at all, so the ghost architecture is the entire view, every card
 * labelled PLANNED, and nothing pretends to be code.
 *
 *   1. DESCRIBE — the toolbar Describe control → description → submit. The
 *      server drafts via `claude -p` (stubbed: VG_CLAUDE_BIN, M10R.7). The
 *      system view auto-opens with 3 ghosts and ZERO solid cards.
 *   2. HONESTY FLOOR — the stub claims a fabricated quote for the cache
 *      ("a memcached cluster", not in the description); enforceGrounding
 *      demotes it, so the ⚠ INFERRED chip must render. Grounded quotes
 *      ("a flask API", "a sqlite store") render as quote chips.
 *   3. RATIFY — the plan artifact lands in the blank project's .vibegraph/
 *      (drafted: true, ratifiedAt stamped); ghosts persist; gate closes.
 *   4. RELOAD — the ratified all-ghost architecture survives a fresh load.
 *
 * Cleanup removes the .vibegraph/ dir — on THIS fixture it is created by the
 * test (the blank fixture is just a .gitkeep), unlike flask_demo's tracked one.
 *
 * Boot (see package.json test:e2e-plan-v7-3b):
 *   VG_FIXTURE=test/fixtures/greenfield_blank VG_PORT=4237 PORT=4237 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/run_effects/fake_claude_system.mjs" \
 *     npx playwright test test/e2e/plan-v7-3b-greenfield.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BLANK = FIXTURE.includes("greenfield_blank");
const VG_DIR = join(process.cwd(), FIXTURE, ".vibegraph");
const PLAN_PATH = join(VG_DIR, "system-plan.json");
const SHOT_DIR = "reviews/m-plan-v7-3b";

const DESCRIPTION = "a flask API with a sqlite store and a redis cache";

test.use({ video: "on" });

test.describe("PLAN-v7 3b — greenfield describe → all-ghost architecture → ratify", () => {
  test.skip(!IS_BLANK, "Requires VG_FIXTURE=test/fixtures/greenfield_blank");

  test.beforeAll(() => {
    rmSync(VG_DIR, { recursive: true, force: true });
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    rmSync(VG_DIR, { recursive: true, force: true });
  });

  test("describe proposes an all-ghost architecture; fabricated grounding is demoted; ratify persists across reload", async ({ page }) => {
    await page.goto("/");
    // Blank project: no thread index, no files — the toolbar is the anchor.
    await expect(page.locator('button:has-text("Describe")')).toBeVisible({ timeout: 15_000 });

    // ── 1. DESCRIBE ─────────────────────────────────────────────────────
    await page.click('button:has-text("Describe")');
    await expect(page.locator("[data-describe-bar]")).toBeVisible({ timeout: 5_000 });
    await page.fill("[data-describe-text]", DESCRIPTION);
    await page.click("[data-describe-submit]");

    // The proposal auto-opens the system view: ALL ghost, ZERO solid.
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator("[data-subsystem-node]")).toHaveCount(0);
    await expect(page.locator("[data-system-plan-bar]")).toBeVisible();
    await expect(page.locator("[data-system-plan-bar]")).toContainText(/Claude proposed architecture/i);

    // ── 2. HONESTY FLOOR — grounded quotes vs demoted fabrication ──────
    await expect(page.locator("[data-plan-grounded]")).toHaveCount(2);
    await expect(page.locator("[data-plan-grounded]").first()).toContainText("a flask API");
    // M-GF3.1 — the grounding quote wraps; it is never single-line-ellipsized.
    const chipWs = await page
      .locator("[data-plan-grounded]")
      .first()
      .evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(chipWs).toBe("normal");
    // The stub's fabricated "a memcached cluster" quote was demoted server-side.
    await expect(page.locator('[data-planned-subsystem][data-subsystem-id="cache"] [data-plan-inferred]'))
      .toContainText(/INFERRED/i);
    // Ghost-to-ghost plan edges render (both endpoints planned).
    await expect(page.locator('.react-flow__edge[data-id="plan:backend db"]')).toHaveCount(1);

    // Nothing persisted yet.
    expect(existsSync(PLAN_PATH)).toBe(false);
    await page.screenshot({ path: join(SHOT_DIR, "greenfield-ghost-architecture.png") });

    // ── 3. RATIFY ───────────────────────────────────────────────────────
    await page.click("[data-system-plan-accept]");
    await expect.poll(() => existsSync(PLAN_PATH), { timeout: 10_000 }).toBe(true);
    const persisted = JSON.parse(readFileSync(PLAN_PATH, "utf-8"));
    expect(persisted.drafted).toBe(true);
    expect(persisted.description).toBe(DESCRIPTION);
    expect(typeof persisted.ratifiedAt).toBe("string");
    expect(persisted.subsystems.find((s: any) => s.id === "cache").groundedIn).toBe(null);

    await expect(page.locator("[data-system-plan-bar]")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator('[data-planned-subsystem][data-plan-ratified="true"]')).toHaveCount(3);

    // ── 4. RELOAD — the ratified plan is the project's durable blueprint ─
    await page.reload();
    await expect(page.locator('button:has-text("System")')).toBeVisible({ timeout: 15_000 });
    await page.click('button:has-text("System")');
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator("[data-subsystem-node]")).toHaveCount(0);
    await expect(page.locator("[data-system-plan-bar]")).toHaveCount(0);

    await page.screenshot({ path: join(SHOT_DIR, "greenfield-after-ratify-reload.png") });
  });
});
