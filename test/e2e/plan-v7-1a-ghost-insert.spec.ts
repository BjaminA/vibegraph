/**
 * PLAN-v7 Stage 1a (G2) — preview-before-write: the anti-pollution gate.
 *
 * The insert path is now propose-first. This proves the honesty model on a
 * real existing project (flask_demo/cli.py):
 *   1. PROPOSE — dispatch the insert affordance's event → the server dry-runs
 *      the op (no write) and replies with a ghost. Assert: the ghost renders
 *      with the "PROPOSED — not yet written" state, AND the file on disk is
 *      byte-unchanged (nothing written — the honest IR stays honest).
 *   2. REJECT — the ghost vanishes; the file is STILL byte-unchanged.
 *   3. ACCEPT — re-propose, then accept → the wet op runs, the file now
 *      contains the inserted function, the ghost is gone, and the re-parse
 *      brings in the real (solid) node.
 *
 * Reconciliation (A1 pre/post-link lesson): the ghost id comes from an
 * isolated temp-parse (pre-link); the solid node comes from the full re-parse
 * (post-link). They reconcile on the STRUCTURAL ANCHOR — the ghost is dropped
 * on accept and the post-link node is the truth.
 *
 * REAL edit to flask_demo/cli.py — original bytes captured up front and
 * restored in afterAll (vibegraph-fixtures: never leave a fixture dirty).
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/plan-v7-1a-ghost-insert.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const CLI_PATH = join(process.cwd(), FIXTURE, "cli.py");
const SHOT_DIR = "reviews/m-plan-v7-1a";
// Unique marker function — insert_after the first function in cli.py.
const PROBE = "vg_ghost_probe";
const PROBE_SRC = `def ${PROBE}():\n    return 42\n`;

test.use({ video: "on" });

// Fire the (real) insert affordance's document event with a fixed spec, so the
// test drives the production propose path — not a test-only hook.
async function propose(page: import("@playwright/test").Page, anchorId: string) {
  await page.evaluate(
    ({ anchorId, source }) => {
      document.dispatchEvent(
        new CustomEvent("vg-stub-insert", {
          detail: {
            insertMode: "insert_after",
            anchorNodeId: anchorId,
            filePath: "cli.py",
            source,
            constructType: "function_def",
          },
        }),
      );
    },
    { anchorId, source: PROBE_SRC },
  );
}

test.describe("PLAN-v7 1a — ghost insert (propose → accept/reject)", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  let original = "";
  test.beforeAll(() => {
    original = readFileSync(CLI_PATH, "utf-8");
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    writeFileSync(CLI_PATH, original, "utf-8");
  });

  test("propose renders a ghost without writing; reject leaves disk clean; accept materialises the solid node", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // Open cli.py in the file/diagram view and grab a real anchor node id.
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="cli.py"]');
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
    const anchorId = await page
      .locator(".react-flow__node-functionDefNode")
      .first()
      .getAttribute("data-id");
    expect(anchorId, "a real function_def anchor in cli.py").toBeTruthy();

    // ── 1. PROPOSE ──────────────────────────────────────────────────────
    await propose(page, anchorId!);
    const ghost = page.locator("[data-ghost-node]");
    await expect(ghost).toBeVisible({ timeout: 15_000 });
    // The honesty label must be present and unmissable.
    await expect(page.locator("[data-proposed-badge]")).toContainText(/PROPOSED/i);
    // ANTI-POLLUTION: nothing was written — the file on disk is byte-identical.
    expect(readFileSync(CLI_PATH, "utf-8")).toBe(original);
    // ...and the parsed graph has no SOLID node for the probe yet (the ghost
    // is type `ghostNode`; a real function is `functionDefNode`).
    await expect(page.locator(".react-flow__node-functionDefNode").filter({ hasText: PROBE })).toHaveCount(0);

    // Visual gate: capture the ghost for human review (distinctness is a
    // human call — this test asserts the mechanical invariants only).
    await page.screenshot({ path: join(SHOT_DIR, "ghost-proposed.png") });

    // ── 2. REJECT ───────────────────────────────────────────────────────
    await page.click("[data-proposal-reject]");
    await expect(ghost).toHaveCount(0, { timeout: 10_000 });
    // Still byte-unchanged — reject never writes.
    expect(readFileSync(CLI_PATH, "utf-8")).toBe(original);

    // ── 3. ACCEPT ───────────────────────────────────────────────────────
    await propose(page, anchorId!);
    await expect(ghost).toBeVisible({ timeout: 15_000 });
    await page.click("[data-proposal-accept]");

    // The wet op ran: the file now contains the inserted function.
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
