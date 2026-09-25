/**
 * TRACE RUN (PLAN-M-RUNTIME.md phase 3) — the batch form of Observe:
 *
 *   press [data-trace-thread] → NOTHING has run: the SM3 floor answers with
 *   the effects on the path and a token, rendered as [data-trace-consent] →
 *   confirm → the entry point runs ONCE under scripts/trace_run.py and every
 *   call site it touched is annotated at once → hovering the dynamic node
 *   shows [data-observed-block] naming what it really called, with the run's
 *   date, entry point and inputs beside it.
 *
 * The point of the batch form is that ONE consent annotates MANY sites: this
 * spec asserts the count is greater than one, and that the annotation reaches
 * a node nobody clicked.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/observe_demo VG_PORT=4302 PORT=4302 \
 *     npx playwright test test/e2e/trace-run.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_OBSERVE = FIXTURE.includes("threads/observe_demo");
const OVERLAY = path.join(FIXTURE, ".vibegraph", "observations.json");

test.describe("Trace run — one consent, every call site", () => {
  test.skip(!IS_OBSERVE, "Requires VG_FIXTURE=test/fixtures/threads/observe_demo");

  // A stored overlay from a previous run would make the assertions pass
  // without the run happening. Start from nothing.
  test.beforeEach(() => { try { fs.unlinkSync(OVERLAY); } catch { /* fine */ } });
  test.afterAll(() => { try { fs.unlinkSync(OVERLAY); } catch { /* fine */ } });

  test("consent first, then every touched site annotated at once", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id$="dispatch"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    const traceBtn = page.locator("[data-trace-thread]");
    await expect(traceBtn).toBeVisible({ timeout: 10_000 });
    await traceBtn.click();

    // The floor answers first, and nothing has run.
    const consent = page.locator("[data-trace-consent]");
    await expect(consent).toBeVisible({ timeout: 20_000 });
    await expect(consent).toContainText("Nothing has run");
    expect(fs.existsSync(OVERLAY)).toBe(false);

    await page.locator("[data-trace-confirm]").click();

    const result = page.locator("[data-trace-result]");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toHaveAttribute("data-trace-outcome", "ok");
    // ONE consent, MANY sites — that is the whole reason this exists beside
    // the per-node Observe button.
    const annotated = await result.textContent();
    const count = Number(/(\d+) call site/.exec(annotated ?? "")?.[1] ?? "0");
    expect(count).toBeGreaterThan(1);
    // And the honesty label rides the batch result exactly as it rides one.
    await expect(page.locator("[data-trace-note]")).toContainText("Runtime sample");

    // The overlay is on disk, beside the IR, never in it.
    expect(fs.existsSync(OVERLAY)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(OVERLAY, "utf-8"));
    expect(Object.keys(stored.runs)).toContain("calc.py:dispatch");

    // A node NOBODY clicked now carries what the run saw there.
    await page.locator("[data-trace-result] button").click();
    await page.locator(".vg-thread-node-dynamic", { hasText: "eng.run" }).first().click();
    const observed = page.locator("[data-observed-block]");
    await expect(observed).toBeVisible({ timeout: 10_000 });
    await expect(observed).toContainText("observed:");
    await expect(observed).toContainText("Engine.run");
    // Provenance travels with it: which run, and on what inputs.
    await expect(observed).toContainText("calc.py:dispatch");
    await expect(observed).toContainText("no arguments");
    // Fresh: the file has not moved since the run. The flag lives on the
    // per-RUN row, because staleness is per file per run, not per node.
    await expect(page.locator("[data-observed-run]").first())
      .toHaveAttribute("data-observed-stale", "0");

    // An overlay is not a resolution: the node is still dynamic.
    await expect(
      page.locator(".vg-thread-node-dynamic", { hasText: "eng.run" }).first(),
    ).toBeVisible();
  });
});
