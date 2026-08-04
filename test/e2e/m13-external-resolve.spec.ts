/**
 * M13.2 — verify the external-callable tooltip flow.
 *
 * Click on a `print` external node in flask_demo's cli:main thread —
 * `print` is in extract_thread.py's KNOWN_BUILTINS so it appears as a
 * clickable external. The tooltip should resolve via the new WS
 * round-trip and show signature + docstring + module footer, not the
 * old "External library call — source not available." dead-end.
 *
 * Note: nodes like `sqlite3.connect` that appear inside return /
 * assignment statements aren't extracted as standalone clickable
 * externals in v4. Surfacing those is a separate work item (would
 * need an extract_thread.py change to unwrap inner-call externals).
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m13-external-resolve.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("M13.2 — external-callable tooltip resolution", () => {
  test.skip(!IS_FLASK, "Needs VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("print tooltip resolves to a real signature + docstring (builtins fallback)", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "warning" || msg.type() === "error") {
        console.log(`[webview ${msg.type()}]`, msg.text());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open cli:main thread (has multiple print() calls from cmd_list /
    // cmd_create that the extractor emits as `print` externals).
    const cliRow = page.getByText("cli:main").first();
    await cliRow.waitFor({ state: "visible", timeout: 10_000 });
    await cliRow.click();
    await page.waitForTimeout(500);

    // Find a print external node. The label is "print"; the metadata
    // row may contain the full call preview. Use data-kind-label to
    // narrow to externals, then text-match.
    const printNode = page.locator('.vg-thread-node').filter({
      hasText: /^print/,
    }).first();
    await printNode.waitFor({ state: "visible", timeout: 5_000 });
    await page.screenshot({ path: "test-results/m13-before-click.png", fullPage: true });

    // Click to pin the tooltip.
    await printNode.click();
    await page.waitForTimeout(300);

    const tooltip = page.locator('[data-thread-tooltip]');
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });
    await page.screenshot({ path: "test-results/m13-tooltip-loading.png", fullPage: true });

    // The resolved tooltip should contain print's signature ("(*args, sep=...")
    // and "Prints" from its docstring.
    await expect(tooltip).toContainText(/\*args/, { timeout: 5_000 });
    await expect(tooltip).toContainText(/Prints/i, { timeout: 5_000 });

    await page.screenshot({ path: "test-results/m13-tooltip-resolved.png", fullPage: true });

    const tooltipText = await tooltip.textContent();
    console.log("=== M13.2 RESOLVED TOOLTIP (print) ===");
    console.log(tooltipText?.substring(0, 400));

    // Footer should classify as stdlib + show the builtins module.
    await expect(tooltip).toContainText(/stdlib/, { timeout: 1_000 });
    await expect(tooltip).toContainText(/builtins/, { timeout: 1_000 });

    // The old dead-end string MUST NOT appear.
    await expect(tooltip).not.toContainText(/source not available/);
  });

  test("unresolved external (receiver-attribute) shows the helpful reason, not the dead-end", async ({ page }) => {
    // conn.execute / request.get_json have a receiver that isn't an
    // importable module. The resolver returns kind=unresolved with a
    // reason; the webview shows that reason instead of the legacy
    // "source not available" text.
    page.on("console", (msg) => {
      if (msg.type() === "warning" || msg.type() === "error") {
        console.log(`[webview ${msg.type()}]`, msg.text());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const cliRow = page.getByText("cli:main").first();
    await cliRow.waitFor({ state: "visible", timeout: 10_000 });
    await cliRow.click();
    await page.waitForTimeout(500);

    // request.get_json appears in the create_user_route flow that
    // cli:main reaches (via create_user). If not present, fall back to
    // any other dotted external.
    let target = page.locator('.vg-thread-node').filter({
      hasText: /request\.get_json/,
    }).first();
    if (!await target.isVisible().catch(() => false)) {
      // Use conn.execute as a fallback; that's reached via query()/insert()
      // through the create_user flow.
      target = page.locator('.vg-thread-node').filter({
        hasText: /^conn\./,
      }).first();
    }
    if (!await target.isVisible().catch(() => false)) {
      test.skip(true, "no dotted-external with a non-importable receiver found in this thread");
      return;
    }

    await target.click();
    await page.waitForTimeout(300);

    const tooltip = page.locator('[data-thread-tooltip]');
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });
    await page.screenshot({ path: "test-results/m13-unresolved-tooltip.png", fullPage: true });

    // "source not resolvable" is the new unresolved-branch text; the
    // detail row should carry the resolver's error (something like
    // "base module 'conn' is not importable").
    await expect(tooltip).toContainText(/not resolvable|not importable|module/, { timeout: 5_000 });
    await expect(tooltip).not.toContainText(/source not available/);
  });
});
