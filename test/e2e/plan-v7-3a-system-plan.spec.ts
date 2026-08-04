/**
 * PLAN-v7 Stage 3a (gate) — proposed architecture: the anti-pollution +
 * ratification e2e on a real existing project (flask_demo).
 *
 * The system-tier analogue of Stage 1's gate, with the Stage-3 inversion:
 * ACCEPT cannot write code (none exists yet) — it RATIFIES, persisting
 * .vibegraph/system-plan.json; ghosts stay "PLANNED — not yet built" until
 * Stage 4+ builds code that re-parses into matching subsystems.
 *
 *   1. PROPOSE — dispatch a canned plan → ghosts render for the NOT-yet-real
 *      subsystems only (the colliding `backend` draws NO ghost — solid wins:
 *      the reconcile rule), with per-item grounding chips (a quote from the
 *      description vs ⚠ INFERRED). Honest tier unpolluted; nothing on disk.
 *   2. REJECT — overlay gone; still nothing on disk.
 *   3. RATIFY — re-propose, accept → the plan artifact exists (ratifiedAt
 *      stamped), the ghosts PERSIST (now from the envelope's systemPlan
 *      sibling), the gate bar is gone.
 *   4. RELOAD — the ratified ghosts survive a fresh page load (durable plan),
 *      and the honest tier is still exactly its parsed self.
 *
 * REAL write into the fixture (.vibegraph/system-plan.json) — removed in
 * afterAll (vibegraph-fixtures: never leave a fixture dirty). ONLY the plan
 * file: .vibegraph/ is a pre-existing fixture directory (manual_seeds.json,
 * M8.3.3, is TRACKED) — never rm the directory recursively.
 *
 * Boot (see package.json test:e2e-plan-v7-3a):
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4236 PORT=4236 \
 *     npx playwright test test/e2e/plan-v7-3a-system-plan.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const PLAN_PATH = join(process.cwd(), FIXTURE, ".vibegraph", "system-plan.json");
const SHOT_DIR = "reviews/m-plan-v7-3a";

// Canned proposal: `backend` collides with the honest tier (solid wins → no
// ghost); `cache` is grounded in the description; the stripe external is
// INFERRED (groundedIn null). One plan edge touches a ghost (renders), one
// connects two honest subsystems (must NOT render — reality already shows it).
const PLAN = {
  version: "1",
  description: "a flask API with a sqlite store and a redis cache",
  subsystems: [
    { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
    { id: "cache", kind: "cache", label: "Redis cache", groundedIn: "a redis cache" },
    { id: "external_http:api.stripe.com", kind: "external_http", label: "Stripe", groundedIn: null },
  ],
  edges: [
    { from: "backend", to: "cache", groundedIn: "a redis cache" },
    { from: "backend", to: "external_http:api.stripe.com", groundedIn: null },
    { from: "backend", to: "db", groundedIn: "a sqlite store" }, // both honest → no ghost edge
  ],
  drafted: false,
};

test.use({ video: "on" });

async function openSystemView(page: import("@playwright/test").Page) {
  await page.click('button:has-text("System")');
  await page.waitForSelector('[data-system-view]', { timeout: 15_000 });
  // The subsystem/threads mode toggle persists in localStorage; force
  // subsystems mode if a previous run left threads mode behind.
  const mode = await page.locator("[data-system-view]").getAttribute("data-system-mode");
  if (mode === "threads") await page.click("[data-system-mode-toggle]");
  await expect(page.locator("[data-subsystem-node]").first()).toBeVisible({ timeout: 15_000 });
}

function propose(page: import("@playwright/test").Page) {
  return page.evaluate((plan) => {
    document.dispatchEvent(new CustomEvent("vg-system-propose", { detail: { plan } }));
  }, PLAN);
}

test.describe("PLAN-v7 3a — proposed architecture (ghost tier → ratify/reject)", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test.beforeAll(() => {
    rmSync(PLAN_PATH, { force: true });
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    rmSync(PLAN_PATH, { force: true });
  });

  test("propose ghosts the plan without persisting; reject leaves nothing; ratify persists and survives reload", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await openSystemView(page);

    // Honest baseline: flask_demo parses to backend + db + library. (The
    // library card is 6a drift: sqlite3.connect now classifies as a db
    // effect, so the entry-point-less db.py:_get_conn helper thread —
    // which rolls into `library` by design — carries its own honest
    // library→db edge.)
    await expect(page.locator("[data-subsystem-node]")).toHaveCount(3);

    // ── 1. PROPOSE ──────────────────────────────────────────────────────
    await propose(page);
    await expect(page.locator("[data-system-plan-bar]")).toBeVisible({ timeout: 10_000 });

    // Ghosts: cache + stripe ONLY — the colliding `backend` is already real
    // (solid wins), so 3 planned subsystems render 2 ghosts.
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(2);
    await expect(page.locator('[data-planned-subsystem][data-subsystem-id="cache"]')).toBeVisible();
    await expect(page.locator('[data-planned-subsystem][data-subsystem-id="backend"]')).toHaveCount(0);
    // The honesty label + per-item grounding.
    await expect(page.locator("[data-planned-badge]").first()).toContainText(/PLANNED/i);
    await expect(page.locator("[data-plan-grounded]")).toContainText("a redis cache");
    await expect(page.locator("[data-plan-inferred]")).toContainText(/INFERRED/i);
    // The gate bar counts what is NOT traceable to the user's words.
    await expect(page.locator("[data-system-plan-bar]")).toContainText("inferred");

    // Plan edges: ghost-touching edges render; the both-honest backend→db
    // plan edge must NOT (reality already shows that structure).
    await expect(page.locator('.react-flow__edge[data-id="plan:backend cache"]')).toHaveCount(1);
    await expect(page.locator('.react-flow__edge[data-id="plan:backend db"]')).toHaveCount(0);

    // ANTI-POLLUTION: the honest tier is untouched — still exactly 3 solid
    // cards — and nothing was persisted.
    await expect(page.locator("[data-subsystem-node]")).toHaveCount(3);
    expect(existsSync(PLAN_PATH)).toBe(false);

    await page.screenshot({ path: join(SHOT_DIR, "ghost-architecture.png") });

    // ── 2. REJECT ───────────────────────────────────────────────────────
    await page.click("[data-system-plan-reject]");
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator("[data-system-plan-bar]")).toHaveCount(0);
    expect(existsSync(PLAN_PATH)).toBe(false);

    // ── 3. RATIFY ───────────────────────────────────────────────────────
    await propose(page);
    await expect(page.locator("[data-system-plan-bar]")).toBeVisible({ timeout: 10_000 });
    await page.click("[data-system-plan-accept]");

    // The artifact exists, stamped.
    await expect.poll(() => existsSync(PLAN_PATH), { timeout: 10_000 }).toBe(true);
    const persisted = JSON.parse(readFileSync(PLAN_PATH, "utf-8"));
    expect(persisted.description).toBe(PLAN.description);
    expect(typeof persisted.ratifiedAt).toBe("string");

    // The gate is closed but the ghosts PERSIST — now from the envelope's
    // systemPlan sibling. Ratified ≠ built: they stay PLANNED.
    await expect(page.locator("[data-system-plan-bar]")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(2, { timeout: 10_000 });
    await expect(page.locator('[data-planned-subsystem][data-plan-ratified="true"]')).toHaveCount(2);

    // ── 4. RELOAD — the ratified plan is durable ────────────────────────
    await page.reload();
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await openSystemView(page);
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator("[data-subsystem-node]")).toHaveCount(3);
    // No pending gate on reload — a ratified plan is a plan, not a question.
    await expect(page.locator("[data-system-plan-bar]")).toHaveCount(0);

    await page.screenshot({ path: join(SHOT_DIR, "after-ratify-reload.png") });
  });
});
