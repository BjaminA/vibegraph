/**
 * THE BASH RUN FLOOR (PLAN-M-RUNTIME phase 3, bash) — traced live on
 * deploy_demo, a script that does `rm -rf build/`, `curl -T` to prod,
 * `ssh`, `psql`, `"$HOOK_CMD"` and `eval "$POST_DEPLOY"`.
 *
 * The claim under test is the whole reason bash could not be traced before:
 *
 *   press trace → consent NAMES the commands and says they will be RECORDED,
 *   not executed → confirm → the script runs FOR REAL → the overlay carries
 *   what each line called → and `build/` was never created, because `mkdir`
 *   and `rm` resolved to a recorder rather than to the programs.
 *
 * `mkdir` is the assertion that matters. If the floor leaked, the fixture
 * directory would have a build/ in it afterwards.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/bash/deploy_demo VG_PORT=4304 PORT=4304 \
 *     npx playwright test test/e2e/trace-bash.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_DEPLOY = FIXTURE.includes("bash/deploy_demo");
const OVERLAY = path.join(FIXTURE, ".vibegraph", "observations.json");
const BUILD_DIR = path.join(FIXTURE, "build");

test.describe("Bash trace — the floor makes execution impossible, then runs it", () => {
  test.skip(!IS_DEPLOY, "Requires VG_FIXTURE=test/fixtures/bash/deploy_demo");

  test.beforeEach(() => { try { fs.rmSync(OVERLAY); } catch { /* fine */ } });
  test.afterAll(() => {
    try { fs.rmSync(OVERLAY); } catch { /* fine */ }
    try { fs.rmSync(BUILD_DIR, { recursive: true }); } catch { /* fine */ }
  });

  test("consent names what is neutralised; the run resolves $CMD; nothing executes", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="deploy.sh:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // The button is here because bash has `trace: true` — while `run` stays
    // false, so run-to-here and Observe are still absent. Affordance matches
    // the operation that exists.
    const traceBtn = page.locator("[data-trace-thread]");
    await expect(traceBtn).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-observe-node]")).toHaveCount(0);

    await traceBtn.click();

    const consent = page.locator("[data-trace-consent]");
    await expect(consent).toBeVisible({ timeout: 20_000 });
    // It NAMES the dangerous ones rather than saying "effects found".
    await expect(consent).toContainText("rm");
    await expect(consent).toContainText("curl");
    await expect(consent).toContainText("psql");
    expect(fs.existsSync(OVERLAY)).toBe(false);

    await page.locator("[data-trace-confirm]").click();

    const result = page.locator("[data-trace-result]");
    await expect(result).toBeVisible({ timeout: 40_000 });
    const annotated = Number(/(\d+) call site/.exec((await result.textContent()) ?? "")?.[1] ?? "0");
    expect(annotated).toBeGreaterThan(1);

    // THE FLOOR HELD. `mkdir -p build/` was traced and recorded; if a single
    // external program had actually run, this directory would exist.
    expect(fs.existsSync(BUILD_DIR)).toBe(false);

    // And the overlay carries what the lines really called.
    const stored = JSON.parse(fs.readFileSync(OVERLAY, "utf-8"));
    const run = stored.runs["deploy.sh:main"];
    expect(run).toBeTruthy();
    expect(run.language).toBe("bash");
    // The inputs line records the neutralisation, so a reader months later
    // knows these commands did not happen.
    expect(run.inputs).toMatch(/RECORDED, not executed/);
    const callees = Object.values(run.observations["deploy.sh"] ?? {})
      .flatMap((o: any) => o.callees.map((c: any) => c.callee));
    expect(callees).toContain("rm");
    expect(callees).toContain("curl");
  });
});
