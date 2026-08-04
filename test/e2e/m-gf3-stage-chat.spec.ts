/**
 * M-GF3.4 (+3.6 overview shell) — the per-stage dialogue, end-to-end over
 * the stream-json stub:
 *
 *   1. DISCUSS — a question streams a prose answer into the stage dialog
 *      (scoped conversation; no revision card for pure discussion).
 *   2. REVISE — "make it three conv layers" → the stub's ```vg-revise-stage
 *      block is parsed + dry-run-validated server-side and renders as a
 *      before/after revision card (raw JSON never shown as prose).
 *   3. APPLY — the ratified roadmap is rewritten through the same
 *      validateBuildPlan boundary, persisted to .vibegraph/build-plan.json,
 *      and the roadmap row + dialog re-render with the revised capability.
 *
 * Boot (see package.json test:e2e-gf3-chat):
 *   VG_FIXTURE=test/fixtures/greenfield_blank VG_PORT=4252 PORT=4252 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/chat/fake_claude_stage_chat.mjs" \
 *     npx playwright test test/e2e/m-gf3-stage-chat.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BLANK = FIXTURE.includes("greenfield_blank");
const ROOT = join(process.cwd(), FIXTURE);
const VG_DIR = join(ROOT, ".vibegraph");
const PLAN_PATH = join(VG_DIR, "build-plan.json");
const SHOT_DIR = "reviews/m-gf3";

const SYSTEM_PLAN = {
  version: "1",
  description: "a CNN classifier over CSV signal windows",
  subsystems: [
    { id: "model", kind: "backend", label: "CNN model", groundedIn: "a CNN classifier" },
  ],
  edges: [],
  drafted: false,
  ratifiedAt: "2026-07-17T00:00:00.000Z",
};

const ROADMAP = {
  version: "1",
  description: "a CNN classifier over CSV signal windows",
  items: [
    { id: "window-parsing", capability: "a pure CSV parsing module", needs: [], groundedIn: "CSV signal windows", status: "pending" },
    { id: "conv1d-model", capability: "a PyTorch nn.Module with two Conv1d layers and two Linear layers", needs: [], groundedIn: null, status: "pending" },
  ],
  drafted: false,
  ratifiedAt: "2026-07-17T00:00:00.000Z",
};

test.use({ video: "on" });

test.describe("M-GF3.4 — per-stage dialogue", () => {
  test.skip(!IS_BLANK, "Requires VG_FIXTURE=test/fixtures/greenfield_blank");

  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
    rmSync(VG_DIR, { recursive: true, force: true });
    mkdirSync(VG_DIR, { recursive: true });
    writeFileSync(join(VG_DIR, "system-plan.json"), JSON.stringify(SYSTEM_PLAN, null, 2) + "\n", "utf-8");
    writeFileSync(PLAN_PATH, JSON.stringify(ROADMAP, null, 2) + "\n", "utf-8");
  });
  test.afterAll(() => {
    rmSync(VG_DIR, { recursive: true, force: true });
  });

  test("discussion streams prose; a change request proposes a validated revision; Apply persists it", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("[data-roadmap-panel]");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toHaveAttribute("data-roadmap-state", "ratified");

    await page.click('[data-roadmap-item="conv1d-model"] [data-item-row]');
    // M-GF3.6 — the row opens the big overview focused on the stage; the
    // dialogue lives inline on the focused card.
    const overview = page.locator("[data-roadmap-overview]");
    await expect(overview).toBeVisible();
    await expect(overview).toHaveAttribute("data-focused-stage", "conv1d-model");
    const dialog = overview.locator('[data-stage-card="conv1d-model"]');

    // ── 1. DISCUSS — prose in, prose out, no revision card ──────────────
    await page.fill("[data-stage-chat-input]", "what does this stage actually do?");
    await page.click("[data-stage-chat-send]");
    await expect(dialog.locator('[data-stage-turn="assistant"]')).toContainText(
      /convolutional network/i,
      { timeout: 15_000 },
    );
    await expect(dialog.locator("[data-stage-revision]")).toHaveCount(0);

    // ── 2. REVISE — the change request comes back as a revision card ────
    await page.fill("[data-stage-chat-input]", "make it three conv layers please");
    await page.click("[data-stage-chat-send]");
    const card = dialog.locator("[data-stage-revision]");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator("[data-stage-revision-capability]")).toContainText("three Conv1d layers");
    // The fenced block renders as the card, never as raw JSON prose.
    await expect(dialog.locator('[data-stage-turn="assistant"]').last()).not.toContainText("vg-revise-stage");
    await page.screenshot({ path: join(SHOT_DIR, "stage-chat-revision-card.png") });

    // ── 3. APPLY — ratified roadmap rewritten + persisted + re-rendered ─
    await page.click("[data-stage-revision-apply]");
    await expect(dialog.locator('[data-stage-turn="note"]')).toContainText(/applied/i, { timeout: 10_000 });
    await expect(dialog.locator("[data-stage-capability]")).toContainText("three Conv1d layers");
    await expect(page.locator('[data-roadmap-item="conv1d-model"] [data-item-capability]')).toContainText(
      "three Conv1d layers",
    );
    await expect
      .poll(() => JSON.parse(readFileSync(PLAN_PATH, "utf-8")).items[1].capability, { timeout: 10_000 })
      .toContain("three Conv1d layers");
    // groundedIn honesty rides through: still INFERRED after the revision.
    expect(JSON.parse(readFileSync(PLAN_PATH, "utf-8")).items[1].groundedIn).toBe(null);

    await page.screenshot({ path: join(SHOT_DIR, "stage-chat-applied.png") });
  });

  // ── Sitting-3 — the failure-triage loop lives IN the overview ─────────
  // A failed stage offers "Re-run stage" on its card; applying a revision
  // re-queues it (pending, failReason cleared — the old verdict was against
  // text that no longer exists) and the button becomes "Resume run", which
  // genuinely re-enters the drive loop. Before this, revise-then-Resume did
  // nothing: the stage stayed failed and nextBuildableItem only walks
  // pending items.
  test("failed stage: Re-run on the card; applied revision re-queues; Resume genuinely re-drafts", async ({ page }) => {
    const FAILED_PLAN = {
      ...ROADMAP,
      items: [
        { ...ROADMAP.items[0], status: "built" },
        {
          ...ROADMAP.items[1],
          status: "failed",
          failReason: 'drafted changeset failed validation: files[1]: duplicate path "data.py"',
        },
      ],
    };
    writeFileSync(PLAN_PATH, JSON.stringify(FAILED_PLAN, null, 2) + "\n", "utf-8");

    await page.goto("/");
    await expect(page.locator("[data-roadmap-panel]")).toBeVisible({ timeout: 15_000 });
    await page.click('[data-roadmap-item="conv1d-model"] [data-item-row]');
    const overview = page.locator("[data-roadmap-overview]");
    await expect(overview).toBeVisible();
    const card = overview.locator('[data-stage-card="conv1d-model"]');
    await expect(card.locator("[data-stage-fail-reason]")).toContainText("duplicate path");
    const rerun = overview.locator('[data-stage-rerun="conv1d-model"]');
    await expect(rerun).toHaveText(/Re-run stage/);
    await page.screenshot({ path: join(SHOT_DIR, "stage-failed-rerun-offer.png") });

    // Revise through the dialogue, apply — the stage re-queues.
    await page.fill("[data-stage-chat-input]", "make it three conv layers please");
    await page.click("[data-stage-chat-send]");
    await expect(card.locator("[data-stage-revision]")).toBeVisible({ timeout: 15_000 });
    await page.click("[data-stage-revision-apply]");
    await expect(card.locator('[data-stage-turn="note"]')).toContainText(/applied/i, { timeout: 10_000 });
    await expect
      .poll(() => JSON.parse(readFileSync(PLAN_PATH, "utf-8")).items[1].status, { timeout: 10_000 })
      .toBe("pending");
    expect(JSON.parse(readFileSync(PLAN_PATH, "utf-8")).items[1].failReason).toBe(undefined);
    await expect(card.locator("[data-stage-status]")).toHaveText("pending");
    await expect(rerun).toHaveText(/Resume run/);
    await page.screenshot({ path: join(SHOT_DIR, "stage-requeued-resume.png") });

    // Resume from the card: the run re-enters the drive loop for THIS stage
    // (its dependency is built). The stub can't speak the builder protocol,
    // so the honest end state is a fresh failure + a paused run — proof the
    // retry genuinely re-drafted rather than ignoring the stage.
    await rerun.click();
    await expect
      .poll(() => JSON.parse(readFileSync(PLAN_PATH, "utf-8")).items[1].status, { timeout: 20_000 })
      .toBe("failed");
    await expect(page.locator("[data-run-note]")).toContainText(/run paused/i, { timeout: 10_000 });
  });
});
