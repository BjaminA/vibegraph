/**
 * M20.2 — dynamic-README badge states + refresh affordance (PLAN-v5 §2).
 *
 * Deterministic: the badge state machine (none / fresh / stale) is driven
 * by the on-disk store + the server's current-IR hash, so we seed READMEs
 * to disk and assert the rendered state — no LLM in the loop. The actual
 * `claude -p` generation (Refresh → fresh body) is non-deterministic and
 * env-dependent, so we only assert that Refresh enters the generating
 * state, not its content.
 *
 * Gated on system_demo.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/system/system_demo VG_PORT=4205 PORT=4205 \
 *     npx playwright test test/e2e/m20-readmes.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeReadme, sourceHashOf, readmePath } from "../../src/server/readme_store";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_SYSTEM = FIXTURE.includes("system_demo");
const DIR = join(process.cwd(), "test", "fixtures", "system", "system_demo");
const PROJECT = JSON.parse(readFileSync(join(DIR, "system_demo.project.json"), "utf-8"));
const REVIEW_DIR = join(process.cwd(), "reviews", "m20-readmes");

function threadHash(entryPointId: string): string {
  const t = PROJECT.threads.find((x: any) => x.entryPointId === entryPointId);
  return sourceHashOf(t);
}

function cleanup(entryPointId: string) {
  try { rmSync(readmePath(DIR, "thread", entryPointId)); } catch { /* ok */ }
}

async function openThread(page, entryPointId: string) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
  await page.click(`[data-thread-index-row][data-entry-id="${entryPointId}"]`);
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
}

test.describe("M20.2 — README badge", () => {
  test.skip(!IS_SYSTEM, "Requires VG_FIXTURE=test/fixtures/system/system_demo");

  test.afterAll(() => {
    for (const id of ["app.py:get_user_route", "app.py:list_users_route", "app.py:create_charge_route"]) {
      cleanup(id);
    }
  });

  test("a README written against the current IR reads fresh", async ({ page }) => {
    const id = "app.py:get_user_route";
    writeReadme(DIR, "thread", id, "Fetches one user, cache-first; reaches cache + db.",
      threadHash(id), "2026-06-08T00:00:00Z");

    await openThread(page, id);
    const badge = page.locator("[data-readme-badge]");
    await expect(badge).toHaveAttribute("data-readme-state", "fresh", { timeout: 10_000 });
    await expect(badge.locator("[data-readme-refresh]")).toBeVisible();

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "fresh.png"), fullPage: false });
  });

  test("a README written against a different IR reads stale", async ({ page }) => {
    const id = "app.py:list_users_route";
    writeReadme(DIR, "thread", id, "Stale summary written against an older IR.",
      "sha256:deliberately-wrong", "2026-06-08T00:00:00Z");

    await openThread(page, id);
    const badge = page.locator("[data-readme-badge]");
    await expect(badge).toHaveAttribute("data-readme-state", "stale", { timeout: 10_000 });

    await page.screenshot({ path: join(REVIEW_DIR, "stale.png"), fullPage: false });
  });

  test("a thread with no README shows the not-generated state + a Generate action", async ({ page }) => {
    const id = "app.py:create_charge_route";
    cleanup(id); // ensure absent

    await openThread(page, id);
    const badge = page.locator("[data-readme-badge]");
    await expect(badge).toHaveAttribute("data-readme-state", "none", { timeout: 10_000 });

    // Refresh/Generate is on-request: clicking it enters the generating
    // state. (We don't assert the LLM result — that's env-dependent.)
    await badge.locator("[data-readme-refresh]").click();
    await expect(badge).toHaveAttribute("data-readme-state", "generating", { timeout: 5_000 });
  });
});
