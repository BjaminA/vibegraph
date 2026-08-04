/**
 * M-NN-2 — "backend" means WEB backend; routeless code is a library.
 *
 * Living-renderer proof on the library_only fixture (the neural-net
 * rehearsal's generated CNN: model + public_api + cli entries, no
 * routes):
 *
 *   1. The system view paints ONE solid `library` card and NO `backend`
 *      card — build_system_tier no longer rolls routeless non-manual
 *      entries into backend.
 *   2. The library card owns its entry points: honest "N entry points"
 *      subline (never "routes") and expand-to-reveal, mirroring backend.
 *   3. THE RECONCILE — with a pre-seeded ratified plan whose only
 *      subsystem is `library` (what the greenfield draft pins for a
 *      pure-ML description), the ghost SOLIDIFIES: 0 lingering planned
 *      subsystems. This is the cheap in-chain proof of the rehearsal's
 *      "lingering plan ghosts: 0" flip.
 *
 * Fixture hygiene: the pre-seeded .vibegraph/ is removed in afterAll.
 *
 * Boot (see package.json test:e2e-library):
 *   VG_FIXTURE=test/fixtures/system/library_only VG_PORT=4248 PORT=4248 \
 *     npx playwright test test/e2e/m-nn2-library-subsystem.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_LIBRARY = FIXTURE.includes("library_only");
const ROOT = join(process.cwd(), FIXTURE);
const SHOT_DIR = "reviews/m-nn2-library";

// The ratified plan as the greenfield draft would persist it for a
// pure-ML description: one `library` subsystem (id = bare kind).
const PLAN = {
  version: "1",
  description: "a PyTorch CNN classifier trained on synthetic images",
  subsystems: [
    { id: "library", kind: "library", label: "PyTorch CNN", groundedIn: "a PyTorch CNN classifier" },
  ],
  edges: [],
  drafted: false,
  ratifiedAt: "2026-07-15T00:00:00.000Z",
};

test.describe("M-NN-2 — routeless project is a library, and its plan ghost reconciles", () => {
  test.skip(!IS_LIBRARY, "Requires VG_FIXTURE=test/fixtures/system/library_only");

  test.beforeAll(() => {
    mkdirSync(join(ROOT, ".vibegraph"), { recursive: true });
    writeFileSync(join(ROOT, ".vibegraph", "system-plan.json"), JSON.stringify(PLAN, null, 2) + "\n", "utf-8");
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.afterAll(() => {
    rmSync(join(ROOT, ".vibegraph"), { recursive: true, force: true });
  });

  async function openSystemView(page) {
    await page.goto("/");
    await page.getByRole("button", { name: "System" }).click();
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600); // settle fitView
  }

  test("one solid library card, no backend, ghost reconciled", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await openSystemView(page);

    // 1. The classification fix: library solid, backend absent.
    await expect(page.locator('[data-subsystem-node][data-subsystem-kind="library"]')).toHaveCount(1);
    await expect(page.locator('[data-subsystem-node][data-subsystem-kind="backend"]')).toHaveCount(0);

    // 3. The reconcile: ids align (bare kind) AND kinds now agree, so the
    // planned `library` ghost solidified — nothing lingers.
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(0);

    await page.screenshot({ path: join(SHOT_DIR, "library-solid-no-ghost.png"), fullPage: false });
    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  test("the library card owns its entry points — honest subline + expand-to-reveal", async ({ page }) => {
    await openSystemView(page);

    const lib = page.locator('[data-subsystem-node][data-subsystem-kind="library"]').first();
    // Honest vocabulary: these are entry points, not routes.
    await expect(lib).toContainText("5 entry points");
    await expect(lib).toContainText("4 files");
    await expect(lib).not.toContainText("routes");

    // Progressive disclosure, exactly as backend's routes behave.
    await expect(lib.locator("[data-subsystem-endpoint]")).toHaveCount(0);
    await lib.locator("[data-subsystem-expand]").click();
    const endpoints = lib.locator("[data-subsystem-endpoint]");
    await expect(endpoints).toHaveCount(5);
    await expect(lib.locator('[data-subsystem-endpoint][data-entry-id="model.py:CNNClassifier.forward"]')).toBeVisible();

    await page.screenshot({ path: join(SHOT_DIR, "library-expanded.png"), fullPage: false });
  });
});
