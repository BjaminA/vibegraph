/**
 * M-TRAINED — trained-ness as artifact state, in the living renderer:
 *
 *   1. The predict thread (consumer) shows the artifact chip MISSING; the
 *      card names the producer (train:main) and "Open producer thread"
 *      really navigates there.
 *   2. Run-to-here on the consumer crashes honestly (FileNotFoundError in
 *      the sandbox) and the result card answers with the PRODUCER — never
 *      a "draft an example file" offer for a binary artifact.
 *   3. Artifact created on disk → chip reads present; producer source
 *      touched afterwards → chip reads stale (mtime comparison, reason
 *      named in the card).
 *
 * SM2 synth is stubbed (VG_CLAUDE_BIN); chip repaints are driven by page
 * reload (the index stats disk fresh per request). --workers=1, in order.
 *
 * Boot (see package.json test:e2e-artifact):
 *   VG_FIXTURE=test/fixtures/threads/artifact_demo VG_PORT=4258 PORT=4258 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/run_effects/fake_claude_json.mjs" \
 *     FAKE_SYNTH_RESPONSE='{"args":{"value":"2.0"}}' \
 *     npx playwright test test/e2e/m-trained.spec.ts --reporter=list --workers=1
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_DEMO = FIXTURE.includes("artifact_demo");
const ROOT = join(process.cwd(), FIXTURE);
const SHOT_DIR = "reviews/m-trained";
const MODEL = join(ROOT, "model.pkl");

test.use({ video: "on" });

async function openThread(page: Page, entryId: string) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
  await page.click(`[data-thread-index-row][data-entry-id="${entryId}"]`);
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1100);
}

test.describe("M-TRAINED — artifact state in the living renderer", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/threads/artifact_demo");

  test.beforeAll(() => {
    fs.rmSync(MODEL, { force: true });
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    fs.rmSync(MODEL, { force: true });
  });

  test("1. consumer chip reads MISSING; card names the producer; Open producer navigates", async ({ page }) => {
    await openThread(page, "test_predict.py:test_predict_scales");
    const chip = page.locator("[data-artifact-chip]");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toHaveAttribute("data-artifact-state", "missing");
    await expect(chip).toContainText("model.pkl · missing");
    await page.screenshot({ path: join(SHOT_DIR, "chip-missing.png") });

    await chip.click();
    const card = page.locator("[data-artifact-card]");
    await expect(card).toBeVisible();
    await expect(card).toContainText("missing (not yet produced)");
    await expect(card).toContainText("produced by train:main");
    await page.screenshot({ path: join(SHOT_DIR, "card-missing.png") });

    await page.locator('[data-artifact-open-producer="train.py:main"]').click();
    // Navigation landed on the producing thread (its seed renders).
    await expect(page.locator("[data-artifact-card]")).toHaveCount(0);
    await expect(page.locator('.react-flow__node[data-id="train:main"]')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: join(SHOT_DIR, "producer-thread.png") });
  });

  test("2. a run that needs the artifact answers with the producer — never a drafting offer", async ({ page }) => {
    await openThread(page, "test_predict.py:test_predict_scales");
    const node = page.locator('.react-flow__node[data-id="predict:predict"]');
    await expect(node).toBeVisible({ timeout: 10_000 });
    const box = await node.boundingBox();
    if (!box) throw new Error("no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("[data-thread-tooltip]")).toBeVisible({ timeout: 5_000 });
    await page.locator("[data-run-to-here]").click();

    // The seed takes no args (real-input run) — straight to the SM3 effect
    // gate (open/pickle are unprovable): the floor working, not a warning.
    const effectConfirm = page.locator("[data-effect-confirm]");
    await expect(effectConfirm).toBeVisible({ timeout: 15_000 });
    await effectConfirm.click();

    const result = page.locator("[data-run-result]");
    await expect(result).toHaveAttribute("data-run-outcome", "runtime-error", { timeout: 20_000 });
    const artifactRow = page.locator('[data-missing-artifact="model.pkl"]');
    await expect(artifactRow).toBeVisible();
    await expect(artifactRow).toContainText("produced by train:main");
    // The binary artifact must NOT get a drafting offer.
    await expect(page.locator('[data-synth-data-offer="model.pkl"]')).toHaveCount(0);
    await expect(page.locator('[data-artifact-run-producer="train.py:main"]')).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, "run-missing-artifact.png") });
  });

  test("3. artifact on disk → present; producer source touched → stale with the reason named", async ({ page }) => {
    fs.writeFileSync(MODEL, "not-a-real-pickle");
    await openThread(page, "test_predict.py:test_predict_scales");
    const chip = page.locator("[data-artifact-chip]");
    await expect(chip).toHaveAttribute("data-artifact-state", "present", { timeout: 10_000 });
    await page.screenshot({ path: join(SHOT_DIR, "chip-present.png") });

    // Producer source newer than the artifact → stale.
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(join(ROOT, "train.py"), later, later);
    await page.reload();
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="test_predict.py:test_predict_scales"]');
    await expect(chip).toHaveAttribute("data-artifact-state", "stale", { timeout: 10_000 });
    await chip.click();
    await expect(page.locator("[data-artifact-card]")).toContainText("train.py changed after this artifact was produced");
    await page.screenshot({ path: join(SHOT_DIR, "chip-stale.png") });
  });

  // 2026-07-30 sitting: read from the PRODUCING thread, "Open producer thread"
  // navigated to the thread you were already standing on — a dead click. The
  // card must offer what's actually useful there instead: the save site, and a
  // chat draft to produce the artifact (prefill only — nothing runs on click,
  // and no shell command is invented for an environment we can't verify).
  test("4. read from the producer itself: no dead navigation, save site + chat draft instead", async ({ page }) => {
    fs.rmSync(MODEL, { force: true });
    await openThread(page, "train.py:main");

    const chip = page.locator("[data-artifact-chip]");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();
    const card = page.locator("[data-artifact-card]");
    await expect(card).toBeVisible();
    await expect(card).toContainText("produced by train:main");

    // The dead affordance is gone, and the card says why.
    await expect(page.locator("[data-artifact-open-producer]")).toHaveCount(0);
    await expect(page.locator("[data-artifact-producer-is-here]")).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, "card-on-producer.png") });

    // The chat draft names the real producer file + artifact, and only DRAFTS.
    await page.locator('[data-artifact-ask-run="model.pkl"]').click();
    const prefilled = page.locator("textarea", { hasText: "" });
    await expect(async () => {
      const values = await prefilled.evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
      expect(values.some((v) => v.includes("Run train.py") && v.includes("model.pkl"))).toBe(true);
    }).toPass({ timeout: 5_000 });
    // Drafting must not have produced the artifact — a click never runs.
    expect(fs.existsSync(MODEL)).toBe(false);

    // The save site selects the writing call and opens it in the editor.
    await chip.click();
    await page.locator("[data-artifact-show-save-site]").click();
    await expect(page.locator("[data-node-editor-panel]")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-editor-breadcrumb]")).toContainText("train.py");
  });

  // 2026-07-30 sitting: a chip read "stale" for a model that had JUST been
  // retrained. The verdict was computed when train.py was edited (true then),
  // and producing the artifact — the event the whole seam exists to report —
  // is not a .py change, so the watcher dropped it and nothing recomputed.
  // The chip must correct itself with no reload and no source edit.
  test("5. producing the artifact clears stale live — no reload, no source edit", async ({ page }) => {
    // Set up the honest stale state with REAL past mtimes: sources 30s old,
    // artifact 60s old. (Dating a source into the FUTURE would keep it newer
    // than the retrained artifact and stale would be correct — the setup has
    // to leave room for "now" to win.)
    fs.writeFileSync(MODEL, "not-a-real-pickle");
    const sourceTime = new Date(Date.now() - 30_000);
    for (const f of fs.readdirSync(ROOT).filter((f) => f.endsWith(".py"))) {
      fs.utimesSync(join(ROOT, f), sourceTime, sourceTime);
    }
    const artifactTime = new Date(Date.now() - 60_000);
    fs.utimesSync(MODEL, artifactTime, artifactTime);

    await openThread(page, "train.py:main");
    const chip = page.locator("[data-artifact-chip]");
    await expect(chip).toHaveAttribute("data-artifact-state", "stale", { timeout: 10_000 });

    // "Re-train": rewrite the artifact only. No page reload, no .py change.
    fs.writeFileSync(MODEL, "retrained-bytes");
    await expect(chip).toHaveAttribute("data-artifact-state", "present", { timeout: 10_000 });
    await expect(chip).toContainText("model.pkl · just now");
    await page.screenshot({ path: join(SHOT_DIR, "chip-live-retrain.png") });
  });
});
