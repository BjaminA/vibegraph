/**
 * "Propose rules from the architecture" (2026-10-19, PLAN-M-RULES M2) on the
 * fleet example, with a stub model whose reply is mixed
 * (test/fixtures/rules/fake_claude_rule_draft.mjs): the estimate spends
 * nothing; the run stores what survives the gate agent-stated, in "Awaiting
 * you", with the facts it rests on and the sentence it was read from; what
 * the gate refused and what had no evidence are shown, never stored; a
 * person's Ratify makes a proposal the project's.
 *
 *   npm run test:e2e-rule-draft
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const FILE = join(process.cwd(), FIXTURE, ".vibegraph", "constraints.json");

test.describe("rules proposed from the architecture", () => {
  test.skip(!FIXTURE.includes("fleet-telemetry") || !(process.env.VG_CLAUDE_BIN ?? "").includes("fake_claude_rule_draft"), "Requires the fleet example and the rule-draft stub (npm run test:e2e-rule-draft)");
  let original = "";
  test.beforeAll(() => { original = readFileSync(FILE, "utf-8"); });
  test.afterAll(() => { writeFileSync(FILE, original); });

  test("estimate, one call, proposals awaiting a person with their evidence, refusals shown, ratify", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
    await page.locator("[data-rules-toggle]").click();
    const sheet = page.locator('[data-panel-sheet="rules"]');
    await expect(sheet).toBeVisible();

    await sheet.locator("[data-rule-draft-ask]").click();
    await expect(sheet.locator("[data-rule-draft-estimate]")).toContainText(/\d+ facts, 1 model call, ~\d+k tokens/, { timeout: 30_000 });
    expect(JSON.parse(readFileSync(FILE, "utf-8")).constraints.length, "the estimate writes nothing").toBe(6);

    await sheet.locator("[data-rule-draft-run]").click();
    await expect(sheet.locator("[data-rule-draft-stored]")).toHaveAttribute("data-rule-draft-stored", "2", { timeout: 60_000 });
    await expect(sheet.locator("[data-rule-draft-refused] summary")).toContainText("3 refused by the gate");
    await sheet.locator("[data-rule-draft-refused] summary").click();
    await expect(sheet.locator("[data-rule-draft-refused]")).toContainText("cites nothing it was shown");
    await expect(sheet.locator("[data-rule-draft-refused]")).toContainText("restates c1");
    await expect(sheet.locator("[data-rule-draft-without] summary")).toContainText("suspected with no fact behind them");

    // in "Awaiting you": agent-stated, dashed, with the facts and the sentence
    const stored = JSON.parse(readFileSync(FILE, "utf-8")).constraints.filter((c: { source: string }) => c.source === "agent");
    expect(stored.map((c: { id: string }) => c.id)).toEqual(["c7", "c8"]);
    await expect(sheet.locator('[data-rules-queue] [data-rule-row="c7"]')).toBeVisible({ timeout: 10_000 });
    const card = sheet.locator('[data-rules-queue] [data-rule-row="c7"]');
    await expect(card).toHaveAttribute("data-item-proposed", "true");
    await expect(card).toContainText("rests on funnel:telemetry.storage");
    await expect(card).toContainText("from README.md:14");

    await card.locator('[data-rule-ratify="c7"]').click();
    await expect.poll(() => JSON.parse(readFileSync(FILE, "utf-8")).constraints.find((c: { id: string }) => c.id === "c7")?.source, { timeout: 10_000 }).toBe("human");
  });
});
