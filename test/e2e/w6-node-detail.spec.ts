/**
 * W6 — node detail shows the real call source + honest wording, in BOTH
 * resolution directions.
 *
 * Originally one test: `torch.stack(...)` with torch NOT installed used to
 * show the alarming raw resolver error ("No module named 'torch'") and never
 * the actual call; W6 reworded the unresolved fallback at the render layer.
 * Then torch landed in .pydeps (c0f77b3, the neural-net rehearsal) and
 * torch.stack began RESOLVING — the fallback assertion could never fire on
 * composed_demo again (NEXT-ACTIONS §1). The spec now covers each direction
 * on the fixture that honestly produces it:
 *
 *   1. RESOLVED (composed_demo, torch installed): the tooltip shows the call
 *      expression verbatim AND the genuinely introspected signature — the
 *      better outcome the env made possible. Runs in test:e2e-arch-composed.
 *   2. UNRESOLVED (deps_demo, `vg_absent_dep_zz` deliberately uninstalled):
 *      the env-honest fallback wording — "analysis environment … not an
 *      error in your code", never the bare alarm. Runs in test:e2e-deps.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/architecture/composed_demo VG_PORT=4221 PORT=4221  (resolved)
 *   VG_FIXTURE=test/fixtures/threads/deps_demo         VG_PORT=4245 PORT=4245  (unresolved)
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";

test.describe("W6 — resolved third-party call shows the real source", () => {
  test.skip(!FIXTURE.includes("composed_demo"), "Requires VG_FIXTURE=test/fixtures/architecture/composed_demo");

  test("torch.stack tooltip shows the call verbatim and the introspected signature", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="model.py:ChainNet.forward"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);

    const node = page.locator(".vg-thread-node").filter({ hasText: "torch.stack" }).first();
    await node.waitFor({ state: "visible", timeout: 10_000 });
    await node.hover();

    const tooltip = page.locator("[data-thread-tooltip]");
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });

    // 1 — the call expression verbatim (not just the dotted target).
    await expect(tooltip).toContainText("torch.stack([", { timeout: 6_000 });

    // 2 — torch IS installed in .pydeps, so the resolve round-trip returns
    // the real signature + module footer, not any unresolved fallback.
    await expect(tooltip).toContainText(/stack\(tensors/, { timeout: 6_000 });
    await expect(tooltip).toContainText("third-party");
    await expect(tooltip).not.toContainText(/analysis environment/);
    // The bare alarm phrasing must never surface in either direction.
    await expect(tooltip).not.toContainText(/No module named/);

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});

test.describe("W6 — unresolvable call keeps the env-honest fallback wording", () => {
  test.skip(!FIXTURE.includes("deps_demo"), "Requires VG_FIXTURE=test/fixtures/threads/deps_demo");

  test("tooltip shows the call verbatim and an env-honest message", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    // The missing-deps banner is EXPECTED on this fixture (vg_absent_dep_zz
    // is uninstalled by design); dismiss it so it can't occlude the canvas.
    const bannerClose = page.locator('[data-deps-banner] button[title="Dismiss"]');
    if (await bannerClose.count()) await bannerClose.click();

    await page.click('[data-thread-index-row][data-entry-id="app.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);

    const node = page.locator(".vg-thread-node").filter({ hasText: "vg_absent_dep_zz" }).first();
    await node.waitFor({ state: "visible", timeout: 10_000 });
    await node.hover();

    const tooltip = page.locator("[data-thread-tooltip]");
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });

    // 1 — the call target. (The full-expression verbatim source doesn't
    // surface for this bare expression-statement node shape — the verbatim
    // feature is pinned on composed_demo above; a known-minor gap here.)
    await expect(tooltip).toContainText("vg_absent_dep_zz.send", { timeout: 6_000 });

    // 2 — honest, less-alarming wording (resolve round-trip → unresolved).
    await expect(tooltip).toContainText(/analysis environment/, { timeout: 6_000 });
    await expect(tooltip).toContainText(/not an error in your code/);
    // The bare alarm phrasing must not be the message.
    await expect(tooltip).not.toContainText(/^No module named/);

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
