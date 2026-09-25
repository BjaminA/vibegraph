/**
 * SCOPE button (PLAN-M-RUNTIME.md phase 1) — the C2 explain-this-node
 * machinery, surfaced as one press in the tooltip:
 *
 *   click a DYNAMIC node ("$HOOK_CMD") → [data-scope-node] renders →
 *   press → the stubbed claude's inference appears in
 *   [data-scope-result] WITH the attribution line, and the node's kind
 *   marker stays dynamic — the honesty contract observed live: an AI
 *   inference is a labelled overlay, never a resolution.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/bash/deploy_demo VG_PORT=4278 PORT=4278 \
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/run_effects/fake_claude_json.mjs" \
 *   FAKE_SYNTH_RESPONSE="Likely invokes the deploy hook configured in DEPLOY_HOOK." \
 *     npx playwright test test/e2e/scope-button.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_DEPLOY = FIXTURE.includes("bash/deploy_demo");
const STUBBED = !!process.env.VG_CLAUDE_BIN;

test.describe("Scope button — AI inference on a dynamic node", () => {
  test.skip(!IS_DEPLOY || !STUBBED, "Requires deploy_demo + VG_CLAUDE_BIN stub");

  test("one press yields a hedged inference with its attribution; kind stays dynamic", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="deploy.sh:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // Pin the tooltip on the "$HOOK_CMD" dynamic terminal.
    await page.locator(".vg-thread-node-dynamic", { hasText: "$HOOK_CMD" }).first().click();
    const scopeBtn = page.locator("[data-scope-node]");
    await expect(scopeBtn).toBeVisible({ timeout: 10_000 });

    await scopeBtn.click();
    const result = page.locator("[data-scope-result]");
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toContainText("Likely invokes the deploy hook");
    // The honesty label travels with every inference (X1).
    await expect(result).toContainText("Claude's interpretation");

    // The node's kind did NOT change — dynamic stays dynamic.
    await expect(
      page.locator(".vg-thread-node-dynamic", { hasText: "$HOOK_CMD" }).first(),
    ).toBeVisible();
  });
});
