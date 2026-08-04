/**
 * §5.6a — exception-path joins, living-renderer proof.
 *
 * exc_demo's run_job has a full try / except / finally, each band holding
 * a call on the `store` parameter:
 *
 *     store.begin()
 *     try:      store.write(payload);  return record
 *     except:   store.rollback();      return None
 *     finally:  store.close()
 *
 * Asserts the three container joins on the painted view:
 *   - try → except   : dashed + RED ("vg-thread-edge-error"), label "on
 *                      error" — the conditional error branch.
 *   - try → finally  : solid flow, label "always" (the success path).
 *   - except → finally: solid flow, label "always" (the handler path).
 * The except band is never a solid "always" target.
 *
 * Gated on exc_demo.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/exc_demo VG_PORT=4209 PORT=4209 \
 *     npx playwright test test/e2e/m28-exception-joins.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_EXC = FIXTURE.includes("exc_demo");

const TRY = "jobs:run_job.fn/try@0";
const EXC = "jobs:run_job.fn/except@0";
const FIN = "jobs:run_job.fn/finally@0";
const edge = (from: string, to: string) =>
  `g.vg-thread-edge[data-source="${from}"][data-target="${to}"]`;

test.describe("§5.6a — try/except/finally container joins", () => {
  test.skip(!IS_EXC, "Requires VG_FIXTURE=test/fixtures/threads/exc_demo");

  test("try→except is red 'on error'; both finally joins are solid 'always'", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="jobs.py:run_job"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // try → except : conditional (dashed) + error (red), "on error".
    const onError = page.locator(edge(TRY, EXC));
    await onError.waitFor({ state: "attached", timeout: 10_000 });
    const onErrorCls = await onError.getAttribute("class");
    expect(onErrorCls).toContain("vg-thread-edge-conditional");
    expect(onErrorCls).toContain("vg-thread-edge-error");
    expect(onErrorCls).not.toContain("vg-thread-edge-flow");

    // except → finally : solid flow, "always".
    const excFin = page.locator(edge(EXC, FIN));
    await excFin.waitFor({ state: "attached", timeout: 10_000 });
    const excFinCls = await excFin.getAttribute("class");
    expect(excFinCls).toContain("vg-thread-edge-flow");
    expect(excFinCls).not.toContain("vg-thread-edge-conditional");

    // try → finally : solid flow, "always" (the success path).
    const tryFin = page.locator(edge(TRY, FIN));
    await tryFin.waitFor({ state: "attached", timeout: 10_000 });
    expect(await tryFin.getAttribute("class")).toContain("vg-thread-edge-flow");

    // Labels: two "always", one "on error".
    await expect(page.locator(".vg-thread-edge-label", { hasText: "on error" }))
      .toHaveCount(1);
    await expect(page.locator(".vg-thread-edge-label", { hasText: "always" }))
      .toHaveCount(2);

    // The except band must never be a solid "always" target.
    await expect(page.locator(`${edge(TRY, EXC)}.vg-thread-edge-flow`)).toHaveCount(0);

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
