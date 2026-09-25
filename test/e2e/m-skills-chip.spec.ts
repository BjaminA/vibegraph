/**
 * M-SKILLS.3 — the chat chip says which generic skills rode the turn.
 *
 * Boot (package.json test:e2e-skills-chip):
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4294 PORT=4294
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/chat/fake_claude_stdio.mjs"
 *   FAKE_PROMPT_LOG=/tmp/vg-skills-chip-prompts.log
 *
 * ONE page, three turns on one persistent chat session, because the
 * dedup ("already shared earlier in this session") is per session and a
 * new page is a new session:
 *   1. with boundary-integrity enabled through the panel, a question that
 *      routes to another thread shows the routed line AND a generic line
 *      saying the skill was shared — and the prompt the stub received
 *      carries the skill's provenance line;
 *   2. the next turn's chip says the skill was already shared this session
 *      (the body did not ride twice — the prompt log has it once);
 *   3. a question about the OPEN thread routes nothing, yet the chip still
 *      appears with the self-match report and the generic line: the one
 *      send M-SKILLS.3 unified. Before it, a generic skill shared on a
 *      turn that routed nothing was invisible.
 * With nothing enabled the chip is unchanged (test:e2e-skill pins that).
 */
import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const STUBBED = (process.env.VG_CLAUDE_BIN ?? "").includes("fake_claude_stdio");
const PROMPT_LOG = process.env.FAKE_PROMPT_LOG ?? "";
const SKILLS_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "skills.json");

test.describe("M-SKILLS.3 — the chat chip names the generic direction that rode the turn", () => {
  test.skip(!IS_FLASK || !STUBBED || !PROMPT_LOG, "Requires flask_demo + fake_claude_stdio stub + FAKE_PROMPT_LOG");
  test.beforeAll(() => {
    rmSync(PROMPT_LOG, { force: true });
  });
  test.afterAll(() => {
    rmSync(SKILLS_FILE, { force: true });
    rmSync(PROMPT_LOG, { force: true });
  });

  test("shared, already shared, and shared on a turn that routed nothing", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // Enable ONE skill through the panel (the human act; server-echoed).
    await page.click("[data-skills-toggle]");
    const row = page.locator('[data-skills-panel] [data-skill-row="boundary-integrity"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await page.click('[data-skill-toggle="boundary-integrity"]');
    await expect(row).toHaveAttribute("data-skill-enabled", "true", { timeout: 10_000 });
    await page.keyboard.press("Escape");

    // Open a thread, so the turn has an active entry point (the generic
    // selection keys on it) and the self-match path (turn 3) is reachable.
    await page.click('[data-thread-index-row][data-entry-id="app.py:create_user_route"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.click('button[title^="Open Claude chat"]');
    const input = page.locator("[data-chat-panel] textarea");
    await expect(input).toBeVisible({ timeout: 5_000 });

    // Turn 1 — routes to the db thread; the generic skill rides, and says so.
    await input.fill("why does `db.query` sometimes fail?");
    await input.press("Enter");
    const chips = page.locator("[data-chat-routed]");
    await expect(chips).toHaveCount(1, { timeout: 15_000 });
    await expect(chips.nth(0)).toContainText("db:query");
    const g1 = chips.nth(0).locator('[data-chat-routed-generic="boundary-integrity"]');
    await expect(g1).toHaveAttribute("data-generic-injected", "true");
    await expect(g1).toContainText("generic direction: boundary-integrity was shared with the agent");
    await expect
      .poll(() => (existsSync(PROMPT_LOG) ? readFileSync(PROMPT_LOG, "utf-8") : ""), { timeout: 10_000 })
      .toContain("[generic skill boundary-integrity v");
    await expect(page.locator("[data-chat-panel] textarea")).toBeEnabled({ timeout: 15_000 });

    // Turn 2 — same session: the chip says it was already shared, and the
    // body did not ride again (one provenance line in the whole log).
    await input.fill("and what about `db.query` under load?");
    await input.press("Enter");
    await expect(chips).toHaveCount(2, { timeout: 15_000 });
    const g2 = chips.nth(1).locator('[data-chat-routed-generic="boundary-integrity"]');
    await expect(g2).toHaveAttribute("data-generic-injected", "false");
    await expect(g2).toContainText("already shared earlier in this session");
    await expect(page.locator("[data-chat-panel] textarea")).toBeEnabled({ timeout: 15_000 });
    const log = readFileSync(PROMPT_LOG, "utf-8");
    expect(log.split("[generic skill boundary-integrity v").length - 1).toBe(1);

    // Turn 3 — about the OPEN thread: nothing routed, yet the chip appears
    // with the self-match report and the generic line, from the one send.
    await input.fill("what does `create_user_route` validate?");
    await input.press("Enter");
    await expect(chips).toHaveCount(3, { timeout: 15_000 });
    await expect(chips.nth(2).locator("[data-chat-routed-self]")).toContainText("already in context");
    await expect(chips.nth(2).locator('[data-chat-routed-generic="boundary-integrity"]')).toContainText("already shared earlier in this session");
    // No other skill was enabled, so no other generic line exists anywhere.
    await expect(page.locator("[data-chat-routed-generic]:not([data-chat-routed-generic='boundary-integrity'])")).toHaveCount(0);
  });
});
