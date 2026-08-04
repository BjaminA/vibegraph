/**
 * M-GF3.6 — the roadmap OVERVIEW (supersedes the 3.3 per-stage popup after
 * Ben's sitting: "make the whole roadmap pop up bigger"). A roadmap row —
 * or the panel's expand button — opens one large dialog where EVERY stage
 * is a full card: whole capability, whole grounding quote, needs/unlocks
 * chips. Focusing a card (row click / chip / its "Discuss / modify" button)
 * opens the scoped dialogue inline. ×, Escape, and backdrop all close.
 *
 * Seeded ratified architecture + roadmap (no drafting → no claude stub);
 * the fixture mirrors the neural-net rehearsal's dependency shape.
 *
 * Boot (see package.json test:e2e-gf3-dialog):
 *   VG_FIXTURE=test/fixtures/greenfield_blank VG_PORT=4251 PORT=4251 \
 *     npx playwright test test/e2e/m-gf3-stage-dialog.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BLANK = FIXTURE.includes("greenfield_blank");
const ROOT = join(process.cwd(), FIXTURE);
const VG_DIR = join(ROOT, ".vibegraph");
const SHOT_DIR = "reviews/m-gf3";

const SYSTEM_PLAN = {
  version: "1",
  description: "a CNN classifier over CSV signal windows",
  subsystems: [
    { id: "model", kind: "backend", label: "CNN model", groundedIn: "a CNN classifier" },
    { id: "data", kind: "db", label: "Signal dataset", groundedIn: "CSV signal windows" },
  ],
  edges: [{ from: "model", to: "data", groundedIn: null }],
  drafted: false,
  ratifiedAt: "2026-07-17T00:00:00.000Z",
};

const ROADMAP = {
  version: "1",
  description: "a CNN classifier over CSV signal windows",
  items: [
    {
      id: "window-parsing",
      capability:
        "a pure parsing module converting raw CSV rows into (int label, list of 64 floats) pairs, validating label range and sample count, and computing a deterministic 80/20 index split",
      needs: [],
      groundedIn: "CSV signal windows",
      status: "pending",
    },
    { id: "conv1d-model", capability: "a PyTorch nn.Module with two Conv1d layers and two Linear layers mapping (N, 1, 64) to (N, 3) logits", needs: [], groundedIn: null, status: "pending" },
    { id: "dataset-tensors", capability: "a dataset module returning train and test tensors via the deterministic split", needs: ["window-parsing"], groundedIn: "CSV signal windows", status: "pending" },
    { id: "training-loop", capability: "a minibatch training loop returning the trained model plus per-epoch losses", needs: ["conv1d-model", "dataset-tensors"], groundedIn: "a CNN classifier", status: "pending" },
  ],
  drafted: false,
  ratifiedAt: "2026-07-17T00:00:00.000Z",
};

test.use({ video: "on" });

test.describe("M-GF3.6 — roadmap overview", () => {
  test.skip(!IS_BLANK, "Requires VG_FIXTURE=test/fixtures/greenfield_blank");

  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
    rmSync(VG_DIR, { recursive: true, force: true });
    mkdirSync(VG_DIR, { recursive: true });
    writeFileSync(join(VG_DIR, "system-plan.json"), JSON.stringify(SYSTEM_PLAN, null, 2) + "\n", "utf-8");
    writeFileSync(join(VG_DIR, "build-plan.json"), JSON.stringify(ROADMAP, null, 2) + "\n", "utf-8");
  });
  test.afterAll(() => {
    rmSync(VG_DIR, { recursive: true, force: true });
  });

  test("row click opens the big overview focused on that stage; every stage fully readable; chips/discuss move focus; ×/Escape/backdrop close", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("[data-roadmap-panel]");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toHaveAttribute("data-roadmap-state", "ratified");

    // ── row click → the overview, focused on the clicked stage ──────────
    await page.click('[data-roadmap-item="training-loop"] [data-item-row]');
    const overview = page.locator("[data-roadmap-overview]");
    await expect(overview).toBeVisible();
    await expect(overview).toHaveAttribute("data-focused-stage", "training-loop");
    // EVERY stage is a full card, all visible at once — Ben's ask.
    await expect(overview.locator("[data-stage-card]")).toHaveCount(4);

    const training = overview.locator('[data-stage-card="training-loop"]');
    await expect(training.locator("[data-stage-capability]")).toContainText("per-epoch losses");
    await expect(training.locator("[data-stage-grounded]")).toContainText("a CNN classifier");
    await expect(training.locator("[data-stage-needs-chip]")).toHaveCount(2);
    // The focused card hosts the dialogue inline.
    await expect(training.locator("[data-stage-chat-input]")).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, "roadmap-overview.png") });

    // ── the LONG stage is fully readable WITHOUT focusing it ────────────
    const parsing = overview.locator('[data-stage-card="window-parsing"]');
    await expect(parsing.locator("[data-stage-capability]")).toContainText("deterministic 80/20 index split");
    const clipped = await parsing.locator("[data-stage-capability]").evaluate(
      (el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight,
    );
    expect(clipped).toBe(false);

    // ── needs chip moves the focus (dialogue follows) ───────────────────
    await page.click('[data-stage-needs-chip="conv1d-model"]');
    await expect(overview).toHaveAttribute("data-focused-stage", "conv1d-model");
    const conv = overview.locator('[data-stage-card="conv1d-model"]');
    await expect(conv.locator("[data-stage-inferred]")).toContainText(/INFERRED/);
    await expect(conv).toContainText("nothing — a foundation stage");
    await expect(conv.locator('[data-stage-unlocks-chip="training-loop"]')).toHaveCount(1);
    await expect(conv.locator("[data-stage-chat-input]")).toBeVisible();

    // ── the explicit per-card affordance ────────────────────────────────
    await page.click('[data-stage-discuss="dataset-tensors"]');
    await expect(overview).toHaveAttribute("data-focused-stage", "dataset-tensors");

    // ── close paths: ×, then expand button reopens, Escape, backdrop ────
    await page.click("[data-roadmap-overview-close]");
    await expect(page.locator("[data-roadmap-overview]")).toHaveCount(0);

    await page.click("[data-roadmap-expand]");
    await expect(overview).toBeVisible();
    await expect(overview).toHaveAttribute("data-focused-stage", "");
    await expect(overview.locator("[data-stage-card]")).toHaveCount(4);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-roadmap-overview]")).toHaveCount(0);

    await page.click('[data-roadmap-item="dataset-tensors"] [data-item-row]');
    await expect(overview).toBeVisible();
    await page.click("[data-roadmap-overview-backdrop]", { position: { x: 10, y: 10 } });
    await expect(page.locator("[data-roadmap-overview]")).toHaveCount(0);
  });
});
