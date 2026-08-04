/**
 * VibeReadme — the whole-project README, and the fact you can READ it.
 *
 * Two problems 2026-08-04:
 *   1. Generated READMEs were reachable only through `title={status.body}`
 *      on a chip — a native tooltip. Truncated, unscrollable, uncopyable,
 *      gone the moment the pointer moved. The feature existed; its output
 *      was effectively invisible.
 *   2. There was no project-scope README at all — only per-thread and
 *      per-file — and the chip carrying them renders only INSIDE a thread.
 *      So "what is this application and how is it organised" had nowhere to
 *      live and nowhere to be shown.
 *
 * Now: a project VibeReadme with a fixed section contract, reachable from
 * the launchpad, rendered in a panel. Stored at .vibegraph/VibeReadme.md —
 * deliberately NOT the repo's README.md, which belongs to whoever wrote it.
 *
 * Uses a stubbed model (VG_CLAUDE_BIN) — the point here is the plumbing and
 * the gate, not the prose.
 *
 * Boot (see package.json test:e2e-vibereadme).
 */
import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_PUMP = FIXTURE.includes("pump-wear");
const VIBEREADME = join(process.cwd(), FIXTURE, ".vibegraph", "VibeReadme.md");

test.use({ viewport: { width: 1500, height: 940 } });

test.describe("VibeReadme", () => {
  test.skip(!IS_PUMP, "Requires VG_FIXTURE=examples/pump-wear");

  test.beforeEach(() => { rmSync(VIBEREADME, { force: true }); });
  test.afterAll(() => { rmSync(VIBEREADME, { force: true }); });

  test("reachable from the launchpad, generated to contract, and readable", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });

    // 1 — an affordance on the launchpad, where you land not knowing what
    // the project is. The per-thread chip strip does not exist here.
    const open = page.locator("[data-vibereadme-open]");
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute("data-vibereadme-state", "none");

    // 2 — the panel opens and explains itself rather than showing blank.
    await open.click();
    const panel = page.locator("[data-readme-panel]");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await expect(panel).toContainText("No VibeReadme yet");
    await expect(panel, "must say it will not touch the repo's own README")
      .toContainText("README.md");

    // 3 — generate, and every contracted section must render.
    await page.locator("[data-readme-refresh]").click();
    await expect(panel).toContainText("What this is", { timeout: 30_000 });
    for (const heading of ["What this is", "How it is organised", "Entry points",
                           "External surface", "Not statically known"]) {
      await expect(panel, `section "${heading}" must render`).toContainText(heading);
    }

    // 4 — READABLE, not a tooltip: real text in the DOM, and the chip no
    // longer smuggles the body into its title attribute.
    const shown = (await panel.innerText()).trim();
    expect(shown.length, "the body must be rendered, not hidden in an attribute")
      .toBeGreaterThan(200);
    await expect(panel).toContainText("Generated");

    // 5 — persisted where a human can find it, and NOT over README.md.
    expect(existsSync(VIBEREADME), ".vibegraph/VibeReadme.md must exist").toBe(true);
    const onDisk = readFileSync(VIBEREADME, "utf-8");
    expect(onDisk).toContain("scope: project");
    expect(onDisk).toContain("## Not statically known");
  });

  test("the launchpad chip reflects state once generated", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
    await page.locator("[data-vibereadme-open]").click();
    await page.locator("[data-readme-refresh]").click();
    await expect(page.locator("[data-readme-panel]")).toContainText("What this is", { timeout: 30_000 });
    await page.locator("[data-readme-close]").click();
    await expect(page.locator("[data-readme-panel]")).toHaveCount(0);
    await expect(page.locator("[data-vibereadme-open]")).toHaveAttribute("data-vibereadme-state", "fresh");
  });
});
