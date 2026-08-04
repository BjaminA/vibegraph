/**
 * PLAN-v7 Stage 4b (gate) — the LIVE builder: one capability described via
 * the toolbar Build affordance → the builder drafts the increment (stubbed:
 * VG_CLAUDE_BIN, M10R.7) → the FULL 4a floor re-runs on the draft → the
 * changeset gate (with the "Builder draft" honesty badge) → accept builds
 * through the chokepoint and the ghosts turn solid.
 *
 * 4a proved the loop with a canned changeset; this proves the drafted path
 * reuses it end-to-end — hand-driven from the real UI control, with the
 * builder's output crossing the same boundary + floor (no shortcut).
 *
 * Fixture hygiene: everything written (.vibegraph/, app.py, db.py) is
 * removed in afterAll — greenfield_blank returns to its .gitkeep.
 *
 * Boot (see package.json test:e2e-plan-v7-4b):
 *   VG_FIXTURE=test/fixtures/greenfield_blank VG_PORT=4239 PORT=4239 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/run_effects/fake_claude_changeset.mjs" \
 *     npx playwright test test/e2e/plan-v7-4b-builder.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BLANK = FIXTURE.includes("greenfield_blank");
const ROOT = join(process.cwd(), FIXTURE);
const SHOT_DIR = "reviews/m-plan-v7-4b";

const PLAN = {
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

test.use({ video: "on" });

function cleanFixture() {
  rmSync(join(ROOT, ".vibegraph"), { recursive: true, force: true });
  for (const f of ["app.py", "db.py"]) rmSync(join(ROOT, f), { force: true });
}

test.describe("PLAN-v7 4b — builder-drafted increment through the same gate", () => {
  test.skip(!IS_BLANK, "Requires VG_FIXTURE=test/fixtures/greenfield_blank");

  test.beforeAll(() => {
    cleanFixture();
    mkdirSync(join(ROOT, ".vibegraph"), { recursive: true });
    writeFileSync(join(ROOT, ".vibegraph", "system-plan.json"), JSON.stringify(PLAN, null, 2) + "\n", "utf-8");
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    cleanFixture();
  });

  test("Build → drafted gate (floor re-run, Builder-draft badge) → accept → solid", async ({ page }) => {
    await page.goto("/");
    // The Build affordance exists ONLY because a ratified plan does — the
    // builder's input contract, visible as UI availability.
    await expect(page.locator('button:has-text("Build")')).toBeVisible({ timeout: 15_000 });

    // ── describe the capability via the real control ────────────────────
    await page.click('button:has-text("Build")');
    await expect(page.locator("[data-build-bar]")).toBeVisible({ timeout: 5_000 });
    await page.fill("[data-build-intent]", "the create-note flow: a POST route that stores a note");
    await page.click("[data-build-submit]");

    // The drafted increment arrives at the SAME gate, floor re-run and green,
    // wearing the drafted honesty badge.
    const gate = page.locator("[data-changeset-gate]");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-changeset-badge]")).toContainText(/Builder draft/i);
    await expect(page.locator('[data-changeset-file="app.py"][data-file-ok="true"]')).toHaveCount(1);
    await expect(page.locator('[data-changeset-file="db.py"][data-file-ok="true"]')).toHaveCount(1);
    await expect(page.locator('[data-changeset-check][data-check-ok="true"]')).toHaveCount(1);
    expect(existsSync(join(ROOT, "app.py"))).toBe(false);

    await page.screenshot({ path: join(SHOT_DIR, "builder-gate.png") });

    // ── accept → chokepoint build → solidify ────────────────────────────
    await page.click("[data-changeset-accept]");
    await expect.poll(() => existsSync(join(ROOT, "app.py")) && existsSync(join(ROOT, "db.py")), { timeout: 15_000 }).toBe(true);
    await expect(gate).toHaveCount(0, { timeout: 10_000 });

    await page.click('button:has-text("System")');
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-subsystem-node]")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(0, { timeout: 30_000 });

    await page.screenshot({ path: join(SHOT_DIR, "builder-after-solid.png") });
  });
});
