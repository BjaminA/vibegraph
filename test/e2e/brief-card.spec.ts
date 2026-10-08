/**
 * The Brief on the map (2026-10-08). The stub Claude
 * (test/fixtures/system/fake_claude_brief.mjs) answers with one cited
 * function line, one method line naming two boxes, an uncited feature line
 * and a refused line. Pinned: the card is folded and says "none"; Brief this
 * codebase asks for the estimate FIRST and spends nothing until "Draft it";
 * the reply waits ghosted as a PROPOSAL (the INFERRED line marked, the
 * refusal counted); a line lights the boxes it names; Ratify on the spec
 * section makes it the ratified Brief.
 *
 *   VG_FIXTURE=test/fixtures/system/views_demo VG_PORT=4314 PORT=4314 VG_START_VIEW=architecture \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/system/fake_claude_brief.mjs" \
 *     npx playwright test test/e2e/brief-card.spec.ts --workers=1
 */
import { test, expect } from "@playwright/test";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const STATE = join(resolve(FIXTURE || "."), ".vibegraph");
const cleanup = () => { for (const f of ["brief.json", "architecture.json"]) if (existsSync(join(STATE, f))) rmSync(join(STATE, f)); };

test.describe("the Brief card", () => {
  test.skip(!FIXTURE.includes("views_demo"), "Requires VG_FIXTURE=test/fixtures/system/views_demo");
  test.use({ viewport: { width: 1600, height: 1000 } });
  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  test("estimate first → a ghosted proposal → a line lights its boxes → Ratify makes it the Brief", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-top-toolbar]", { timeout: 30_000 });
    const banner = page.locator("[data-key-banner]");
    if (await banner.count()) await banner.locator("button").click();
    await expect(page.locator('[data-system-view][data-system-mode="map"]')).toBeVisible({ timeout: 30_000 });
    const card = page.locator("[data-brief-card]");
    await expect(card).toHaveAttribute("data-brief-state", "none");
    await card.locator("[data-brief-toggle]").click();
    await card.locator("[data-brief-ask]").click();
    await expect(card.locator("[data-brief-estimate]")).toContainText(/≈ 1 call/);
    await expect(card).toHaveAttribute("data-brief-state", "none"); // nothing spent yet
    await card.locator("[data-brief-run]").click();
    await expect(card).toHaveAttribute("data-brief-state", "proposed", { timeout: 20_000 });
    const proposal = card.locator("[data-brief-proposal]");
    await expect(proposal.locator('[data-brief-line="function"]')).toContainText("Decides when an order is released");
    await expect(proposal.locator('[data-brief-line="method"]')).toHaveCount(1); // the teleport line was refused
    await expect(proposal.locator('[data-brief-line="feature"]')).toHaveAttribute("data-brief-inferred", "true");
    // refused: the teleport word, its line (no method word left), the unshown citation
    await expect(proposal).toContainText("3 item(s) refused");
    // a line lights the boxes it names, and dims the rest
    await proposal.locator('[data-brief-line="method"]').click();
    await expect(page.locator('[data-arch-id="cluster:scripts:decider"]')).not.toHaveAttribute("data-arch-dim", "true");
    await expect(page.locator('[data-arch-dim="true"]').first()).toBeVisible();
    // the spec section ratified: the card now holds the Brief
    await card.locator('[data-brief-ratify="spec"]').click();
    await expect(card).toHaveAttribute("data-brief-state", "ratified", { timeout: 15_000 });
    await expect(card.locator('[data-brief-line="method"]')).toContainText("Partitions the ledger");
    await expect(card.locator("[data-brief-proposal]")).toHaveCount(0);
  });
});
