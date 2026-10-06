/**
 * "Scope this node" in the GUI (2026-10-06, part 3 of In → Process → Out).
 * The stub Claude (test/fixtures/system/fake_claude_scope.mjs) scopes
 * tool:fetch with a mixed reply. Pinned: the ask is in the inspector; the
 * reply waits as a PROPOSAL — the cited word solid, the uncited one faded as
 * INFERRED, what the gate refused listed — and changes nothing on the bands
 * until Ratify; after it, the scoped word sits in Process, marked scoped.
 *
 *   VG_FIXTURE=test/fixtures/system/views_demo VG_PORT=4312 PORT=4312 VG_START_VIEW=architecture \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/system/fake_claude_scope.mjs" \
 *     npx playwright test test/e2e/node-scope.spec.ts --workers=1
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const STORE = join(resolve(FIXTURE || "."), ".vibegraph", "architecture.json");

async function openFetch(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-top-toolbar]", { timeout: 30_000 });
  const banner = page.locator("[data-key-banner]");
  if (await banner.count()) await banner.locator("button").click();
  await expect(page.locator('[data-system-view][data-system-mode="map"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-arch-lens="tools"]').click();
  await page.locator('[data-arch-id="tool:fetch"]').click({ force: true });
  await expect(page.locator('[data-node-io="tool:fetch"]')).toBeVisible();
}

test.describe("scope this node", () => {
  test.skip(!FIXTURE.includes("views_demo"), "Requires VG_FIXTURE=test/fixtures/system/views_demo");
  test.use({ viewport: { width: 1600, height: 1000 } });
  test.afterEach(() => { if (existsSync(STORE)) rmSync(STORE); });

  test("ask → a cited proposal (INFERRED faded, refusals listed) → nothing changes until Ratify → the word joins Process, scoped", async ({ page }) => {
    await openFetch(page);
    const block = page.locator('[data-node-scope="tool:fetch"]');
    await expect(block).toHaveAttribute("data-scope-state", "none");
    await expect(page.locator('[data-io-word="store"]')).toHaveCount(0);
    await block.locator("[data-scope-ask]").click();
    await expect(block).toHaveAttribute("data-scope-state", "proposed", { timeout: 20_000 });
    await expect(block.locator("[data-scope-summary]")).toContainText("HTTP client");
    await expect(block.locator('[data-scope-word="call"]')).not.toHaveAttribute("data-inferred", "true");
    await expect(block.locator('[data-scope-word="store"]')).toHaveAttribute("data-inferred", "true");
    await expect(block.locator('[data-scope-word="teleport"]')).toHaveCount(0);
    await block.locator("[data-scope-why]").click();
    await expect(block.locator("[data-scope-refused]")).toHaveCount(4); // teleport, the ghost box, the circular and the unshown citation
    // a proposal is not the map: Process is unchanged
    await expect(page.locator('[data-io-band="process"] [data-io-word="store"]')).toHaveCount(0);
    await block.locator("[data-scope-ratify]").click();
    await expect(block).toHaveAttribute("data-scope-state", "ratified", { timeout: 15_000 });
    await expect(page.locator('[data-io-band="process"] [data-io-word="store"]')).toHaveAttribute("data-scoped", "true");
    await expect(page.locator('[data-io-row="out"]', { hasText: "order decider" })).toContainText("the ledger's answer");
  });

  test("reject drops the proposal", async ({ page }) => {
    await openFetch(page);
    const block = page.locator('[data-node-scope="tool:fetch"]');
    await block.locator("[data-scope-note]").fill("what does it return?");
    await block.locator("[data-scope-ask]").click();
    await expect(block).toHaveAttribute("data-scope-state", "proposed", { timeout: 20_000 });
    await block.locator("[data-scope-reject]").click();
    await expect(block).toHaveAttribute("data-scope-state", "none", { timeout: 15_000 });
  });
});
