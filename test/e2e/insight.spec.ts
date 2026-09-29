/**
 * GUI insight (2026-09-28) — what the export says in files, on screen, on
 * test/fixtures/insight/insight_demo:
 *
 *   thread chips   app.py:main is "tested · 1" (tests/test_lib.py reaches its
 *                  helper) and "env · 2 (1 undeclared)" (REGION is declared
 *                  nowhere; API_KEY is, in docker-compose.yml);
 *   code view      lib.py's unused_helper is dimmed; app.py's env reads carry a
 *                  glyph, the undeclared one amber;
 *   files panel    broken.ts is partly parsed and reached by nothing; after an
 *                  export, editing app.py marks it changed;
 *   map            the Configuration lens draws the process reading API_KEY and
 *                  REGION.
 *
 *   npm run test:e2e-insight
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const ROOT = join(process.cwd(), "test", "fixtures", "insight", "insight_demo");
const REVIEW_DIR = join(process.cwd(), "reviews", "gui-insight");

async function boot(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
  const banner = page.locator("[data-key-banner]");
  if (await banner.count() > 0) await banner.locator("button").click();
}

async function openCode(page: Page, file: string) {
  await page.click('[data-side-panel-tab="files"]');
  await page.click(`[data-file-tree-row="${file}"]`);
  await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
  await page.click('button[title="Show source for the active file"]');
  await page.waitForSelector("[data-code-view] .monaco-editor .view-line", { timeout: 15_000 });
  await page.waitForTimeout(500);
}

test.describe("GUI insight", () => {
  test.skip(!FIXTURE.includes("insight/insight_demo"), "Requires VG_FIXTURE=test/fixtures/insight/insight_demo");
  test.beforeAll(() => mkdirSync(REVIEW_DIR, { recursive: true }));

  test("thread chips: tested by one test, two env vars with one undeclared", async ({ page }) => {
    await boot(page);
    await page.click('[data-thread-index-row][data-entry-id="app.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    const tests = page.locator("[data-thread-tests-chip]");
    await expect(tests).toHaveAttribute("data-test-count", "1");
    await expect(tests).toContainText("tested · 1");
    const env = page.locator("[data-thread-env-chip]");
    await expect(env).toHaveAttribute("data-env-count", "2");
    await expect(env).toHaveAttribute("data-env-undeclared", "1");
    await env.click();
    const card = page.locator('[data-thread-insight-card="env"]');
    await expect(card.locator('[data-env-var="REGION"]')).toContainText("declared nowhere");
    await expect(card.locator('[data-env-var="API_KEY"]')).not.toContainText("declared nowhere");
    await page.screenshot({ path: join(REVIEW_DIR, "1-thread-chips.png") });
    await tests.click();
    await expect(page.locator('[data-thread-insight-card="tests"] [data-open-test="tests/test_lib.py:test_helper"]')).toBeVisible();
  });

  test("code view: the never-named function is dimmed; env reads carry a glyph, the undeclared one amber", async ({ page }) => {
    await boot(page);
    await openCode(page, "lib.py");
    await expect(page.locator("[data-code-view] .vg-unreached-code").first()).toBeVisible();
    await page.screenshot({ path: join(REVIEW_DIR, "2-code-unreached.png") });
    await page.click('button[title="Close code view"]');
    await openCode(page, "app.py");
    await expect(page.locator("[data-code-view] .vg-env-glyph")).toHaveCount(2);
    await expect(page.locator("[data-code-view] .vg-env-glyph-undeclared")).toHaveCount(1);
    await page.screenshot({ path: join(REVIEW_DIR, "3-code-env.png") });
  });

  test("files panel: partly parsed + unreached, and a file edited after an export reads as changed", async ({ page }) => {
    test.setTimeout(120_000);
    const appPath = join(ROOT, "app.py");
    const original = readFileSync(appPath, "utf-8");
    try {
      await boot(page);
      await page.click('[data-side-panel-tab="files"]');
      const broken = page.locator('[data-file-tree-row="broken.ts"]');
      await expect(broken).toHaveAttribute("data-file-partial", "true");
      await expect(broken).toHaveAttribute("data-file-unreached", "true");
      await expect(page.locator("[data-file-tree-legend]")).toBeVisible();
      // Export (writes sources.json), then edit app.py: the live server's next
      // derived pass compares hashes and marks it.
      const ex = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", "export", ROOT],
        { encoding: "utf-8", env: { ...process.env, PYTHONPATH: join(process.cwd(), ".pydeps") } });
      expect(ex.status, ex.stderr).toBe(0);
      writeFileSync(appPath, `${original}# edited after the export\n`);
      await expect(page.locator('[data-file-tree-row="app.py"]')).toHaveAttribute("data-file-changed", "true", { timeout: 60_000 });
      await expect(page.locator('[data-file-tree-row="lib.py"]')).not.toHaveAttribute("data-file-changed", "true");
      await page.screenshot({ path: join(REVIEW_DIR, "4-files-panel.png") });
    } finally {
      writeFileSync(appPath, original);
      rmSync(join(ROOT, ".vibegraph"), { recursive: true, force: true });
    }
  });

  test("architecture map: the Configuration lens draws the process and the variables it reads", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.removeItem("vg-system-mode"); localStorage.removeItem("vg-arch-lens"); } catch { /* */ } });
    await boot(page);
    await page.getByRole("button", { name: "System" }).click();
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 10_000 });
    await page.locator("[data-system-arch-toggle]").click();
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "map");
    await page.locator('[data-arch-lens="config"]').click();
    await expect(page.locator('[data-arch-lens="config"]')).toHaveAttribute("data-active", "true");
    await expect(page.locator('[data-arch-id="env:API_KEY"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-arch-id="env:REGION"]')).toContainText("declared nowhere");
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(REVIEW_DIR, "5-config-lens.png") });
  });
});
