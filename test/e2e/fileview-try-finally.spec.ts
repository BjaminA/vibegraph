/**
 * Regression: the file view collapsed try / finally containers to blank
 * dashed "ref" cards and dropped their nested statements entirely.
 *
 * Root cause was renderer-only (the IR holds the try@0 / finally@0
 * containers + children): buildLayout's CONTAINER_TYPES omitted try_stmt /
 * finally_block, so emitNode never recursed into their children and
 * typeToNodeType fell them through to the assignment renderer's blank
 * "ref" variant.
 *
 * Boot with VG_FIXTURE=test/fixtures/threads/flask_demo. db.py::query is:
 *
 *   def query(sql, params=()):
 *       conn = _get_conn()
 *       try:
 *           cursor = conn.execute(sql, params)
 *           return cursor.fetchall()
 *       finally:
 *           conn.close()
 *
 * The file view must now render try/finally as bordered container regions
 * (the shared ThreadContainerNode) with their statements nested inside —
 * the same fidelity as source and as thread view.
 */
import { test, expect } from "@playwright/test";

const Q = "module/query.fn";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("file view — try / finally containers", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-side-panel-tab="files"]', { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="db.py"]');
    await page.waitForSelector(".react-flow__node-functionDefNode", { timeout: 15_000 });
  });

  test("try / finally render as container regions, not blank ref cards", async ({ page }) => {
    const tryC = page.locator(`.react-flow__node-threadContainer[data-id="${Q}/try@0"]`);
    const finallyC = page.locator(`.react-flow__node-threadContainer[data-id="${Q}/finally@0"]`);
    await expect(tryC).toHaveCount(1);
    await expect(finallyC).toHaveCount(1);
    // The Family-1 chip carries the keyword — not the blank "ref" placeholder.
    await expect(tryC).toContainText("TRY");
    await expect(finallyC).toContainText("FINALLY");
    // The regression rendered these as assignmentNode "ref" cards — assert
    // neither container collapsed to that renderer.
    await expect(
      page.locator(`.react-flow__node-assignmentNode[data-id="${Q}/try@0"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`.react-flow__node-assignmentNode[data-id="${Q}/finally@0"]`),
    ).toHaveCount(0);
  });

  test("try contains EXACTLY cursor-assign + return; finally EXACTLY conn.close", async ({ page }) => {
    // Children are identified by their structural-path ids nested under the
    // container id. "Exactly" = the descendant count by id-prefix.
    const tryKids = page.locator(`.react-flow__node[data-id^="${Q}/try@0/"]`);
    const finallyKids = page.locator(`.react-flow__node[data-id^="${Q}/finally@0/"]`);
    await expect(tryKids).toHaveCount(2);
    await expect(finallyKids).toHaveCount(1);

    // Identity + content of each child node.
    const cursor = page.locator(`.react-flow__node[data-id="${Q}/try@0/cursor.assign"]`);
    const ret = page.locator(`.react-flow__node[data-id="${Q}/try@0/return@0"]`);
    const close = page.locator(`.react-flow__node[data-id="${Q}/finally@0/conn_close.call"]`);
    await expect(cursor).toHaveCount(1);
    await expect(ret).toHaveCount(1);
    await expect(close).toHaveCount(1);
    await expect(cursor).toContainText("execute");
    await expect(ret).toContainText("fetchall");
    await expect(close).toContainText("close");
  });

  test("children sit inside their container's bounds", async ({ page }) => {
    const within = async (childSel: string, parentSel: string) => {
      const c = await page.locator(childSel).boundingBox();
      const p = await page.locator(parentSel).boundingBox();
      expect(c).not.toBeNull();
      expect(p).not.toBeNull();
      // Allow the chip overhang (top:-10) but require horizontal + vertical
      // containment of the child body within the region.
      expect(c!.x).toBeGreaterThanOrEqual(p!.x - 1);
      expect(c!.x + c!.width).toBeLessThanOrEqual(p!.x + p!.width + 1);
      expect(c!.y).toBeGreaterThanOrEqual(p!.y - 1);
      expect(c!.y + c!.height).toBeLessThanOrEqual(p!.y + p!.height + 1);
    };
    await within(
      `.react-flow__node[data-id="${Q}/try@0/cursor.assign"]`,
      `.react-flow__node[data-id="${Q}/try@0"]`,
    );
    await within(
      `.react-flow__node[data-id="${Q}/finally@0/conn_close.call"]`,
      `.react-flow__node[data-id="${Q}/finally@0"]`,
    );
  });

  test("no rendered node is blank (guards the blank-ref regression class)", async ({ page }) => {
    // Every node in the painted file view must show *some* text. A node with
    // an empty body is exactly the blank-"ref" bug — treat it as a failure.
    const texts = await page.locator(".react-flow__node").allInnerTexts();
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t.trim().length, "a rendered node had no visible text").toBeGreaterThan(0);
    }
  });

  test("screenshot — both containers populated", async ({ page }) => {
    await page.screenshot({ path: "reviews/fileview/db-try-finally.png", fullPage: false });
  });
});
