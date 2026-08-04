/**
 * M26.2 — never strand stale UI: in-place tooltip upgrade (PLAN-M26 §M26.2).
 *
 * The user-reported dead-end: a function the chat just created shows up in
 * the STALE thread as `unresolved`; pinning its tooltip says "No source
 * available" and nothing ever fixes itself. M26.2 re-derives the open
 * tooltip against each fresh thread: the unresolved terminal's id changes
 * when re-linking resolves it (unresolved:fn → module:fn), so ThreadView
 * falls back to a label match and swaps the tooltip to the editable step
 * in place — Monaco appears WITHOUT re-hovering.
 *
 * The spec drives the same pipeline through EXTERNAL edits (fs writes →
 * watcher → full re-parse → envelope → App re-derives the open thread):
 *   1. add a call to a not-yet-existing function inside db.query
 *      → unresolved node appears in the open db:query thread
 *   2. pin its tooltip → honest "still re-linking" copy (not "No source")
 *   3. append the function definition → fresh envelope resolves the call
 *      → the SAME pinned tooltip upgrades to Monaco source, no re-hover
 *
 * Real edits to the flask_demo db.py fixture: original bytes restored in
 * finally (vibegraph-fixtures: never leave a fixture dirty).
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m26-2-tooltip-upgrade.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const DB_PATH = join(process.cwd(), FIXTURE, "db.py");

test.describe("M26.2 — pinned tooltip upgrades in place when the thread re-derives", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("unresolved → step: same tooltip, Monaco appears without re-hover", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const original = readFileSync(DB_PATH, "utf-8");
    try {
      await page.goto("/");
      await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
      await page.click('[data-thread-index-row][data-entry-id="db.py:query"]');
      await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(700);

      // 1. External edit: call a function that doesn't exist yet. The
      // watcher's full pipeline re-derives the open thread (M18.3 effect)
      // and the call surfaces as an `unresolved` terminal (R3).
      const withCall = original.replace(
        "def query(sql, params=()):\n    conn = _get_conn()",
        "def query(sql, params=()):\n    vg_probe_fn()\n    conn = _get_conn()",
      );
      // A dirtied fixture (live chat experiments — see PLAN-M26 gotchas)
      // breaks the anchor and the spec would time out cryptically.
      expect(withCall, "db.py fixture is dirty — `git checkout` it first").not.toBe(original);
      writeFileSync(DB_PATH, withCall, "utf-8");
      const unresolvedNode = page.locator(".vg-thread-node-unresolved", { hasText: "vg_probe_fn" });
      await expect(unresolvedNode).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800); // growth re-fit settles before we click

      // 2. Pin its tooltip. An unresolved node has no irNodeId, so the
      // click pins WITHOUT opening the editor panel (which would suppress
      // tooltips). The copy must be the honest re-linking line.
      await unresolvedNode.click();
      const tooltip = page.locator("[data-thread-tooltip]");
      await expect(tooltip).toBeVisible({ timeout: 5_000 });
      await expect(tooltip).toHaveAttribute("data-tooltip-kind", "unresolved");
      await expect(tooltip).toContainText("still re-linking");
      await expect(tooltip).not.toContainText("No source available");

      // 3. External edit: now define the function. The fresh thread
      // resolves the call; the SAME pinned tooltip must upgrade in place.
      writeFileSync(
        DB_PATH,
        readFileSync(DB_PATH, "utf-8") + "\n\ndef vg_probe_fn():\n    return 1\n",
        "utf-8",
      );
      // M26.4 — while the server re-derives, the toolbar shows the muted
      // re-linking pulse; it must clear when the refresh completes
      // (state-driven, never an open-ended spinner).
      const relink = page.locator("[data-graph-refreshing]");
      await expect(relink).toBeVisible({ timeout: 15_000 });
      await expect(relink).toBeHidden({ timeout: 15_000 });
      await expect(tooltip).toHaveAttribute("data-tooltip-kind", "step", { timeout: 30_000 });
      // The upgraded tooltip is the editable surface: Monaco with the
      // function's real source — the exact opposite of the dead-end.
      await expect(tooltip.locator(".monaco-editor .view-line").first()).toBeVisible({ timeout: 15_000 });
      await expect(tooltip).toContainText("vg_probe_fn");
      await expect(tooltip).not.toContainText("No source available");

      expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
    } finally {
      writeFileSync(DB_PATH, original, "utf-8");
    }
  });
});
