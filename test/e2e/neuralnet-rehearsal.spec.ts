/**
 * NEURAL-NET dress rehearsal (pre-flight) — the FULL PIPELINE against REAL
 * `claude -p`, building a small PyTorch CNN from scratch: describe →
 * drafted architecture → ratify → drafted roadmap → ratify → run → judge
 * every gate → complete, on a blank directory, in one sitting — THEN the
 * ML exploration payoff: the Architecture lens paints the generated model,
 * and a model entry-point opens its forward() thread.
 *
 * This is the automated PRE-FLIGHT for the human sitting: the driver plays
 * a permissive judge (accept every green floor, consent when the effect
 * gate asks — and for ML code the floor consent-gates the model checks
 * essentially every time, since `model(x)` can never be proven pure). It
 * is NOT part of the test chain: gated on VG_REHEARSAL=1 (real Claude
 * spawns, minutes-long, billed).
 *
 * Mirrors test/e2e/plan-v7-6d-rehearsal.spec.ts exactly; the only deltas
 * are the DESCRIPTION and the neural-net payoff checkpoints after N/N built.
 *
 * Boot (see package.json test:e2e-neuralnet-rehearsal):
 *   VG_REHEARSAL=1 VG_FIXTURE=test/fixtures/neuralnet_blank VG_PORT=4247 PORT=4247 \
 *     npx playwright test test/e2e/neuralnet-rehearsal.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
// Trial sweep: any *_blank fixture is a valid greenfield target, so the
// gate accepts neuralnet_blank (the original rehearsal) or an explicit
// VG_TRIAL_DESCRIPTION run against another blank fixture.
const ENABLED = process.env.VG_REHEARSAL === "1"
  && (FIXTURE.includes("neuralnet_blank")
      || (!!process.env.VG_TRIAL_DESCRIPTION && FIXTURE.includes("_blank")));
const ROOT = join(process.cwd(), FIXTURE);
const SHOT_DIR = process.env.VG_TRIAL_SHOTS ?? "reviews/neuralnet-test";

// VG_TRIAL_DESCRIPTION lets one driver run several different builds
// (the trial sweep); absent, it keeps the original CNN rehearsal verbatim
// so the existing test:e2e-neuralnet-rehearsal is unchanged.
const DESCRIPTION =
  process.env.VG_TRIAL_DESCRIPTION ??
  ("a small convolutional neural network image classifier in pytorch: a CNN model " +
  "class with two convolutional layers and two linear layers, a synthetic dataset " +
  "module that generates random image tensors and labels, a training loop that runs " +
  "a few epochs over the synthetic batches, and an evaluation function that reports accuracy");

test.use({ video: "on" });

// A trial may SEED the blank with input data (a CSV the build is meant to
// read). Blowing that away leaves the builder writing a loader for a file
// that does not exist, so the seed survives the clean — everything the
// pipeline itself produced does not.
// Trial 4 seeded logs/ and had it deleted, so the CLI was built against a
// format the builder invented and never saw the real files. Whitelisting
// one hardcoded name was the bug; name the seed dirs per trial instead.
const SEED_DIRS = new Set(
  (process.env.VG_TRIAL_SEED_DIRS ?? "data,logs,input,fixtures")
    .split(",").map((d) => d.trim()).filter(Boolean),
);

function cleanFixture() {
  rmSync(join(ROOT, ".vibegraph"), { recursive: true, force: true });
  for (const f of readdirSync(ROOT)) {
    if (f === ".gitkeep" || SEED_DIRS.has(f)) continue;
    rmSync(join(ROOT, f), { recursive: true, force: true });
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

test.describe("Neural-net rehearsal — full live pipeline (real claude)", () => {
  test.skip(!ENABLED, "Requires VG_REHEARSAL=1 + VG_FIXTURE=test/fixtures/neuralnet_blank (real Claude spawns)");
  test.setTimeout(20 * 60_000); // real drafting: minutes, not seconds

  test.beforeAll(() => {
    cleanFixture();
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test("describe → ratify → run → judge each gate → complete → explore the model", async ({ page }) => {
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

    // Loop: each iteration handles one gate (consent if asked — for ML code
    // the model checks consent-gate nearly every time — then accept) until
    // the run reports completion or pauses on a failure.
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

    // ── 5. THE PAYOFF — every increment built ─────────────────────────────
    await expect(note).toContainText(/complete/i, { timeout: 60_000 });
    await expect(page.locator("[data-roadmap-progress]")).toContainText(`${itemCount}/${itemCount} built`);
    // Capture the generated app the moment the build completes — later
    // exploratory assertions must never cost us the artifacts (afterAll wipes
    // the fixture).
    snapshotArtifacts();
    await page.screenshot({ path: join(SHOT_DIR, "4-complete-solid.png") });

    // M-NN-2: "backend" means WEB backend. A pure-ML pipeline grounds into a
    // SINGLE "library" subsystem, and build_system_tier now classifies a
    // routeless project's non-manual entries (model/public_api/cli) as
    // `library` — so the planned "library" ghost RECONCILES to the solid
    // card (ids were always aligned; the kind now agrees too). Demand zero
    // lingering ghosts and a solid library card; the in-chain twin of this
    // assertion lives in m-nn2-library-subsystem.spec.ts (library_only).
    // The real ML payoff is still the Architecture view (step 6).
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "subsystems");
    await expect(page.locator('[data-subsystem-node][data-subsystem-kind="library"]')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('[data-subsystem-node][data-subsystem-kind="backend"]')).toHaveCount(0);
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(0, { timeout: 30_000 });
    const solidCards = await page.locator("[data-subsystem-node]").count();
    const lingeringGhosts = await page.locator("[data-planned-subsystem]").count();
    console.log(`[nn rehearsal] system view — solid subsystems: ${solidCards}, lingering plan ghosts: ${lingeringGhosts}`);

    // ── 6. THE NEURAL-NET EXPLORATION — the reason this is an ML rehearsal ──
    // The Architecture lens only lights up when a parsed nn.Module lands. If
    // the builder wrote a genuine `class X(nn.Module)`, the toolbar Arch
    // button is enabled and paints its layer schematic.
    const archBtn = page.locator('[data-view-arch], button:has-text("Arch")').first();
    await expect(archBtn).toBeVisible({ timeout: 15_000 });
    await archBtn.click();
    const archView = page.locator("[data-architecture-view]");
    await expect(archView).toBeVisible({ timeout: 15_000 });
    // Model header (class name) + at least the layer glyphs of a 2-conv/2-fc net.
    await expect(page.locator("[data-model-header]").first()).toBeVisible({ timeout: 15_000 });
    const layerCount = await page.locator("[data-layer-glyph]").count();
    console.log(`[nn rehearsal] arch layer glyphs: ${layerCount}`);
    expect(layerCount).toBeGreaterThanOrEqual(3);
    // Net-type chip present (assert PRESENCE, not the classification — an
    // honest "?" is a valid answer the schematic must still show).
    await expect(page.locator("[data-net-type]").first()).toBeVisible({ timeout: 15_000 });
    // Param badges must be honest numbers — never NaN. Regression guard for the
    // rehearsal finding: a Conv/Linear whose kernel size / out-features is a
    // KEYWORD arg (fewer positional args than the formula needs) must OMIT the
    // badge, not render "NaN". (Fixed in layer_params.ts; unit-pinned in
    // test:arch-params.)
    const paramBadges = await page.locator("[data-layer-params]").allTextContents();
    console.log(`[nn rehearsal] param badges: ${JSON.stringify(paramBadges)}`);
    for (const t of paramBadges) expect(t).not.toContain("NaN");

    // Whether the thread index surfaced a MODELS row is an honest, generated-
    // code-dependent observation (detect_model_forward fires on module-scope
    // nn.Module subclasses) — record it, don't gate on it.
    const modelRowCount = await page.locator('[data-entry-kind="model"]').count();
    console.log(`[nn rehearsal] thread-index MODELS rows: ${modelRowCount}`);
    await page.screenshot({ path: join(SHOT_DIR, "5-arch-view.png") });

    // The DETERMINISTIC ML-native path into the forward() thread: click a
    // layer glyph in the Arch view (W5 nav — the layer IS a handle onto the
    // model's data path). Proven on cnn_demo by w5-layer-nav.spec; here it's
    // exercised on freshly-generated code.
    const glyph = page.locator("[data-layer-glyph]").first();
    await expect(glyph).toBeVisible({ timeout: 15_000 });
    await glyph.click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".vg-thread-node").first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: join(SHOT_DIR, "6-forward-thread.png") });
    console.log("[nn rehearsal] forward() thread opened via layer-glyph nav");

    console.log(`[nn rehearsal] gates judged: ${gates}, consents given: ${consents}, items built: ${itemCount}`);
    snapshotArtifacts();
  });

  test.afterAll(() => {
    cleanFixture();
  });
});
