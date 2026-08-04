/**
 * OPUS-SHOWDOWN — VibeGraph arm: the FULL greenfield pipeline on REAL
 * claude, forced to Opus 5 and token-metered via test/tools/claude_meter.sh
 * (VG_CLAUDE_BIN). Near-copy of plan-v7-6d-rehearsal.spec.ts with
 * Opus-sized timeouts; the driver plays the same permissive judge (accept
 * every green floor, consent when asked) so the arm is machine-driven
 * end-to-end, matching the plain one-shot arm's zero-human condition.
 *
 * NOT part of the test chain: gated on VG_SHOWDOWN=1 (real Opus spawns,
 * minutes-long, billed).
 *
 * Artifacts → reviews/opus-showdown-2026-08/: screenshots, the generated
 * app + .vibegraph plan artifacts (vibegraph-app/), meter JSONL (written by
 * the wrapper). Snapshot happens in afterAll so a mid-build failure still
 * preserves the partial app for the report.
 *
 * Boot (see package.json test:e2e-showdown):
 *   VG_SHOWDOWN=1 VG_FIXTURE=test/fixtures/showdown_blank VG_PORT=4270 PORT=4270 \
 *     VG_CLAUDE_BIN=$PWD/test/tools/claude_meter.sh \
 *     npx playwright test test/e2e/opus-showdown.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const ENABLED = process.env.VG_SHOWDOWN === "1" && FIXTURE.includes("showdown_blank");
const ROOT = join(process.cwd(), FIXTURE);
const SHOT_DIR = "reviews/opus-showdown-2026-08";

// Must match reviews/opus-showdown-2026-08/SPEC.md verbatim — the plain arm
// reads that file; both arms get the identical text.
const DESCRIPTION =
  "Build `habitkit`, a Python CLI habit tracker. Commands: `add <name>` (register " +
  "a habit), `done <name> [--date YYYY-MM-DD]` (mark done, default today), " +
  "`streak <name>` (current consecutive-day streak ending today or yesterday), " +
  "`report` (table of all habits: total completions, current streak, best " +
  "streak). Persistence: single JSON file `habits.json` next to the code. Python " +
  "3 stdlib only. Include unit tests covering streak edge cases (gap breaks " +
  "streak, done-today vs done-yesterday, duplicate same-day marks are " +
  "idempotent). Clean module split; `python3 -m habitkit ...` or `python3 cli.py " +
  "...` both acceptable.";

test.use({ video: "on" });

function cleanFixture() {
  rmSync(join(ROOT, ".vibegraph"), { recursive: true, force: true });
  for (const f of readdirSync(ROOT)) {
    if (f !== ".gitkeep") rmSync(join(ROOT, f), { recursive: true, force: true });
  }
}

function snapshotArtifacts() {
  const dst = join(SHOT_DIR, "vibegraph-app");
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(ROOT)) {
    if (f === ".gitkeep") continue;
    cpSync(join(ROOT, f), join(dst, f), { recursive: true });
  }
}

test.describe("OPUS-SHOWDOWN — VibeGraph greenfield arm (real Opus 5)", () => {
  test.skip(!ENABLED, "Requires VG_SHOWDOWN=1 + VG_FIXTURE=test/fixtures/showdown_blank (real billed Opus spawns)");
  test.setTimeout(40 * 60_000); // Opus drafting: sized ~2.5x the sonnet-measured rehearsal

  test.beforeAll(() => {
    cleanFixture();
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test("describe → ratify architecture → ratify roadmap → run → judge each gate → complete", async ({ page }) => {
    const t0 = Date.now();
    await page.goto("/");
    await expect(page.locator('button:has-text("Describe")')).toBeVisible({ timeout: 20_000 });

    // ── 1. DESCRIBE → drafted ghost architecture ──────────────────────────
    await page.click('button:has-text("Describe")');
    await expect(page.locator("[data-describe-bar]")).toBeVisible({ timeout: 5_000 });
    await page.fill("[data-describe-text]", DESCRIPTION);
    await page.click("[data-describe-submit]");

    const planBar = page.locator("[data-system-plan-bar]");
    await expect(planBar).toBeVisible({ timeout: 420_000 }); // real Opus
    await expect(page.locator("[data-planned-subsystem]").first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: join(SHOT_DIR, "1-ghost-architecture.png") });
    console.log(`[showdown] architecture drafted at +${Math.round((Date.now() - t0) / 1000)}s`);

    // ── 2. RATIFY the architecture ────────────────────────────────────────
    await page.click("[data-system-plan-accept]");
    await expect(planBar).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => existsSync(join(ROOT, ".vibegraph", "system-plan.json")), { timeout: 15_000 }).toBe(true);

    // ── 3. DRAFT + RATIFY the roadmap ─────────────────────────────────────
    const panel = page.locator("[data-roadmap-panel]");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await page.click("[data-roadmap-draft]");
    await expect(panel).toHaveAttribute("data-roadmap-state", "proposed", { timeout: 420_000 });
    const itemCount = await page.locator("[data-roadmap-item]").count();
    expect(itemCount).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: join(SHOT_DIR, "2-roadmap-proposed.png") });
    console.log(`[showdown] roadmap proposed (${itemCount} items) at +${Math.round((Date.now() - t0) / 1000)}s`);

    await page.click("[data-roadmap-ratify]");
    await expect(panel).toHaveAttribute("data-roadmap-state", "ratified", { timeout: 15_000 });
    await expect.poll(() => existsSync(join(ROOT, ".vibegraph", "build-plan.json")), { timeout: 15_000 }).toBe(true);

    // ── 4. RUN — judge every gate (permissive machine judge) ──────────────
    await page.click("[data-run-start]");

    const gate = page.locator("[data-changeset-gate]");
    const note = page.locator("[data-run-note]");
    let gates = 0;
    let consents = 0;
    let modifies = 0;

    for (let i = 0; i < itemCount + 8; i++) {
      const outcome = await Promise.race([
        gate.waitFor({ state: "visible", timeout: 480_000 }).then(() => "gate" as const),
        note.filter({ hasText: /complete/i }).waitFor({ timeout: 480_000 }).then(() => "complete" as const),
        note.filter({ hasText: /paused|stopped/i }).waitFor({ timeout: 480_000 }).then(() => "paused" as const),
      ]);
      if (outcome === "complete") break;
      if (outcome === "paused") {
        await page.screenshot({ path: join(SHOT_DIR, `x-paused-at-gate-${gates}.png`) });
        throw new Error(`run paused unexpectedly: ${await note.textContent()}`);
      }
      gates++;
      const effectGate = page.locator("[data-changeset-effect-gate]");
      if (await effectGate.isVisible().catch(() => false)) {
        consents++;
        await page.screenshot({ path: join(SHOT_DIR, `3-gate-${gates}-consent.png`) });
        await page.click("[data-changeset-consent]");
        await expect(page.locator("[data-check-consented]")).toBeVisible({ timeout: 180_000 });
      }
      try {
        await expect(page.locator("[data-changeset-accept]")).toBeEnabled({ timeout: 180_000 });
      } catch {
        await page.screenshot({ path: join(SHOT_DIR, `x-red-floor-gate-${gates}-try${modifies}.png`) });
        const checkText = (await page.locator("[data-changeset-check]").textContent().catch(() => "")) ?? "";
        // Machine-judge policy for a red floor: what a human minimally does —
        // Modify once with the failure as feedback, let the builder redraft
        // through the same floor. Bounded (3 per run), then fail honestly.
        if (modifies < 3) {
          modifies++;
          console.log(`[showdown] red floor at gate ${gates}, modify #${modifies}: ${checkText.trim().slice(0, 160)}`);
          await page.click("[data-changeset-modify]");
          await page.fill(
            "[data-changeset-modify-input]",
            `The behavioural check failed: ${checkText.trim().slice(0, 300)} — reconcile the module and the check so the check passes. Fix whichever side is wrong; keep the check honest and meaningful.`,
          );
          await page.click("[data-changeset-modify-submit]");
          continue; // re-enter the race: redrafted gate (or pause) comes back
        }
        throw new Error(`showdown: floor stayed red at gate ${gates} after ${modifies} modifies — ${checkText.trim().slice(0, 400)}`);
      }
      await page.screenshot({ path: join(SHOT_DIR, `3-gate-${gates}.png`) });
      console.log(`[showdown] gate ${gates} accepted at +${Math.round((Date.now() - t0) / 1000)}s`);
      await page.click("[data-changeset-accept]");
      await expect(gate).toHaveCount(0, { timeout: 60_000 });
    }

    // ── 5. THE PAYOFF ─────────────────────────────────────────────────────
    await expect(note).toContainText(/complete/i, { timeout: 60_000 });
    await expect(page.locator("[data-roadmap-progress]")).toContainText(`${itemCount}/${itemCount} built`);
    // Do NOT navigate views here — the toolbar "System" button toggles, and a
    // non-strict has-text("System") click substring-matches "Subsystems"
    // (round-3 rehearsal finding).
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "subsystems");
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator("[data-subsystem-node]").first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: join(SHOT_DIR, "4-complete-solid.png") });

    console.log(
      `[showdown] DONE in ${Math.round((Date.now() - t0) / 1000)}s — gates: ${gates}, consents: ${consents}, items: ${itemCount}`,
    );
  });

  test.afterAll(() => {
    // Snapshot ALWAYS (even after a mid-build failure the partial app is
    // evidence), then leave the fixture clean for the next run.
    snapshotArtifacts();
    cleanFixture();
  });
});
