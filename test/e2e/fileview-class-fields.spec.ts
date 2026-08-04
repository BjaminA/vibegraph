/**
 * Verification: the file view renders dataclass-style class fields, and node
 * width is dynamic to line length (no fixed horizontal cap).
 *
 * Boot with VG_FIXTURE=test/fixtures/threads/flask_demo. models.py has a
 * @dataclass `User` with three annotated fields (uid/name/email) that
 * previously parsed to zero child nodes, leaving the class body blank.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("file view — class fields + dynamic width", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-side-panel-tab="files"]', { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="models.py"]');
    await page.waitForSelector(".react-flow__node-classDefNode", { timeout: 15_000 });
  });

  test("User class is no longer blank — renders its 3 annotated fields", async ({ page }) => {
    // The three dataclass fields parse to assignment nodes parented under
    // the class_def. Before the AnnAssign visitor they didn't exist.
    const fieldIds = [
      "module/User.class/uid.assign",
      "module/User.class/name.assign",
      "module/User.class/email.assign",
    ];
    for (const id of fieldIds) {
      await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toHaveCount(1);
    }
    // The annotation renders (e.g. `uid : int`).
    await expect(page.locator(`.react-flow__node[data-id="module/User.class/uid.assign"]`))
      .toContainText("int");
  });

  test("node width grows with line length (no fixed cap)", async ({ page }) => {
    // The long DB call `query("SELECT uid, name, email FROM users ...")`
    // should render wider than a short field node.
    const callBox = await page
      .locator('.react-flow__node[data-id="module/find_user.fn/rows.assign"]')
      .boundingBox();
    const fieldBox = await page
      .locator('.react-flow__node[data-id="module/User.class/uid.assign"]')
      .boundingBox();
    expect(callBox).not.toBeNull();
    expect(fieldBox).not.toBeNull();
    expect(callBox!.width).toBeGreaterThan(fieldBox!.width);
  });

  test("still screenshot", async ({ page }) => {
    await page.screenshot({ path: "reviews/fileview/models-class-fields.png", fullPage: false });
  });
});
