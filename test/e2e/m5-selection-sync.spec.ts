/**
 * M5 wave 3 — three-way selection sync via vg-selection.
 *
 * Asserts the round-trip:
 *   - Cursor moves in CodeView -> document fires vg-selection with the
 *     enclosing AST node's id.
 *   - Diagram-side selection (vg-selection) -> CodeView reveals the
 *     node's line range in the editor viewport. (M10-chat-removal:
 *     was vg-chat-about-node, whose listener went with the ChatPanel;
 *     vg-selection is the selection spine proper and feeds the same
 *     chatContextNode -> CodeView path.)
 *
 * Sample_advanced.py has `greet` at lines 15-20 and `calculate_area`
 * at 10-12 -- enough vertical distance that "did the viewport jump"
 * is observable.
 */
import { test, expect } from "@playwright/test";

test.describe("M5 wave 3 — selection sync", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
    await page.waitForTimeout(600);
    // Open the code view first so it can listen / respond.
    await page.getByRole("button", { name: /code/i }).click();
    await page.waitForSelector("[data-code-view] .monaco-editor .view-line", { timeout: 15_000 });
    await page.waitForTimeout(600);
  });

  test("Monaco cursor change emits vg-selection with the enclosing function", async ({ page }) => {
    // Listen for the next vg-selection event from inside the page.
    const eventPromise = page.evaluate(() => {
      return new Promise<{ filePath: string; irNodeId: string; source: string }>((resolve) => {
        document.addEventListener("vg-selection", function once(e: Event) {
          document.removeEventListener("vg-selection", once);
          resolve((e as CustomEvent).detail);
        });
      });
    });

    // Click into Monaco at the line where `calculate_area` lives (line 11).
    // Easiest stable click: target the line-number gutter at that row.
    const codeView = page.locator("[data-code-view]");
    await codeView.locator(".monaco-editor .view-line").nth(10).click();

    const detail = await eventPromise;
    expect(detail.source).toBe("code");
    expect(detail.irNodeId).toMatch(/calculate_area\.fn/);
  });

  test("diagram selection moves the code view cursor to that range", async ({ page }) => {
    // Dispatch the selection -> CodeView's useEffect calls setPosition
    // on the Monaco editor. We probe the cursor position via the
    // textarea's aria attributes (Monaco's accessibility surface).
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("vg-selection", {
        detail: { filePath: null, irNodeId: "module/greet.fn", source: "diagram" },
      }));
    });
    await page.waitForTimeout(500);

    // `greet` is at line 15. The cursor row is exposed via the
    // editor's `textarea` aria-label / Monaco's API. We read it
    // back through page.evaluate by querying Monaco's first editor.
    const cursorLine = await page.evaluate(() => {
      const w = window as unknown as { monaco?: { editor: { getEditors: () => unknown[] } } };
      if (!w.monaco) return null;
      const eds = w.monaco.editor.getEditors() as { getPosition(): { lineNumber: number } | null }[];
      // CodeView's editor sits below MonacoOverlay in mount order;
      // first instance is what we want when overlay isn't open.
      const pos = eds[0]?.getPosition?.();
      return pos?.lineNumber ?? null;
    });
    expect(cursorLine).toBe(15);
  });
});
