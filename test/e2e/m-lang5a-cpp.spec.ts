/**
 * M-LANG5a (PLAN-M-LANG.md) — the C++ read-only experience in the
 * LIVING renderer:
 *
 *   1. the launchpad lists main.cpp:main (cli) and the gtest entry;
 *   2. the main thread paints: cross-file step into geometry.cpp,
 *      the UNRESOLVED overload marker for `scale` (the honesty
 *      headline — distinct from dynamic), dynamic template/receiver
 *      markers, effect terminals;
 *   3. Monaco holds a `cpp` model;
 *   4. NO run/edit affordances — C++ has no edit/run floor.
 *   5. the hover tooltip on a C++ seed shows its SOURCE read-only
 *      (Monaco + the read-only note, no Save): a node with a file and
 *      an IR id has source whatever its language — only the Save floor
 *      is capability-gated. It used to say "No source available".
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/cpp/geometry_demo VG_PORT=4274 PORT=4274 \
 *     npx playwright test test/e2e/m-lang5a-cpp.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_GEO = FIXTURE.includes("cpp/geometry_demo");
const REVIEW_DIR = join(process.cwd(), "reviews", "m-lang5a-cpp");

test.describe("M-LANG5a — C++ read-only experience", () => {
  test.skip(!IS_GEO, "Requires VG_FIXTURE=test/fixtures/cpp/geometry_demo");

  test("cli+gtest entries, overload-unresolved marker, cpp Monaco, gated affordances", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");

    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    const row = page.locator('[data-thread-index-row][data-entry-id="main.cpp:main"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-thread-index-row][data-entry-id="geometry_test.cpp:GeometrySuite.AreaOfUnitCircle"]'),
    ).toBeVisible();

    await row.click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // The honesty headline: the overloaded `scale` renders as the
    // DISTINCT unresolved (resolution-gap) marker — present here,
    // unlike the bash/jsts fixtures where unresolved must be absent.
    await expect(page.locator(".vg-thread-node-unresolved").first()).toBeVisible();
    await expect(page.locator(".vg-thread-node-dynamic").first()).toBeVisible();
    await expect(page.locator(".vg-thread-node-external").first()).toBeVisible();

    const stepLabels = await page.locator(".vg-thread-node-step").allTextContents();
    expect(stepLabels.join(" ")).toContain("area_sum");

    // M-LANG QA — a classic C for reads as C, not Python ("for … in …").
    const viewText = (await page.locator("[data-thread-view]").textContent()) ?? "";
    expect(viewText).toContain("int i = 0; i < count; i++");
    expect(viewText).not.toContain("in i < count");

    // The hover tooltip on the seed: source read-only, no Save, and never
    // the "no source" placeholder — that copy is for nodes WITHOUT source.
    await page.locator(".vg-thread-node-seed").first().hover();
    const tip = page.locator("[data-thread-tooltip]");
    await expect(tip).toBeVisible({ timeout: 5_000 });
    await expect(tip.locator(".monaco-editor")).toBeVisible({ timeout: 10_000 });
    await expect(tip.locator("[data-readonly-language]")).toBeVisible();
    await expect(tip.locator("[data-readonly-language]")).toHaveAttribute("data-readonly-reason", "language");
    await expect(tip.locator("button[title^='Save edits']")).toHaveCount(0);
    expect((await tip.textContent()) ?? "").not.toContain("No source available");
    await page.mouse.move(5, 5);
    await page.waitForTimeout(700);

    // A CONTAINER shows its own source, read-only for a reason of its own.
    // Every `for`/`if`/`while`/`try` carried a file and an IR node id and
    // responded to nothing — a third of a thread's elements, in every
    // language. The chip is the hover target, and the event is dispatched
    // ON it: at any zoom where the thread is wider than the viewport the
    // nodes overlap, so a coordinate hover lands on whatever is on top.
    const chipCount = await page.locator("[data-container-chip]").count();
    expect(chipCount).toBeGreaterThan(0);
    const chipText = await page.evaluate(() => {
      const el = document.querySelector("[data-container-chip]") as HTMLElement;
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return (el.textContent ?? "").replace(/\s+/g, " ").trim();
    });
    await expect(tip).toBeVisible({ timeout: 5_000 });
    await expect(tip.locator(".monaco-editor")).toBeVisible({ timeout: 10_000 });
    // Read-only because it is a BLOCK, not because C++ has no edit floor —
    // the distinction matters: on Python the language reason would be false.
    await expect(tip.locator("[data-readonly-language]")).toHaveAttribute("data-readonly-reason", "container");
    await expect(tip.locator("button[title^='Save edits']")).toHaveCount(0);
    // The snippet is THIS container's own source: the chip's keyword opens
    // the block the snippet starts with.
    const firstLine = (await tip.locator(".monaco-editor .view-line").allTextContents())
      .find((l) => l.trim())?.trim() ?? "";
    const keyword = chipText.split(/\s+/)[0].toLowerCase();
    expect(firstLine.toLowerCase()).toContain(keyword === "except" ? "catch" : keyword);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(700);

    await page.locator(".vg-thread-node-step", { hasText: "area_sum" }).first().click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-run-to-here]")).toHaveCount(0);

    await page.waitForSelector(".monaco-editor", { timeout: 10_000 });
    const languages = await page.evaluate(() => {
      const m = (window as any).monaco;
      if (!m?.editor) return [];
      return m.editor.getModels().map((mod: any) => mod.getLanguageId());
    });
    expect(languages).toContain("cpp");
    expect(languages).not.toContain("python");

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "cpp-thread.png"), fullPage: true });

    expect(pageErrors).toEqual([]);
  });
});
