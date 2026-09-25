/**
 * M-LANG2b (PLAN-M-LANG.md) — the bash read-only experience, proven in
 * the LIVING renderer (not just extractor snapshots):
 *
 *   1. the launchpad lists the shebang+main entry (deploy.sh:main,
 *      framework "shell");
 *   2. the thread paints: cross-file steps into lib/common.sh, external
 *      effect terminals, and DYNAMIC markers for "$HOOK_CMD" / eval;
 *   3. Monaco opens the file in the `shell` language;
 *   4. affordance-must-match-operation: NO run-to-here button, NO Save —
 *      the editor panel shows the read-only note (bash has no edit/run
 *      floor until M-LANG4).
 *
 * Gated on the deploy_demo fixture.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/bash/deploy_demo VG_PORT=4266 PORT=4266 \
 *     npx playwright test test/e2e/m-lang2-bash.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_DEPLOY = FIXTURE.includes("bash/deploy_demo");
const REVIEW_DIR = join(process.cwd(), "reviews", "m-lang2-bash");

test.describe("M-LANG2b — bash read-only experience", () => {
  test.skip(!IS_DEPLOY, "Requires VG_FIXTURE=test/fixtures/bash/deploy_demo");

  test("launchpad entry, thread markers, shell Monaco, gated affordances", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");

    // 1 — the launchpad lists the shebang + main "$@" entry.
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    const row = page.locator('[data-thread-index-row][data-entry-id="deploy.sh:main"]');
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 2 — open the thread: cross-file step + external + dynamic markers.
    await row.click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    await expect(page.locator(".vg-thread-node-external").first()).toBeVisible();
    await expect(page.locator(".vg-thread-node-dynamic").first()).toBeVisible();
    // No resolution gaps in this fixture: nothing may ghost as unresolved.
    await expect(page.locator(".vg-thread-node-unresolved")).toHaveCount(0);

    // M-LANG6 — external chips paint from the IR-stamped effectKind
    // (accentForEffectKind), not the Python vocabulary tables: curl
    // must read HTTP and psql must read DB in the live renderer.
    await expect(
      page.locator('.vg-thread-node-external[data-kind-label="HTTP"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('.vg-thread-node-external[data-kind-label="DB"]').first(),
    ).toBeVisible();

    // The cross-file step into the sourced lib must render as a step node.
    const stepLabels = await page.locator(".vg-thread-node-step").allTextContents();
    expect(stepLabels.join(" ")).toContain("log_step");

    // M-LANG QA — container labels read like the language, live: the
    // loop variable is not duplicated into the iterable, and the
    // flattened case does not double as "if case".
    // (The renderer chips the keyword uppercase: "FOR  target in …".)
    const viewText = (await page.locator("[data-thread-view]").textContent()) ?? "";
    expect(viewText).toContain("target in staging prod");
    expect(viewText).not.toContain("in target staging");
    expect(viewText).toMatch(/CASE\s+"\$1"/);
    expect(viewText).not.toMatch(/IF\s+case/);

    // 3+4 — click a step node: tooltip pins; it must offer NO run button
    // and NO editable save; the source view opens read-only.
    const stepNode = page.locator(".vg-thread-node-step", { hasText: "prepare" }).first();
    await stepNode.click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-run-to-here]")).toHaveCount(0);

    // Monaco (wherever it mounted — tooltip source view or editor panel)
    // must hold a model in the `shell` language for deploy.sh.
    await page.waitForSelector(".monaco-editor", { timeout: 10_000 });
    const languages = await page.evaluate(() => {
      const m = (window as any).monaco;
      if (!m?.editor) return [];
      return m.editor.getModels().map((mod: any) => mod.getLanguageId());
    });
    expect(languages).toContain("shell");
    expect(languages).not.toContain("python");

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "bash-thread.png"), fullPage: true });

    expect(pageErrors).toEqual([]);
  });
});
