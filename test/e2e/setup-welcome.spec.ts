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

  test("the first step, Claude's, is offered as a run that lists its call first; cancelling spends nothing", async ({ page }) => {
    // 2026-10-21 — it used to "go to" the Plan panel, where nothing could
    // classify a package or draft a spec. The run is not confirmed here: it
    // would read the package's docs page from the network.
    await page.goto("/");
    const guide = page.locator("[data-setup-guide='welcome']");
    await expect(guide).toBeVisible({ timeout: 30_000 });
    await expect(guide.locator("[data-setup-start]")).toHaveCount(0);
    await guide.locator("[data-setup-run-next]").click();
    const confirm = guide.locator("[data-setup-confirm='software']");
    await expect(confirm.locator("[data-setup-action='software:openai']")).toContainText("Write a spec for openai from https://");
    await expect(confirm).toContainText("1 model call");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(guide.locator("[data-setup-run-result]")).toHaveCount(0);
    // closed = set aside: not offered again
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-setup-guide]")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("[data-now-setup]")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await expect(page.locator("[data-setup-guide]")).toHaveCount(0);
  });

  test("a step Claude takes is run from the guide; Run all lists every call first and ends saying what waits", async ({ page }) => {
    // the software step set aside, so the next step is the groups (a model
    // call); the stub model answers nothing (fake_claude_silent.mjs): the model
    // steps fail with their reason, the census (no model call) runs for real
    const vg = join(process.cwd(), FIXTURE, ".vibegraph");
    const hadDir = existsSync(vg);
    mkdirSync(vg, { recursive: true });
    writeFileSync(join(vg, "setup.json"), JSON.stringify({ version: "1", software: { openai: { why: "used in the ordinary way", at: "2026-10-21T10:00:00.000Z" } }, steps: {} }) + "\n");
    try {
      await page.goto("/");
      await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
      await page.locator("[data-now-setup]").click();
      const guide = page.locator("[data-setup-guide='progress']");
      // the next step is Claude's: it is RUN here, never sent to a panel with nothing to press
      await expect(guide.locator("[data-setup-run-next]")).toBeVisible();
      await expect(guide.locator("[data-setup-start]")).toHaveCount(0);
      await guide.locator("[data-setup-run-all]").click();
      const confirm = guide.locator("[data-setup-confirm='all']");
      expect(await confirm.locator("[data-setup-action]").evaluateAll((els) => els.map((e) => e.getAttribute("data-setup-action"))))
        .toEqual(["groups", "rules", "census"]);
      await expect(confirm).toContainText("2 model calls");
      await confirm.locator("[data-setup-run-confirm]").click();
      const result = guide.locator("[data-setup-run-result='done']");
      await expect(result).toBeVisible({ timeout: 60_000 });
      await expect(result).toContainText("Read the direction the code already takes");
      await expect(result).toContainText("Propose the architecture groups");
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
      await expect(guide.locator("[data-setup-start]")).toContainText("Go to the next step");
      await guide.locator("[data-setup-start]").click();
      await expect(page.locator("[data-brief-toggle]")).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
    } finally {
      if (hadDir) for (const f of [skips, arch]) rmSync(f, { force: true });
      else rmSync(dirname(skips), { recursive: true, force: true });
    }
  });
});
