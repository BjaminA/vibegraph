/**
 * The setup offered to a new project (2026-10-21, src/server/setup_welcome.ts
 * + src/webview/setup/SetupGuide.tsx): pointed at a project where nothing of
 * the setup has started, the app opens a guide listing every step in order and
 * offers to start; "Not now" sets the offer aside for good (kept per person,
 * under the cache); the sidebar's setup line opens the guide again; starting
 * goes to where the next step is decided.
 *
 *   npm run test:e2e-setup-welcome
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const CACHE = process.env.VG_CACHE_DIR ?? "";
const clearDismissal = () => {
  if (!CACHE || !existsSync(CACHE)) return;
  for (const d of readdirSync(CACHE)) rmSync(join(CACHE, d, "welcome.json"), { force: true });
};

test.describe("setup welcome", () => {
  test.skip(!FIXTURE.includes("thread_rank/route_demo") || process.env.VG_WELCOME !== "on",
    "Requires VG_FIXTURE=test/fixtures/thread_rank/route_demo and VG_WELCOME=on");
  test.beforeEach(clearDismissal);
  test.afterAll(clearDismissal);

  test("installed hooks do not hide the offer (a project started again with its hooks kept)", async ({ page }) => {
    const settings = join(process.cwd(), FIXTURE, ".claude", "settings.local.json");
    const hadDir = existsSync(dirname(settings));
    mkdirSync(dirname(settings), { recursive: true });
    writeFileSync(settings, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "vgk hook prompt --vg-hook" }] }] } }) + "\n");
    try {
      await page.goto("/");
      await expect(page.locator("[data-setup-guide='welcome']")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("[data-setup-step='hooks']")).not.toHaveAttribute("data-setup-status", "todo");
    } finally {
      rmSync(hadDir ? settings : dirname(settings), { recursive: true, force: true });
    }
  });

  test("a new project is offered the setup; Not now sets it aside; the sidebar opens it again", async ({ page }) => {
    await page.goto("/");
    const guide = page.locator("[data-setup-guide]");
    await expect(guide).toHaveAttribute("data-setup-guide", "welcome", { timeout: 30_000 });
    await expect(guide).toContainText("Set up VibeGraph for this project");
    await expect(guide.locator("[data-setup-step]")).toHaveCount(7);
    expect(await guide.locator("[data-setup-step]").evaluateAll((els) => els.map((e) => e.getAttribute("data-setup-step"))))
      .toEqual(["software", "groups", "brief", "rules", "direction", "hooks", "plan"]);
    // the plan follows the setup, under its own line, and waits for nothing
    await expect(guide.locator("[data-setup-after]")).toBeVisible();
    await expect(guide.locator("[data-setup-step='plan']")).toHaveAttribute("data-setup-status", "optional");
    await expect(guide.locator("[data-setup-step='brief'] [data-setup-spends]")).toContainText("asks Claude");
    // the same steps from Claude Code: the skill, then the command that walks them
    await guide.locator("[data-setup-claude-code-toggle]").click();
    await expect(guide.locator("[data-setup-claude-code]")).toContainText("npx vibegraph-knowledge init --skill");
    await expect(guide.locator("[data-setup-claude-code]")).toContainText("/vibegraph-setup");
    await guide.locator("[data-setup-not-now]").click();
    await expect(guide).toHaveCount(0);

    // set aside for good: a reload does not offer it again
    await page.reload();
    const line = page.locator("[data-now-setup]");
    await expect(line).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await expect(guide).toHaveCount(0);

    // the sidebar's setup line opens the guide, with the progress wording
    await line.click();
    await expect(guide).toHaveAttribute("data-setup-guide", "progress");
    await page.keyboard.press("Escape");
    await expect(guide).toHaveCount(0);
  });

  test("Start the setup goes to where the next step is decided", async ({ page }) => {
    await page.goto("/");
    const guide = page.locator("[data-setup-guide='welcome']");
    await expect(guide).toBeVisible({ timeout: 30_000 });
    const next = await guide.locator("[data-setup-status='todo'], [data-setup-status='waiting']").first().getAttribute("data-setup-step");
    await guide.locator("[data-setup-start]").click();
    await expect(page.locator("[data-setup-guide]")).toHaveCount(0);
    if (next === "groups" || next === "brief") {
      // decided on the map: the view switches and the Brief card opens, though
      // the map was not mounted when it was asked for (tasks/guiTasks.ts requestMapOpen)
      await expect(page.locator("[data-brief-toggle]")).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
    } else {
      await expect(page.locator("[data-panel-sheet]")).toBeVisible();
    }
    // started = set aside: not offered again
    await page.reload();
    await expect(page.locator("[data-now-setup]")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await expect(page.locator("[data-setup-guide]")).toHaveCount(0);
  });

  test("a step decided on the map opens the map and its Brief card from another view", async ({ page }) => {
    // the software step set aside (as `setup skip software` writes it), so the
    // next step is the groups, decided on the Brief card; the app opens on the
    // thread index, where the map is not mounted when the step is asked for
    const skips = join(process.cwd(), FIXTURE, ".vibegraph", "setup.json");
    const hadDir = existsSync(dirname(skips));
    mkdirSync(dirname(skips), { recursive: true });
    writeFileSync(skips, JSON.stringify({ version: "1", software: { openai: { why: "used in the ordinary way", at: "2026-10-21T10:00:00.000Z" } }, steps: {} }) + "\n");
    try {
      await page.goto("/");
      await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
      await page.waitForTimeout(500);
      await expect(page.locator("[data-setup-guide]")).toHaveCount(0); // a setup file: not a new project
      await page.locator("[data-now-setup]").click();
      const guide = page.locator("[data-setup-guide='progress']");
      await expect(guide.locator("[data-setup-step='software']")).toHaveAttribute("data-setup-status", "done");
      await expect(guide.locator("[data-setup-start]")).toContainText("Go to the next step");
      await guide.locator("[data-setup-start]").click();
      await expect(page.locator("[data-brief-toggle]")).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
    } finally {
      rmSync(hadDir ? skips : dirname(skips), { recursive: true, force: true });
    }
  });
});
