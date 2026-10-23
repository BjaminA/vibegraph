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

  test("every step Claude can run starts selected; a chip takes one out and puts it back; Run says what it will run", async ({ page }) => {
    // 2026-10-22 (Ben: "select all tasks aside from the plan … deselect or
    // reselect by clicking the highlighted chip … one simple run button").
    // Nothing is run here: the software step would read its docs from the network.
    await page.goto("/");
    const guide = page.locator("[data-setup-guide='welcome']");
    await expect(guide).toBeVisible({ timeout: 30_000 });
    const sw = guide.locator("[data-setup-step='software']");
    await expect(sw.locator("[data-setup-select='software']")).toHaveAttribute("aria-pressed", "true");
    await expect(sw.locator("[data-setup-action='software:openai']")).toContainText("Write a spec for openai from https://");
    await expect(guide.locator("[data-setup-step='plan'] [data-setup-select]")).toHaveCount(0); // the plan is not in the run
    await expect(guide.locator("[data-setup-step='hooks'] [data-setup-select]")).toHaveCount(0); // a person's step, from a terminal
    const runBtn = guide.locator("[data-setup-run]");
    const before = await runBtn.textContent();
    await sw.locator("[data-setup-select='software']").click();
    await expect(sw.locator("[data-setup-select='software']")).toHaveAttribute("aria-pressed", "false");
    await expect(sw.locator("[data-setup-step-actions]")).toHaveCount(0);
    await expect(runBtn).not.toHaveText(before ?? "");
    await sw.locator("[data-setup-select='software']").click();
    await expect(sw.locator("[data-setup-select='software']")).toHaveAttribute("aria-pressed", "true");
    await expect(runBtn).toHaveText(before ?? "");
    await expect(guide.locator("[data-setup-run-result]")).toHaveCount(0);
    // closed = set aside: not offered again
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-setup-guide]")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("[data-now-setup]")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await expect(page.locator("[data-setup-guide]")).toHaveCount(0);
  });

  test("Run takes the selected steps one at a time, in order, and ends saying what waits", async ({ page }) => {
    // the software step set aside; the stub model answers nothing
    // (fake_claude_silent.mjs): the check before the run fails, so the groups
    // are held back with the reason (RC6), the census (no model call) runs for
    // real, and the rules, left out, never run
    const vg = join(process.cwd(), FIXTURE, ".vibegraph");
    const hadDir = existsSync(vg);
    mkdirSync(vg, { recursive: true });
    writeFileSync(join(vg, "setup.json"), JSON.stringify({ version: "1", software: { openai: { why: "used in the ordinary way", at: "2026-10-21T10:00:00.000Z" } }, steps: {} }) + "\n");
    try {
      await page.goto("/");
      await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
      await page.locator("[data-now-setup]").click();
      const guide = page.locator("[data-setup-guide='progress']");
      for (const s of ["groups", "rules", "direction"]) await expect(guide.locator(`[data-setup-select='${s}']`)).toHaveAttribute("aria-pressed", "true");
      await expect(guide.locator("[data-setup-run]")).toHaveText("Run 3 steps · 2 model calls");
      await guide.locator("[data-setup-select='rules']").click();
      await expect(guide.locator("[data-setup-run]")).toHaveText("Run 2 steps · 1 model call");
      await guide.locator("[data-setup-run]").click();
      const result = guide.locator("[data-setup-run-result='done']");
      await expect(result).toBeVisible({ timeout: 60_000 });
      await expect(result).toContainText("Read the direction the code already takes");
      await expect(result).toContainText("Propose the architecture groups");
      await expect(result).not.toContainText("Propose rules from the architecture");
      await expect(result).toContainText("init --hooks");
      await expect(guide.locator("[data-setup-step='direction']")).not.toHaveAttribute("data-setup-status", "optional");
    } finally {
      for (const f of ["setup.json", "direction.json"]) rmSync(join(vg, f), { force: true });
      if (!hadDir) rmSync(vg, { recursive: true, force: true });
    }
  });

  test("a step decided on the map opens the map and its Brief card from another view", async ({ page }) => {
    // the software step set aside (as `setup skip software` writes it) and a
    // groups proposal pending, so the next step is a person's decision on the
    // Brief card; the app opens on the thread index, where the map is not
    // mounted when the step is asked for
    const skips = join(process.cwd(), FIXTURE, ".vibegraph", "setup.json");
    const arch = join(dirname(skips), "architecture.json");
    const hadDir = existsSync(dirname(skips));
    mkdirSync(dirname(skips), { recursive: true });
    writeFileSync(skips, JSON.stringify({ version: "1", software: { openai: { why: "used in the ordinary way", at: "2026-10-21T10:00:00.000Z" } }, steps: {} }) + "\n");
    writeFileSync(arch, JSON.stringify({ version: "1", groups: [], names: {}, proposal: { at: "2026-10-21T10:00:00.000Z", model: "test", groups: [] } }) + "\n");
    try {
      await page.goto("/");
      await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
      await page.waitForTimeout(500);
      await expect(page.locator("[data-setup-guide]")).toHaveCount(0); // a setup file: not a new project
      await page.locator("[data-now-setup]").click();
      const guide = page.locator("[data-setup-guide='progress']");
      await expect(guide.locator("[data-setup-step='software']")).toHaveAttribute("data-setup-status", "done");
      await expect(guide.locator("[data-setup-step='groups']")).toHaveAttribute("data-setup-status", "waiting");
      // a step that waits for the person opens from its status chip
      await guide.locator("[data-setup-go='groups']").click();
      await expect(page.locator("[data-brief-toggle]")).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
    } finally {
      if (hadDir) for (const f of [skips, arch]) rmSync(f, { force: true });
      else rmSync(dirname(skips), { recursive: true, force: true });
    }
  });
});
