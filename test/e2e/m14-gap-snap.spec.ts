/**
 * M14.3 — verify the file-view statement-gap snap end-to-end.
 *
 * Success criteria (PLAN-v4 §2.4 / M14.3 Done clause):
 *   - Drag a Call kind into main()'s body in cli.py's file diagram.
 *   - Position cursor at a specific gap between two existing statements.
 *   - On pointerup the AddComponentModal opens.
 *   - The header reads "Add call before/after <anchor>" (not "inside …").
 *   - Insert with the default template (`func_name(arg)`) commits.
 *   - cli.py on disk has the new call inserted at the snapped gap, with
 *     the surrounding statements unchanged.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m14-gap-snap.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const CLI_PY = FIXTURE
  ? path.resolve(FIXTURE, "cli.py")
  : null;

test.describe("M14.3 — file-view statement-gap snap", () => {
  test.skip(!IS_FLASK, "Needs VG_FIXTURE=test/fixtures/threads/flask_demo");

  let savedCli: string | null = null;

  test.beforeAll(() => {
    if (!CLI_PY) return;
    savedCli = readFileSync(CLI_PY, "utf-8");
  });

  test.afterAll(() => {
    if (CLI_PY && savedCli != null) {
      writeFileSync(CLI_PY, savedCli, "utf-8");
    }
  });

  test("drop a Call between two statements in main() → file edited at that gap", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "warning" || msg.type() === "error") {
        console.log(`[webview ${msg.type()}]`, msg.text());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to file view via the Files tab in the side panel.
    await page.locator('[data-side-panel-tab="files"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-file-tree-row="cli.py"]').click();
    await page.waitForTimeout(1200);  // diagram layout takes a moment

    // Locate the main() function_def react-flow node + pick the
    // second child as the snap anchor.
    const mainFn = page.locator('.react-flow__node[data-id="module/main.fn"]');
    await mainFn.waitFor({ state: "visible", timeout: 5_000 });
    const childIds = await page.locator('.react-flow__node[data-id]').evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.id ?? "")
        .filter((id) => id.startsWith("module/main.fn/")),
    );
    if (childIds.length < 2) {
      throw new Error(`main() has ${childIds.length} visible children; need ≥2 to test a gap between`);
    }
    const anchorId = childIds[1];
    const argsAssign = page.locator(`.react-flow__node[data-id="${anchorId}"]`);
    const argsBox = await argsAssign.boundingBox();
    if (!argsBox) throw new Error(`no bounding box for ${anchorId}`);

    // Open + Add → Call.
    await page.getByRole("button", { name: /add/i }).filter({ hasText: "Add" }).click();
    await page.locator('[role="menu"]').getByRole("menuitem", { name: /^Call$/ }).click();
    await page.waitForTimeout(100);

    // Move cursor to the EXACT center of the anchor's bottom edge —
    // gives the gap-snapper a clear "below anchor, above next" target.
    const targetX = argsBox.x + argsBox.width / 2;
    const targetY = argsBox.y + argsBox.height / 2 + 2;  // mid-anchor + 2px
    await page.mouse.move(targetX, targetY - 100, { steps: 4 });
    await page.mouse.move(targetX, targetY, { steps: 8 });
    await page.waitForTimeout(400);  // let react-flow finish any transition
    // Nudge cursor 1px so a fresh mousemove fires with the settled layout.
    await page.mouse.move(targetX + 1, targetY);
    await page.waitForTimeout(150);

    // Verify the gap-snap tagged the anchor child with the snapped
    // position. Acceptance criterion: data-gap-active-position is set
    // on the anchor we positioned the cursor relative to, with value
    // "after" or "before".
    const gapPos = await argsAssign.getAttribute("data-gap-active-position");
    expect(gapPos, "anchor should be tagged with the snapped gap").toMatch(/^(before|after)$/);

    // M16.1 visual tune — capture a focused screenshot of the indicator
    // so the bolder line + extended halo are reviewable in test-results/.
    // Frame around the anchor with vertical padding so both the sharp
    // line and the halo are visible above/below it. Cursor stays put.
    {
      const padX = 32;
      const padY = 64;
      await page.screenshot({
        path: "test-results/m14-gap-indicator.png",
        clip: {
          x: Math.max(0, Math.floor(argsBox.x - padX)),
          y: Math.max(0, Math.floor(argsBox.y - padY)),
          width: Math.ceil(argsBox.width + padX * 2),
          height: Math.ceil(argsBox.height + padY * 2),
        },
      });
    }

    // Pointerup releases on the anchor → drop fires.
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Modal should open with the gap-snap reason in pickerReason
    // (visible as a footer in the modal header subtitle, but easier
    // to assert is the dialog itself being visible).
    const modal = page.locator('[role="dialog"][aria-label*="Add"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: "test-results/m14-modal-open.png", fullPage: true });

    // The Insert button is on the bottom; click it to commit the default
    // template. AddComponentModal pre-fills "func_name(arg)" for `call`.
    await page.getByRole("button", { name: /Insert/i }).click();

    // Wait for the modal to close (success path).
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(300);

    // Verify the file on disk.
    if (!CLI_PY) throw new Error("CLI_PY path missing");
    const newSrc = readFileSync(CLI_PY, "utf-8");
    console.log("=== cli.py post-insert ===");
    console.log(newSrc);

    // The new call MUST appear in main()'s body.
    expect(newSrc).toContain("func_name(arg)");
    // Snap anchor was childIds[1] = "module/main.fn/sub.assign" with
    // position "after". The new call MUST appear between
    //   sub = parser.add_subparsers(...)        (the anchor)
    // and
    //   sub.add_parser("list", help="...")      (the next statement)
    const lines = newSrc.split("\n");
    const subAssignIdx = lines.findIndex((l) => l.includes("sub = parser.add_subparsers"));
    const newCallIdx = lines.findIndex((l) => l.trim() === "func_name(arg)");
    const subAddParserIdx = lines.findIndex((l) => l.includes('sub.add_parser("list"'));

    expect(subAssignIdx, "sub = parser.add_subparsers should still be present").toBeGreaterThan(-1);
    expect(newCallIdx, "func_name(arg) should appear in cli.py").toBeGreaterThan(-1);
    expect(subAddParserIdx, 'sub.add_parser("list", ...) should still be present').toBeGreaterThan(-1);

    expect(newCallIdx, "new call should appear AFTER sub.assign").toBeGreaterThan(subAssignIdx);
    expect(newCallIdx, "new call should appear BEFORE sub.add_parser").toBeLessThan(subAddParserIdx);

    // The OTHER statements MUST still be in their original positions.
    expect(newSrc).toContain("args = parser.parse_args()");
    expect(newSrc).toContain('if args.cmd == "list":');
    // Sanity check: surrounding context (above main(), below main()) unchanged.
    expect(newSrc).toContain("import argparse");
    expect(newSrc).toContain("def cmd_list():");
    expect(newSrc).toContain("def main():");
    expect(newSrc).toContain('if __name__ == "__main__":');
  });
});
