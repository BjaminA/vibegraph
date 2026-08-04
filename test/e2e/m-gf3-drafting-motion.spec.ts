/**
 * M-GF3.2 — the drafting working-states: the dead air between a submit and
 * a proposal now has a face, and every animation carrier unmounts when the
 * round-trip resolves (the bounded-loop rule).
 *
 *   1. DESCRIBE — submitting jumps to the system view IMMEDIATELY, where the
 *      animated drafting ghost card (marching-ants SVG border + spinner +
 *      the description) holds the space; when the (deliberately slow) stub
 *      replies, the card unmounts and the real ghosts land.
 *   2. ROADMAP — "Draft roadmap" swaps the panel to the drafting state:
 *      spinner header + 3 pulsing skeleton rows; the proposal replaces them.
 *   3. REDUCED MOTION — with prefers-reduced-motion the placeholder still
 *      renders (over an existing ghost canvas — the overlay branch) but the
 *      animations are statically short-circuited.
 *
 * Boot (see package.json test:e2e-gf3-motion):
 *   VG_FIXTURE=test/fixtures/greenfield_blank VG_PORT=4250 PORT=4250 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/run_effects/fake_claude_slow_draft.mjs" \
 *     npx playwright test test/e2e/m-gf3-drafting-motion.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BLANK = FIXTURE.includes("greenfield_blank");
const ROOT = join(process.cwd(), FIXTURE);
const VG_DIR = join(ROOT, ".vibegraph");
const SHOT_DIR = "reviews/m-gf3";

const DESCRIPTION = "a flask API with a sqlite store and a redis cache";

const RATIFIED_SYSTEM_PLAN = {
  version: "1",
  description: DESCRIPTION,
  subsystems: [
    { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
    { id: "db", kind: "db", label: "SQLite store", groundedIn: "a sqlite store" },
  ],
  edges: [{ from: "backend", to: "db", groundedIn: "a sqlite store" }],
  drafted: false,
  ratifiedAt: "2026-07-17T00:00:00.000Z",
};

test.use({ video: "on" });

test.describe("M-GF3.2 — drafting working-states", () => {
  test.skip(!IS_BLANK, "Requires VG_FIXTURE=test/fixtures/greenfield_blank");

  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.beforeEach(() => {
    rmSync(VG_DIR, { recursive: true, force: true });
  });
  test.afterAll(() => {
    rmSync(VG_DIR, { recursive: true, force: true });
  });

  test("describe mounts the animated drafting ghost immediately; the proposal replaces it", async ({ page }) => {
    await page.goto("/");
    await page.click('button:has-text("Describe")');
    await page.fill("[data-describe-text]", DESCRIPTION);
    await page.click("[data-describe-submit]");

    // The system view opens NOW — not when the proposal lands — and the
    // drafting ghost holds the space with the description on it.
    const ghost = page.locator("[data-drafting-ghost]");
    await expect(ghost).toBeVisible({ timeout: 2_000 });
    await expect(ghost).toContainText("Drafting architecture…");
    await expect(ghost).toContainText("a flask API with a sqlite store");
    // The marching-ants border + the breathe loop are genuinely animating.
    await expect(page.locator("[data-drafting-ghost] rect.vg-drafting-ants")).toHaveCount(1);
    const anims = await ghost.evaluate((el) => ({
      card: getComputedStyle(el).animationName,
      ants: getComputedStyle(el.querySelector("rect.vg-drafting-ants")!).animationName,
    }));
    expect(anims.card).toBe("vg-drafting-breathe-kf");
    expect(anims.ants).toBe("vg-drafting-ants-kf");
    await page.screenshot({ path: join(SHOT_DIR, "describe-drafting-ghost.png") });

    // The slow stub replies → the placeholder unmounts (bounded loop) and
    // the real ghosts land.
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(3, { timeout: 15_000 });
    await expect(ghost).toHaveCount(0);
  });

  test("draft roadmap swaps the panel to spinner + pulsing skeleton rows until the proposal lands", async ({ page }) => {
    mkdirSync(VG_DIR, { recursive: true });
    writeFileSync(join(VG_DIR, "system-plan.json"), JSON.stringify(RATIFIED_SYSTEM_PLAN, null, 2) + "\n", "utf-8");

    await page.goto("/");
    const panel = page.locator("[data-roadmap-panel]");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toHaveAttribute("data-roadmap-state", "empty");

    await page.click("[data-roadmap-draft]");
    await expect(panel).toHaveAttribute("data-roadmap-state", "drafting", { timeout: 2_000 });
    await expect(page.locator("[data-roadmap-skeleton]")).toHaveCount(3);
    await expect(panel).toContainText("Drafting roadmap…");
    await page.screenshot({ path: join(SHOT_DIR, "roadmap-drafting-skeleton.png") });

    await expect(panel).toHaveAttribute("data-roadmap-state", "proposed", { timeout: 15_000 });
    await expect(page.locator("[data-roadmap-skeleton]")).toHaveCount(0);
    await expect(page.locator("[data-roadmap-item]")).toHaveCount(2);
  });

  test("prefers-reduced-motion: the placeholder renders (overlay branch) with animations short-circuited", async ({ page }) => {
    mkdirSync(VG_DIR, { recursive: true });
    writeFileSync(join(VG_DIR, "system-plan.json"), JSON.stringify(RATIFIED_SYSTEM_PLAN, null, 2) + "\n", "utf-8");
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await page.click('button:has-text("Describe")');
    await page.fill("[data-describe-text]", DESCRIPTION);
    await page.click("[data-describe-submit]");

    // Over an existing ghost canvas this is the floating-overlay branch.
    const ghost = page.locator("[data-drafting-ghost]");
    await expect(ghost).toBeVisible({ timeout: 2_000 });
    const anims = await ghost.evaluate((el) => ({
      card: getComputedStyle(el).animationName,
      ants: getComputedStyle(el.querySelector("rect.vg-drafting-ants")!).animationName,
    }));
    expect(anims.card).toBe("none");
    expect(anims.ants).toBe("none");
  });
});
