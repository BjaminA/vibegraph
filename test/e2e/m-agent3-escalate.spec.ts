/**
 * M-AGENT3 — the LIVE escalation path: with FAKE_WORKER_MODE=escalate
 * every worker stops at its boundary; the board shows amber escalation
 * cards with the reason while the run continues over independent
 * packets, and resolving them all lands the honest outcome.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4284 PORT=4284 \
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/work_run/fake_worker.mjs" \
 *   FAKE_WORKER_MODE=escalate FAKE_ESCALATE_REASON="needs the billing service" \
 *     npx playwright test test/e2e/m-agent3-escalate.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_ESC = FIXTURE.includes("flask_demo") && process.env.FAKE_WORKER_MODE === "escalate";
const RUN_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "work-run.json");

test.describe("M-AGENT3 — live escalation", () => {
  test.skip(!IS_ESC, "Requires flask_demo + FAKE_WORKER_MODE=escalate");
  test.afterAll(() => rmSync(RUN_FILE, { force: true }));

  test("workers escalate with the reason; resolving them ends the run honestly", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click("[data-work-run-toggle]");
    await page.fill("[data-work-run-task]", "tidy `list_users` bookkeeping in models.py");
    await page.click("[data-work-run-start]");
    await expect(page.locator("[data-work-run-gate]")).toBeVisible({ timeout: 10_000 });
    await page.click("[data-work-run-ratify]");

    // Escalations arrive LIVE (running → escalated), reason attached.
    const esc = page.locator("[data-packet-escalation]");
    await expect(esc.first()).toBeVisible({ timeout: 30_000 });
    await expect(esc.first()).toContainText("needs the billing service");

    // Resolve every escalation as failed; the run must end failed —
    // never "done" out of a pile of escalations.
    for (let guard = 0; guard < 20; guard++) {
      const status = await page.locator("[data-work-run-panel]").getAttribute("data-run-status");
      if (status === "done" || status === "failed") break;
      const btn = page.locator("[data-escalation-fail]").first();
      try {
        await btn.waitFor({ state: "visible", timeout: 15_000 });
        await btn.click();
      } catch { /* waiting for the next packet */ }
      await page.waitForTimeout(300);
    }
    await expect(page.locator("[data-work-run-panel]"))
      .toHaveAttribute("data-run-status", "failed", { timeout: 30_000 });
  });
});
