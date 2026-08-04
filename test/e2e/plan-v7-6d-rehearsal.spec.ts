/**
 * PLAN-v7 6d (pre-flight) — the FULL PIPELINE against REAL `claude -p`:
 * describe → drafted architecture → ratify → drafted roadmap → ratify →
 * run → judge every gate → complete, on a blank directory, in one sitting.
 *
 * This is the automated PRE-FLIGHT for the human dress rehearsal: the
 * driver plays a permissive judge (accept every green floor, consent when
 * the effect gate asks) so the machinery is proven live before Ben sits
 * down and exercises real judgment. It is NOT part of the test chain:
 * gated on VG_REHEARSAL=1 (real Claude spawns, minutes-long, billed).
 *
 * Artifacts: screenshots + the generated app + the ratified artifacts are
 * copied to reviews/m-plan-v7-6/ before cleanup.
 *
 * Boot (see package.json test:e2e-plan-v7-6d):
 *   VG_REHEARSAL=1 VG_FIXTURE=test/fixtures/rehearsal_blank VG_PORT=4243 PORT=4243 \
 *     npx playwright test test/e2e/plan-v7-6d-rehearsal.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const ENABLED = process.env.VG_REHEARSAL === "1" && FIXTURE.includes("rehearsal_blank");
const ROOT = join(process.cwd(), FIXTURE);
const SHOT_DIR = "reviews/m-plan-v7-6";

const DESCRIPTION =
  "a flask API for bookmarks with a sqlite store: add a bookmark, list bookmarks, " +
  "delete a bookmark by id, and url validation before anything is stored";

test.use({ video: "on" });

function cleanFixture() {
  rmSync(join(ROOT, ".vibegraph"), { recursive: true, force: true });
  for (const f of readdirSync(ROOT)) {
    if (f !== ".gitkeep") rmSync(join(ROOT, f), { recursive: true, force: true });
  }
}

function snapshotArtifacts() {
  const dst = join(SHOT_DIR, "app-snapshot");
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(ROOT)) {
    if (f === ".gitkeep") continue;
    cpSync(join(ROOT, f), join(dst, f), { recursive: true });
  }
}

test.describe("PLAN-v7 6d — full live pipeline (real claude)", () => {
  test.skip(!ENABLED, "Requires VG_REHEARSAL=1 + VG_FIXTURE=test/fixtures/rehearsal_blank (real Claude spawns)");
  test.setTimeout(20 * 60_000); // real drafting: minutes, not seconds

  test.beforeAll(() => {
    cleanFixture();
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test("describe → ratify architecture → ratify roadmap → run → judge each gate → complete", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('button:has-text("Describe")')).toBeVisible({ timeout: 20_000 });

    // ── 1. DESCRIBE → drafted ghost architecture ──────────────────────────
    await page.click('button:has-text("Describe")');
    await expect(page.locator("[data-describe-bar]")).toBeVisible({ timeout: 5_000 });
    await page.fill("[data-describe-text]", DESCRIPTION);
    await page.click("[data-describe-submit]");

    const planBar = page.locator("[data-system-plan-bar]");
    await expect(planBar).toBeVisible({ timeout: 180_000 }); // real claude
    await expect(page.locator("[data-planned-subsystem]").first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: join(SHOT_DIR, "1-ghost-architecture.png") });

    // ── 2. RATIFY the architecture ────────────────────────────────────────
    await page.click("[data-system-plan-accept]");
    await expect(planBar).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => existsSync(join(ROOT, ".vibegraph", "system-plan.json")), { timeout: 15_000 }).toBe(true);

    // ── 3. DRAFT + RATIFY the roadmap ─────────────────────────────────────
    const panel = page.locator("[data-roadmap-panel]");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await page.click("[data-roadmap-draft]");
    await expect(panel).toHaveAttribute("data-roadmap-state", "proposed", { timeout: 180_000 });
    const itemCount = await page.locator("[data-roadmap-item]").count();
    expect(itemCount).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: join(SHOT_DIR, "2-roadmap-proposed.png") });

    await page.click("[data-roadmap-ratify]");
    await expect(panel).toHaveAttribute("data-roadmap-state", "ratified", { timeout: 15_000 });
    await expect.poll(() => existsSync(join(ROOT, ".vibegraph", "build-plan.json")), { timeout: 15_000 }).toBe(true);

    // ── 4. RUN — judge every gate (permissive pre-flight judge) ───────────
    await page.click("[data-run-start]");

    const gate = page.locator("[data-changeset-gate]");
    const note = page.locator("[data-run-note]");
    let gates = 0;
    let consents = 0;

    // Loop: each iteration handles one gate (consent if asked, then accept)
    // until the run reports completion or pauses on a failure.
    for (let i = 0; i < itemCount + 4; i++) {
      const outcome = await Promise.race([
        gate.waitFor({ state: "visible", timeout: 300_000 }).then(() => "gate" as const),
        note.filter({ hasText: /complete/i }).waitFor({ timeout: 300_000 }).then(() => "complete" as const),
        note.filter({ hasText: /paused|stopped/i }).waitFor({ timeout: 300_000 }).then(() => "paused" as const),
      ]);
      if (outcome === "complete") break;
      if (outcome === "paused") {
        await page.screenshot({ path: join(SHOT_DIR, `x-paused-at-gate-${gates}.png`) });
        throw new Error(`run paused unexpectedly: ${await note.textContent()}`);
      }
      gates++;
      // 6b — an effectful check asks first; the pre-flight judge consents.
      const effectGate = page.locator("[data-changeset-effect-gate]");
      if (await effectGate.isVisible().catch(() => false)) {
        consents++;
        await page.screenshot({ path: join(SHOT_DIR, `3-gate-${gates}-consent.png`) });
        await page.click("[data-changeset-consent]");
        await expect(page.locator("[data-check-consented]")).toBeVisible({ timeout: 120_000 });
      }
      try {
        await expect(page.locator("[data-changeset-accept]")).toBeEnabled({ timeout: 120_000 });
      } catch {
        // Fail FAST with the gate's honest reason — a red floor at a gate is
        // a pre-flight finding, not a timeout mystery.
        await page.screenshot({ path: join(SHOT_DIR, `x-red-floor-gate-${gates}.png`) });
        const checkText = (await page.locator("[data-changeset-check]").textContent().catch(() => "")) ?? "";
        throw new Error(`pre-flight: floor stayed red at gate ${gates} — ${checkText.trim().slice(0, 400)}`);
      }
      await page.screenshot({ path: join(SHOT_DIR, `3-gate-${gates}.png`) });
      await page.click("[data-changeset-accept]");
      await expect(gate).toHaveCount(0, { timeout: 60_000 });
    }

    // ── 5. THE PAYOFF — every increment built, the architecture is solid ──
    await expect(note).toContainText(/complete/i, { timeout: 60_000 });
    await expect(page.locator("[data-roadmap-progress]")).toContainText(`${itemCount}/${itemCount} built`);
    // The whole run lives on the System view — do NOT navigate. The toolbar
    // "System" button TOGGLES (active → back to diagram), and a non-strict
    // `button:has-text("System")` click substring-matches the view's own
    // "Subsystems" mode toggle first (round-3 pre-flight finding: it flipped
    // the canvas into thread-interaction mode and hid every subsystem card).
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "subsystems");
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator("[data-subsystem-node]").first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: join(SHOT_DIR, "4-complete-solid.png") });

    console.log(`[6d pre-flight] gates judged: ${gates}, consents given: ${consents}, items built: ${itemCount}`);
    snapshotArtifacts();
  });

  test.afterAll(() => {
    cleanFixture();
  });
});
