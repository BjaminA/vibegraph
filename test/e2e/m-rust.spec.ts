/**
 * M-RUST (PLAN-M-RUST.md) — the Rust read-only experience in the LIVING
 * renderer:
 *
 *   1. the launchpad lists src/main.rs:main (cli) and the #[test] entries;
 *   2. the main thread paints: cross-file steps into BOTH lib modules
 *      (Cargo convention resolving `use router_demo::…`), the DYNAMIC
 *      trait-object marker — the honesty headline here, since Rust has
 *      no overloading and so no C++-style unresolved gap — and effect
 *      terminals carrying what the table stamped;
 *   3. container chips read like Rust (`for … in …`, `if let`, `match`),
 *      never another language's separator;
 *   4. Monaco holds a `rust` model;
 *   5. NO run affordance — Rust has no run floor; EDIT is on since the
 *      Rust edit floor (2026-09-25; test/e2e/cpp-rust-edit.spec.ts saves);
 *   6. the tooltip on a seed shows editable source; on a container,
 *      read-only source for the container reason.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/rust/router_demo VG_PORT=4283 PORT=4283 \
 *     npx playwright test test/e2e/m-rust.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_ROUTER = FIXTURE.includes("rust/router_demo");
const REVIEW_DIR = join(process.cwd(), "reviews", "m-rust");

test.describe("M-RUST — Rust read-only experience", () => {
  test.skip(!IS_ROUTER, "Requires VG_FIXTURE=test/fixtures/rust/router_demo");

  test("cli+test entries, dynamic trait dispatch, rust Monaco, gated affordances", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto("/");

    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    const row = page.locator('[data-thread-index-row][data-entry-id="src/main.rs:main"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    // A #[test] function is an entry point of its own, found through the
    // attribute the parser stamped rather than by re-reading the source.
    await expect(
      page.locator('[data-thread-index-row][data-entry-id="tests/router_test.rs:routes_to_named_sink"]'),
    ).toBeVisible();

    await row.click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // The honesty headline: `sink.deliver(..)` dispatches on a
    // Box<dyn Sink> with two impls in the fixture, so it is a real
    // runtime question and renders DYNAMIC. Rust has no overloading, so
    // unlike the C++ fixture there is no unresolved marker to find —
    // and nothing should invent one.
    await expect(page.locator(".vg-thread-node-dynamic").first()).toBeVisible();
    await expect(page.locator(".vg-thread-node-external").first()).toBeVisible();
    await expect(page.locator(".vg-thread-node-unresolved")).toHaveCount(0);

    // Cross-file steps: the bin reaches BOTH lib modules by Cargo
    // convention (`use router_demo::router` / `::store`).
    const stepLabels = (await page.locator(".vg-thread-node-step").allTextContents()).join(" ");
    expect(stepLabels).toContain("parse_line");
    expect(stepLabels).toContain("open");

    // Container chips read like Rust: `in` is the separator, and the
    // source's own words survive for if-let and match.
    // The keyword is its own badge (`FOR`), so the label beside it is
    // what carries the language's own separator.
    const viewText = (await page.locator("[data-thread-view]").textContent()) ?? "";
    expect(viewText).toContain("line in store.raw.lines()");
    expect(viewText).toContain("let Some((key, value)) = parse_line(line)");
    expect(viewText).toContain("match ");
    // Never another language's for-each separator.
    expect(viewText).not.toContain("line of store");
    expect(viewText).not.toContain("line : store");

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "rust-thread.png"), fullPage: false });

    // The hover tooltip on the seed: its source, EDITABLE since the Rust edit
    // floor (2026-09-25: rewrite_rust.mjs) — no read-only note, a Save — and
    // never the "no source" placeholder.
    await page.locator(".vg-thread-node-seed").first().hover();
    const tip = page.locator("[data-thread-tooltip]");
    await expect(tip).toBeVisible({ timeout: 5_000 });
    await expect(tip.locator(".monaco-editor")).toBeVisible({ timeout: 10_000 });
    await expect(tip.locator("[data-readonly-language]")).toHaveCount(0);
    await expect(tip.locator("button[title^='Save edits']")).toHaveCount(1);
    expect((await tip.textContent()) ?? "").not.toContain("No source available");
    await page.mouse.move(5, 5);
    await page.waitForTimeout(700);

    // A CONTAINER shows its own source, read-only for a reason of its
    // own. The chip is the hover target and the event is dispatched ON
    // it — at any zoom where the thread is wider than the viewport the
    // nodes overlap and a coordinate hover lands on whatever is on top.
    const chipCount = await page.locator("[data-container-chip]").count();
    expect(chipCount).toBeGreaterThan(0);
    const chipText = await page.evaluate(() => {
      const el = document.querySelector("[data-container-chip]") as HTMLElement;
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return (el.textContent ?? "").replace(/\s+/g, " ").trim();
    });
    await expect(tip).toBeVisible({ timeout: 5_000 });
    await expect(tip.locator(".monaco-editor")).toBeVisible({ timeout: 10_000 });
    await expect(tip.locator("[data-readonly-language]"))
      .toHaveAttribute("data-readonly-reason", "container");
    await expect(tip.locator("button[title^='Save edits']")).toHaveCount(0);
    // The snippet is THIS container's own source. Assert on the chip's
    // LABEL rather than its keyword badge: the badge is the IR container
    // KIND, and a Rust `match` is an if-family container by the plan's
    // named limit, so its badge reads IF while its source says `match`.
    // The label is the source's own words either way, which is the
    // property worth pinning.
    const chipLabel = chipText.replace(/^(IF|ELSE|FOR|WHILE|TRY|EXCEPT|FINALLY|LISTCOMP|SETCOMP|DICTCOMP|GENEXP)\s+/i, "");
    const firstLine = (await tip.locator(".monaco-editor .view-line").allTextContents())
      .find((l) => l.trim())?.trim() ?? "";
    expect(firstLine.replace(/\s+/g, " ")).toContain(chipLabel.replace(/\s+/g, " "));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(700);

    // A cross-file step opens its own file, in a `rust` Monaco model,
    // with no edit affordance anywhere.
    await page.locator(".vg-thread-node-step", { hasText: "parse_line" }).first().click();
    await page.waitForTimeout(900);
    const langs = await page.evaluate(() =>
      (window as unknown as { monaco?: { editor: { getModels(): { getLanguageId(): string }[] } } })
        .monaco?.editor.getModels().map((m) => m.getLanguageId()) ?? []);
    expect(langs, `Monaco models: ${JSON.stringify(langs)}`).toContain("rust");
    expect(langs).not.toContain("python");

    await page.screenshot({ path: join(REVIEW_DIR, "rust-step-source.png"), fullPage: false });
    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
