/**
 * PLAN-v7 Stage 5 (gate) — the ORCHESTRATOR: a ratified roadmap drives the
 * proven increment loop, with the human gate at every increment.
 *
 * Scenario 1 — CONSENT + FAILURE SEMANTICS (6b + the ratified decision,
 * end-to-end): a pre-seeded two-item roadmap. Item 1's drafted increment
 * carries an EFFECTFUL check (`with open(...)` — the 6a-fixed floor shape)
 * → the floor refuses to run it silently and the item GATES with the 6b
 * consent affordance (a question for the human, not a floor verdict) →
 * consent runs the check labelled honestly → accept builds and the run
 * advances ITSELF to item 2, whose drafted file does not PARSE → the file
 * floor is red for a NON-consentable reason → the item FAILS with the
 * honest reason, the run PAUSES, nothing touches disk; Skip records the
 * hole and the run ends honestly.
 *
 * Scenario 2 — THE FULL PIPELINE, hand-driven from the real controls:
 * Draft roadmap (stubbed) → ratify (persisted) → Run → increment 1 at the
 * gate → REJECT (run pauses, item returns to pending, nothing written) →
 * Resume → gate again → ACCEPT → validation.py lands and the run ADVANCES
 * ITSELF to increment 2 → ACCEPT → 2/2 built, run complete, and the ghost
 * architecture is SOLID. One human judgment per increment; automation only
 * between gates.
 *
 * Boot (see package.json test:e2e-plan-v7-5):
 *   VG_FIXTURE=test/fixtures/greenfield_blank VG_PORT=4240 PORT=4240 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/run_effects/fake_claude_orchestrator.mjs" \
 *     npx playwright test test/e2e/plan-v7-5-orchestrator.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BLANK = FIXTURE.includes("greenfield_blank");
const ROOT = join(process.cwd(), FIXTURE);
const SHOT_DIR = "reviews/m-plan-v7-5";

const SYSTEM_PLAN = {
  version: "1",
  description: "a flask API with a sqlite note store",
  subsystems: [
    { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
    { id: "db", kind: "db", label: "SQLite note store", groundedIn: "a sqlite note store" },
  ],
  edges: [{ from: "backend", to: "db", groundedIn: "a sqlite note store" }],
  drafted: false,
  ratifiedAt: "2026-07-02T00:00:00.000Z",
};

const CONSENT_AND_FAIL_ROADMAP = {
  version: "1",
  description: "a flask API with a sqlite note store",
  items: [
    // Long on purpose (M-GF3.1): the row must WRAP the full capability, never
    // single-line-ellipsize it. Keeps "unsafe metrics" so the stub still keys.
    { id: "metrics", capability: "unsafe metrics increment that counts the notes in the store and records the tally through a deliberately effectful scratch-file check", needs: [], groundedIn: null, status: "pending" },
    { id: "broken", capability: "deliberately broken module", needs: [], groundedIn: null, status: "pending" },
  ],
  drafted: false,
  ratifiedAt: "2026-07-02T00:00:00.000Z",
};

test.use({ video: "on" });

function cleanFixture() {
  rmSync(join(ROOT, ".vibegraph"), { recursive: true, force: true });
  for (const f of ["validation.py", "db.py", "app.py", "metrics.py", "broken.py"]) rmSync(join(ROOT, f), { force: true });
}

function seedSystemPlan() {
  mkdirSync(join(ROOT, ".vibegraph"), { recursive: true });
  writeFileSync(join(ROOT, ".vibegraph", "system-plan.json"), JSON.stringify(SYSTEM_PLAN, null, 2) + "\n", "utf-8");
}

test.describe("PLAN-v7 5 — the orchestrator", () => {
  test.skip(!IS_BLANK, "Requires VG_FIXTURE=test/fixtures/greenfield_blank");

  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    cleanFixture();
  });

  test("an effectful check GATES for consent (6b); a non-parsing increment FAILS honestly, pauses the run; Skip records the hole", async ({ page }) => {
    cleanFixture();
    seedSystemPlan();
    writeFileSync(join(ROOT, ".vibegraph", "build-plan.json"), JSON.stringify(CONSENT_AND_FAIL_ROADMAP, null, 2) + "\n", "utf-8");

    await page.goto("/");
    const panel = page.locator("[data-roadmap-panel]");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toHaveAttribute("data-roadmap-state", "ratified");

    // M-GF3.1 — the full capability is visible: wrapped over multiple lines,
    // no horizontal clipping, no single-line ellipsis.
    const cap = page.locator('[data-roadmap-item="metrics"] [data-item-capability]');
    await expect(cap).toContainText("deliberately effectful scratch-file check");
    const wrap = await cap.evaluate((el) => ({
      whiteSpace: getComputedStyle(el).whiteSpace,
      clippedX: el.scrollWidth > el.clientWidth,
      height: el.clientHeight,
    }));
    expect(wrap.whiteSpace).toBe("normal");
    expect(wrap.clippedX).toBe(false);
    expect(wrap.height).toBeGreaterThan(24); // ≥ 2 wrapped lines at fsm-12/1.45

    await page.click("[data-run-start]");
    // ── item 1: the drafted check does file I/O (`with open(...)` — the
    // 6a-fixed floor shape) → NOT a floor verdict: the item GATES with the
    // consent affordance. Accept stays disabled; nothing runs, nothing lands.
    const gate = page.locator("[data-changeset-gate]");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-roadmap-item="metrics"][data-item-status="gated"]')).toBeVisible({ timeout: 10_000 });
    const effectGate = page.locator("[data-changeset-effect-gate]");
    await expect(effectGate).toBeVisible();
    await expect(effectGate).toContainText(/file-system effect/i);
    await expect(effectGate).toContainText("open");
    await expect(page.locator("[data-changeset-accept]")).toBeDisabled();
    expect(existsSync(join(ROOT, "metrics.py"))).toBe(false);

    await page.screenshot({ path: join(SHOT_DIR, "run-consent-gate.png") });

    // CONSENT: the check runs (in the sandbox), labelled honestly — never
    // laundered as pure — and the floor goes green.
    await page.click("[data-changeset-consent]");
    await expect(page.locator("[data-check-consented]")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-changeset-check][data-check-ok="true"]')).toHaveCount(1);
    await expect(page.locator("[data-changeset-accept]")).toBeEnabled();

    // ACCEPT → metrics.py lands and the run ADVANCES ITSELF to item 2.
    await page.click("[data-changeset-accept]");
    await expect.poll(() => existsSync(join(ROOT, "metrics.py")), { timeout: 15_000 }).toBe(true);
    await expect(page.locator('[data-roadmap-item="metrics"][data-item-status="built"]')).toBeVisible({ timeout: 15_000 });

    // ── item 2: the drafted file does not PARSE → red for a reason no
    // consent can fix → the item FAILS with the honest reason, run pauses.
    const failed = page.locator('[data-roadmap-item="broken"][data-item-status="failed"]');
    await expect(failed).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-item-failure]")).toContainText(/parse|syntax|create_file|floor/i);
    await expect(page.locator("[data-run-note]")).toContainText(/paused/i);
    expect(existsSync(join(ROOT, "broken.py"))).toBe(false); // floor red → nothing written

    await page.screenshot({ path: join(SHOT_DIR, "run-failure-triage.png") });

    // Skip: the human records the hole; the run ends honestly (nothing left).
    await page.click("[data-item-skip]");
    await expect(page.locator('[data-roadmap-item="broken"][data-item-status="skipped"]')).toBeVisible({ timeout: 10_000 });
  });

  test("draft → ratify → run: reject pauses, resume re-gates, accept advances to completion + solid architecture", async ({ page }) => {
    cleanFixture();
    seedSystemPlan();

    await page.goto("/");
    const panel = page.locator("[data-roadmap-panel]");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toHaveAttribute("data-roadmap-state", "empty");

    // ── draft + ratify the roadmap ──────────────────────────────────────
    await page.click("[data-roadmap-draft]");
    await expect(panel).toHaveAttribute("data-roadmap-state", "proposed", { timeout: 30_000 });
    await expect(page.locator("[data-roadmap-item]")).toHaveCount(2);
    await page.screenshot({ path: join(SHOT_DIR, "roadmap-proposed.png") });

    await page.click("[data-roadmap-ratify]");
    await expect(panel).toHaveAttribute("data-roadmap-state", "ratified", { timeout: 10_000 });
    await expect.poll(() => existsSync(join(ROOT, ".vibegraph", "build-plan.json")), { timeout: 10_000 }).toBe(true);

    // ── run → gate 1 → REJECT pauses ────────────────────────────────────
    await page.click("[data-run-start]");
    const gate = page.locator("[data-changeset-gate]");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-changeset-badge]")).toContainText(/Builder draft/i);

    await page.click("[data-changeset-reject]");
    await expect(gate).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator("[data-run-note]")).toContainText(/rejected/i, { timeout: 10_000 });
    await expect(page.locator('[data-roadmap-item="note-validation"][data-item-status="pending"]')).toBeVisible();
    expect(existsSync(join(ROOT, "validation.py"))).toBe(false);

    // ── resume → gate 1 again → ACCEPT → the run ADVANCES ITSELF ────────
    await page.click("[data-run-start]");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await page.click("[data-changeset-accept]");

    await expect.poll(() => existsSync(join(ROOT, "validation.py")), { timeout: 15_000 }).toBe(true);
    // No human "next" click: increment 2 arrives at the gate by itself,
    // and the roadmap already records increment 1 as built.
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-changeset-file="db.py"]')).toHaveCount(1);
    await expect(page.locator('[data-roadmap-item="note-validation"][data-item-status="built"]')).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, "run-gate2-after-advance.png") });

    // ── ACCEPT increment 2 → complete ───────────────────────────────────
    await page.click("[data-changeset-accept]");
    await expect.poll(() => existsSync(join(ROOT, "app.py")) && existsSync(join(ROOT, "db.py")), { timeout: 15_000 }).toBe(true);
    await expect(page.locator("[data-roadmap-progress]")).toContainText("2/2 built", { timeout: 15_000 });
    await expect(page.locator("[data-run-note]")).toContainText(/complete/i, { timeout: 15_000 });

    // The payoff, again: the ghost architecture is SOLID.
    await page.click('button:has-text("System")');
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-subsystem-node]")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(0, { timeout: 30_000 });

    await page.screenshot({ path: join(SHOT_DIR, "run-complete-solid.png") });
  });
});
