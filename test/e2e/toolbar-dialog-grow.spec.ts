/**
 * Top-bar dialogs grow with their content (2026-08-04).
 *
 * All three clipped differently: Describe was a fixed `rows={3}` textarea that
 * scrolled internally past three lines, while Draft and Build were single-line
 * <input>s that could not wrap at all. The Describe brief for a greenfield
 * build runs to a dozen lines, so the field you paste it into showed three.
 *
 * What is pinned here:
 *   1. the field grows as lines are added,
 *   2. the dialog grows with it,
 *   3. growth is BOUNDED — the submit button stays inside the viewport and
 *      clickable, which is the reason the cap exists at all.
 *
 * Boot (see package.json test:e2e-dialog-grow):
 *   VG_FIXTURE=test/fixtures/greenfield_blank VG_PORT=4262 PORT=4262 \
 *     npx playwright test test/e2e/toolbar-dialog-grow.spec.ts --reporter=list --workers=1
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BLANK = FIXTURE.includes("greenfield_blank");

const ONE_LINE = "a flask API over a sqlite store";
const MANY_LINES = Array.from({ length: 14 }, (_, i) => `line ${i + 1}: a subsystem worth describing`).join("\n");

const ROOT = join(process.cwd(), FIXTURE);
// Build only mounts once a system plan is ratified (App.tsx: `buildAvailable`),
// so the blank fixture needs one seeded — same shape plan-v7-4b uses.
const PLAN = {
  version: "1",
  description: "a flask API with a sqlite note store",
  subsystems: [
    { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
    { id: "db", kind: "db", label: "SQLite note store", groundedIn: "a sqlite note store" },
  ],
  edges: [{ from: "backend", to: "db", groundedIn: "a sqlite note store" }],
  drafted: false,
  ratifiedAt: "2026-07-02T00:00:00.000Z",
};

async function boxHeight(loc: Locator): Promise<number> {
  const b = await loc.boundingBox();
  if (!b) throw new Error("element has no box");
  return b.height;
}

/** Type into a field without Playwright's fill() (which sets value in one go —
 *  we want the same per-keystroke path a user drives). */
async function typeMultiline(page: Page, selector: string, text: string) {
  await page.locator(selector).click();
  // Shift+Enter for newlines: plain Enter submits in all three dialogs.
  for (const [i, line] of text.split("\n").entries()) {
    if (i > 0) await page.keyboard.press("Shift+Enter");
    await page.keyboard.type(line, { delay: 0 });
  }
}

test.describe("top-bar dialogs grow with their content", () => {
  test.skip(!IS_BLANK, "Requires VG_FIXTURE=test/fixtures/greenfield_blank");

  test.beforeAll(() => {
    if (!IS_BLANK) return;
    mkdirSync(join(ROOT, ".vibegraph"), { recursive: true });
    writeFileSync(join(ROOT, ".vibegraph", "system-plan.json"), JSON.stringify(PLAN, null, 2));
  });
  test.afterAll(() => {
    // The blank fixture is just a .gitkeep — the plan is ours, so remove it.
    if (IS_BLANK && existsSync(join(ROOT, ".vibegraph"))) {
      rmSync(join(ROOT, ".vibegraph"), { recursive: true, force: true });
    }
  });

  for (const d of [
    { name: "Describe", button: "Describe", bar: "[data-describe-bar]", field: "[data-describe-text]", submit: "[data-describe-submit]" },
    { name: "Build", button: "Build", bar: "[data-build-bar]", field: "[data-build-intent]", submit: "[data-build-submit]" },
    { name: "Draft", button: "Draft", bar: "[data-draft-bar]", field: "[data-draft-intent]", submit: "[data-draft-submit]" },
  ]) {
    test(`${d.name}: field and dialog grow, submit stays reachable`, async ({ page }) => {
      await page.goto("/");
      const opener = page.locator(`button:has-text("${d.button}")`).first();
      await expect(opener).toBeVisible({ timeout: 15_000 });
      await opener.click();

      const bar = page.locator(d.bar);
      const field = page.locator(d.field);
      await expect(bar).toBeVisible({ timeout: 5_000 });
      await expect(field).toBeVisible();

      // A single line establishes the baseline.
      await typeMultiline(page, d.field, ONE_LINE);
      const fieldBefore = await boxHeight(field);
      const barBefore = await boxHeight(bar);

      // Now a brief that overflows the old fixed bounds.
      await field.fill("");
      await typeMultiline(page, d.field, MANY_LINES);
      await page.waitForTimeout(150); // let the layout effect settle

      const fieldAfter = await boxHeight(field);
      const barAfter = await boxHeight(bar);

      expect(fieldAfter, `${d.name} field must grow past its one-line height`).toBeGreaterThan(fieldBefore);
      expect(barAfter, `${d.name} dialog must grow with its field`).toBeGreaterThan(barBefore);

      // Bounded: the cap is what keeps the action row on screen. Without it
      // the dialog runs off the bottom and Submit becomes unclickable.
      const viewport = page.viewportSize();
      const barBox = await bar.boundingBox();
      expect(barBox!.y + barBox!.height,
        `${d.name} dialog must stay within the viewport`).toBeLessThanOrEqual(viewport!.height + 1);

      // The operation, not just the geometry — Playwright refuses to click an
      // element that is off-screen or covered.
      const submit = page.locator(d.submit);
      await expect(submit).toBeVisible();
      await expect(submit).toBeInViewport();
    });
  }

  test("Enter submits, Shift+Enter inserts a newline", async ({ page }) => {
    await page.goto("/");
    const opener = page.locator('button:has-text("Describe")').first();
    await expect(opener).toBeVisible({ timeout: 15_000 });
    await opener.click();
    await expect(page.locator("[data-describe-bar]")).toBeVisible({ timeout: 5_000 });

    // Shift+Enter must NOT submit — the bar stays open and the value grows a line.
    await typeMultiline(page, "[data-describe-text]", "first\nsecond");
    await expect(page.locator("[data-describe-bar]")).toBeVisible();
    expect(await page.locator("[data-describe-text]").inputValue()).toBe("first\nsecond");
  });
});
