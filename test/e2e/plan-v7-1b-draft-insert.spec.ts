/**
 * PLAN-v7 Stage 1b — LIVE (stubbed) draft feeding the preview-before-write loop.
 *
 * 1a proved the loop with a canned insert spec. 1b swaps that for a `claude -p`
 * DRAFT via the reachable "Draft insert with Claude" toolbar affordance:
 *   1. DRAFT — select an anchor, open the Draft field, type an intent, submit.
 *      The server drafts the function (stubbed via VG_CLAUDE_BIN — never the
 *      real CLI, M10R.7), dry-runs the SAME op accept would write, and replies
 *      with a ghost. Assert: the ghost renders with the "CLAUDE DRAFT — not yet
 *      written" honesty badge (distinct from 1a's "PROPOSED"), AND the file on
 *      disk is byte-unchanged (nothing written — the honest IR stays honest).
 *   2. REJECT — the ghost vanishes; the file is STILL byte-unchanged.
 *   3. ACCEPT — re-draft, accept → the wet op runs, the file now contains the
 *      drafted function, the ghost is gone, and the re-parse brings in the real
 *      (solid) node.
 *
 * The whole downstream loop (composeProposeCore dry-run → ghost → accept re-runs
 * wet → structural-id reconcile) is REUSED unchanged from 1a; 1b only adds the
 * live-draft source + the `drafted` honesty flag. The stub emits a fenced
 * `def vg_draft_probe()` so the assertions are deterministic.
 *
 * REAL edit to flask_demo/cli.py — original bytes captured up front and
 * restored in afterAll (vibegraph-fixtures: never leave a fixture dirty).
 *
 * Boot (see package.json test:e2e-plan-v7-1b):
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4235 PORT=4235 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/run_effects/fake_claude_draft.mjs" \
 *     npx playwright test test/e2e/plan-v7-1b-draft-insert.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const CLI_PATH = join(process.cwd(), FIXTURE, "cli.py");
const SHOT_DIR = "reviews/m-plan-v7-1b";
// The stub (fake_claude_draft.mjs) always drafts this function.
const PROBE = "vg_draft_probe";

test.use({ video: "on" });

// Drive the REAL toolbar Draft affordance: open the intent field, type the
// intent, submit. Anchors on whatever node is currently selected.
async function draft(page: import("@playwright/test").Page, intent: string) {
  await page.click('button[title*="Describe an insertion"]');
  await expect(page.locator("[data-draft-bar]")).toBeVisible({ timeout: 5_000 });
  await page.fill("[data-draft-intent]", intent);
  await page.click("[data-draft-submit]");
}

test.describe("PLAN-v7 1b — drafted insert (intent → claude draft → ghost → accept/reject)", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  let original = "";
  test.beforeAll(() => {
    original = readFileSync(CLI_PATH, "utf-8");
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    writeFileSync(CLI_PATH, original, "utf-8");
  });

  test("draft renders a CLAUDE-DRAFT ghost without writing; reject leaves disk clean; accept materialises the solid node", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // Open cli.py, grab a real anchor, and SELECT it so the draft anchors
    // insert_after (the production selection channel a node-click uses). The
    // anchored ghost can land mid-canvas under the docked chat panel — the fix
    // is that the fixed ProposalActionBar owns accept/reject, so the decision
    // stays reachable regardless of ghost placement (this exercises that).
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="cli.py"]');
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
    const anchorId = await page
      .locator(".react-flow__node-functionDefNode")
      .first()
      .getAttribute("data-id");
    expect(anchorId, "a real function_def anchor in cli.py").toBeTruthy();
    await page.evaluate((id) => {
      document.dispatchEvent(new CustomEvent("vg-selection", {
        detail: { filePath: "cli.py", irNodeId: id, source: "diagram" },
      }));
    }, anchorId!);

    // ── 1. DRAFT ────────────────────────────────────────────────────────
    await draft(page, "add a retry wrapper helper");
    const ghost = page.locator("[data-ghost-node]");
    await expect(ghost).toBeVisible({ timeout: 15_000 });
    // The DRAFTED honesty badge — distinct from 1a's canned "PROPOSED".
    await expect(page.locator("[data-proposed-badge]")).toContainText(/CLAUDE DRAFT/i);
    await expect(ghost).toContainText(PROBE);
    // ANTI-POLLUTION: nothing was written — the file on disk is byte-identical.
    expect(readFileSync(CLI_PATH, "utf-8")).toBe(original);
    // ...and the parsed graph has no SOLID node for the probe yet.
    await expect(page.locator(".react-flow__node-functionDefNode").filter({ hasText: PROBE })).toHaveCount(0);

    await page.screenshot({ path: join(SHOT_DIR, "ghost-drafted.png") });

    // ── 2. REJECT ───────────────────────────────────────────────────────
    await page.click("[data-proposal-reject]");
    await expect(ghost).toHaveCount(0, { timeout: 10_000 });
    expect(readFileSync(CLI_PATH, "utf-8")).toBe(original);

    // ── 3. ACCEPT ───────────────────────────────────────────────────────
    await draft(page, "add a retry wrapper helper");
    await expect(ghost).toBeVisible({ timeout: 15_000 });
    await page.click("[data-proposal-accept]");

    // The wet op ran: the file now contains the drafted function.
    await expect
      .poll(() => readFileSync(CLI_PATH, "utf-8").includes(`def ${PROBE}(`), { timeout: 15_000 })
      .toBe(true);
    // The ghost is gone (reconciled away)...
    await expect(ghost).toHaveCount(0, { timeout: 10_000 });
    // ...and the re-parse brought in the real (solid) node.
    await expect(
      page.locator(".react-flow__node-functionDefNode").filter({ hasText: PROBE }),
    ).toHaveCount(1, { timeout: 15_000 });

    await page.screenshot({ path: join(SHOT_DIR, "after-accept-solid.png") });
  });
});
