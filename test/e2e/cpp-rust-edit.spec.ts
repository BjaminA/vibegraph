/**
 * The C++ and Rust edit floors (2026-09-25), end-to-end in the living
 * renderer — the M-LANG5b pattern: open the cli thread → click the seed →
 * the editor opens EDITABLE (no read-only note, Save present) → type a marker
 * inside the function → Save → replace_function_body routes through
 * rewrite_cpp.mjs / rewrite_rust.mjs → the file on disk differs from the
 * original by the marker line ONLY (indentation included) → no save error.
 * The fixture is snapshotted and restored.
 *
 * Boot (one fixture per run):
 *   VG_FIXTURE=test/fixtures/cpp/geometry_demo VG_PORT=4291 PORT=4291 npx playwright test test/e2e/cpp-rust-edit.spec.ts --workers=1
 *   VG_FIXTURE=test/fixtures/rust/router_demo  VG_PORT=4292 PORT=4292 npx playwright test test/e2e/cpp-rust-edit.spec.ts --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const CASES = [
  { match: "cpp/geometry_demo", entry: "main.cpp:main", file: join("test", "fixtures", "cpp", "geometry_demo", "main.cpp"), marker: "// vg-cpp-edit-marker" },
  { match: "rust/router_demo", entry: "src/main.rs:main", file: join("test", "fixtures", "rust", "router_demo", "src", "main.rs"), marker: "// vg-rust-edit-marker" },
];
const C = CASES.find((c) => FIXTURE.includes(c.match));
const REVIEW_DIR = join(process.cwd(), "reviews", "cpp-rust-edit");

test.describe("C++ / Rust edit floor", () => {
  test.skip(!C, "Requires VG_FIXTURE=test/fixtures/cpp/geometry_demo or test/fixtures/rust/router_demo");

  let original = "";
  const path = C ? join(process.cwd(), C.file) : "";
  test.beforeAll(() => { original = readFileSync(path, "utf-8"); });
  test.afterAll(() => { writeFileSync(path, original, "utf-8"); });

  test("edit the cli entry through the panel; only the marker line changes; no save error", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click(`[data-thread-index-row][data-entry-id="${C!.entry}"]`);
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    await page.locator(".vg-thread-node-seed").first().click();
    await expect(page.locator("[data-node-editor-panel]")).toBeVisible({ timeout: 10_000 });
    await page.waitForSelector("[data-node-editor-panel] .monaco-editor .view-line", { timeout: 10_000 });

    // Editable now: no read-only note, Save present.
    await expect(page.locator("[data-readonly-language]")).toHaveCount(0);
    await expect(page.locator("[data-editor-save]")).toBeVisible();

    // A marker line just inside the closing brace.
    await page.locator("[data-node-editor-panel] .monaco-editor").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(C!.marker);

    await page.locator("[data-editor-save]").click();
    await page.waitForTimeout(2000);
    await expect(page.locator("[data-editor-save-error]")).toHaveCount(0);

    const post = readFileSync(path, "utf-8");
    expect(post).toContain(C!.marker);
    // Every other line is byte-identical — indentation included (a nested
    // node's replacement once doubled its indent; fitToSpan is the fix).
    const strip = (s: string) => s.split("\n").filter((l) => !l.includes(C!.marker)).join("\n");
    expect(strip(post)).toBe(strip(original));

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, `${C!.match.split("/")[0]}-after-save.png`) });
    expect(pageErrors).toEqual([]);
  });
});
