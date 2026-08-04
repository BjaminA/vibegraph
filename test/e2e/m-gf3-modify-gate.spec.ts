/**
 * M-GF3.5 — Modify replaces Reject on both gates; the × is the reject.
 *
 *   1. CHANGESET GATE — the footer is [Accept & build] [Modify] (no Reject
 *      button); the header × / Escape decline (build-run-reject for a run
 *      gate: run pauses, item back to pending, nothing written). Modify +
 *      an instruction re-drafts the SAME increment (stub marks the revision
 *      visibly), the gate stays tagged with the run item, and accept still
 *      advances the run — affordance-must-match: Modify really modifies.
 *   2. ROADMAP PROPOSAL — the dial is [Approve] [Modify]; Modify + guidance
 *      re-drafts the roadmap (previous draft rides along) into a visibly
 *      revised proposal; the header × rejects it back to the empty state.
 *
 * Boot (see package.json test:e2e-gf3-modify):
 *   VG_FIXTURE=test/fixtures/greenfield_blank VG_PORT=4253 PORT=4253 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/run_effects/fake_claude_modify.mjs" \
 *     npx playwright test test/e2e/m-gf3-modify-gate.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BLANK = FIXTURE.includes("greenfield_blank");
const ROOT = join(process.cwd(), FIXTURE);
const VG_DIR = join(ROOT, ".vibegraph");
const SHOT_DIR = "reviews/m-gf3";

const SYSTEM_PLAN = {
  version: "1",
  description: "a flask API with a sqlite note store",
  subsystems: [
    { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
  ],
  edges: [],
  drafted: false,
  ratifiedAt: "2026-07-17T00:00:00.000Z",
};

const RUN_ROADMAP = {
  version: "1",
  description: "a flask API with a sqlite note store",
  items: [
    { id: "note-validation", capability: "a pure validate_title module for notes", needs: [], groundedIn: "a flask API", status: "pending" },
  ],
  drafted: false,
  ratifiedAt: "2026-07-17T00:00:00.000Z",
};

test.use({ video: "on" });

function cleanFixture() {
  rmSync(VG_DIR, { recursive: true, force: true });
  rmSync(join(ROOT, "validation.py"), { force: true });
}

test.describe("M-GF3.5 — modify-gates", () => {
  test.skip(!IS_BLANK, "Requires VG_FIXTURE=test/fixtures/greenfield_blank");

  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    cleanFixture();
  });

  test("changeset gate: Escape/× rejects; Modify re-drafts the increment; accept advances the run", async ({ page }) => {
    cleanFixture();
    mkdirSync(VG_DIR, { recursive: true });
    writeFileSync(join(VG_DIR, "system-plan.json"), JSON.stringify(SYSTEM_PLAN, null, 2) + "\n", "utf-8");
    writeFileSync(join(VG_DIR, "build-plan.json"), JSON.stringify(RUN_ROADMAP, null, 2) + "\n", "utf-8");

    await page.goto("/");
    const panel = page.locator("[data-roadmap-panel]");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await page.click("[data-run-start]");

    const gate = page.locator("[data-changeset-gate]");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    // The new grammar: Modify in the footer, × (data-changeset-reject) in
    // the header, and NO "Reject" text button anywhere.
    await expect(gate.locator("[data-changeset-modify]")).toBeVisible();
    await expect(gate.locator("[data-changeset-reject]")).toBeVisible();
    await expect(gate.getByText("Reject", { exact: true })).toHaveCount(0);

    // ── implicit reject: Escape closes the gate, run pauses honestly ────
    await page.keyboard.press("Escape");
    await expect(gate).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator("[data-run-note]")).toContainText(/rejected/i, { timeout: 10_000 });
    await expect(page.locator('[data-roadmap-item="note-validation"][data-item-status="pending"]')).toBeVisible();
    expect(existsSync(join(ROOT, "validation.py"))).toBe(false);

    // ── resume → Modify re-drafts the increment ─────────────────────────
    await page.click("[data-run-start]");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(gate).toContainText("note validation");
    await page.click("[data-changeset-modify]");
    await page.fill("[data-changeset-modify-input]", "add docstrings and strip whitespace");
    await page.keyboard.press("Enter");

    // The stub's revision branch marks the re-draft visibly.
    await expect(gate).toContainText("note validation (revised)", { timeout: 30_000 });
    await page.screenshot({ path: join(SHOT_DIR, "gate-modified-redraft.png") });

    // Still a RUN gate: accept lands the file and completes the run.
    await page.click("[data-changeset-accept]");
    await expect.poll(() => existsSync(join(ROOT, "validation.py")), { timeout: 15_000 }).toBe(true);
    expect(readFileSync(join(ROOT, "validation.py"), "utf-8")).toContain("strip()");
    await expect(page.locator('[data-roadmap-item="note-validation"][data-item-status="built"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-run-note]")).toContainText(/complete/i, { timeout: 15_000 });
  });

  test("roadmap proposal: Modify re-drafts with guidance; the header × rejects", async ({ page }) => {
    cleanFixture();
    mkdirSync(VG_DIR, { recursive: true });
    writeFileSync(join(VG_DIR, "system-plan.json"), JSON.stringify(SYSTEM_PLAN, null, 2) + "\n", "utf-8");

    await page.goto("/");
    const panel = page.locator("[data-roadmap-panel]");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toHaveAttribute("data-roadmap-state", "empty");

    await page.click("[data-roadmap-draft]");
    await expect(panel).toHaveAttribute("data-roadmap-state", "proposed", { timeout: 30_000 });
    await expect(panel.locator("[data-roadmap-modify]")).toBeVisible();
    await expect(panel.getByText("Reject", { exact: true })).toHaveCount(0);

    // ── Modify: guidance → visibly revised proposal ─────────────────────
    await page.click("[data-roadmap-modify]");
    await page.fill("[data-roadmap-modify-input]", "add docstrings to every function");
    await page.keyboard.press("Enter");
    await expect(panel.locator("[data-item-capability]").first()).toContainText(
      "with docstrings on every function",
      { timeout: 30_000 },
    );
    await page.screenshot({ path: join(SHOT_DIR, "roadmap-modified-redraft.png") });

    // ── the header × rejects the proposal back to the empty state ───────
    await page.click("[data-roadmap-reject]");
    await expect(panel).toHaveAttribute("data-roadmap-state", "empty", { timeout: 10_000 });
  });
});
