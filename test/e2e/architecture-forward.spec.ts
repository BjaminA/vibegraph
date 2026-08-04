/**
 * M-ARCH B — forward() data-path thread.
 *
 * Clicking a model header in the architecture view opens its forward() as a
 * thread (reusing the extractor + thread view). The data path renders in
 * order; functional ops (F.relu) show honestly as external terminals; the
 * `self.<attr>` terminals are enriched with their declared layer type.
 *
 * Boot: VG_FIXTURE=test/fixtures/architecture/cnn_demo.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { deadBandReport, type Box } from "./helpers/noDeadBand";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("cnn_demo"), "Requires VG_FIXTURE=test/fixtures/architecture/cnn_demo");

const REVIEW_DIR = join(process.cwd(), "reviews", "architecture");

async function openForward(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Arch" }).click();
  await expect(page.locator("[data-architecture-view]")).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-model-header][data-model-name="SmallCNN"]').click();
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
}

function node(page: import("@playwright/test").Page, text: string) {
  return page.locator(".vg-thread-node", { hasText: text });
}

test.describe("M-ARCH — forward() data-path thread", () => {
  test("forward layers render as ordered steps", async ({ page }) => {
    await openForward(page);
    // The data path is present, conv1 → … → fc2.
    for (const name of ["self.conv1", "self.pool", "self.fc1", "self.fc2"]) {
      await expect(node(page, name).first()).toBeVisible();
    }
    // Start sits above the end (forward order, top→down or left→right by y).
    const c1 = await node(page, "self.conv1").first().boundingBox();
    const fc2 = await node(page, "self.fc2").first().boundingBox();
    expect(c1).not.toBeNull();
    expect(fc2).not.toBeNull();
    expect(c1!.y + c1!.x).toBeLessThan(fc2!.y + fc2!.x);
  });

  test("functional ops show honestly; self.<attr> steps carry their layer type", async ({ page }) => {
    await openForward(page);
    // F.relu is a functional call, not a layer — honest external terminal.
    await expect(node(page, "F.relu").first()).toBeVisible();
    // self.conv1 is enriched with its declared layer type.
    await expect(node(page, "self.conv1").first()).toContainText("Conv2d");
    await expect(node(page, "self.fc1").first()).toContainText("Linear");
  });

  test("every forward step renders distinctly — no reassignment collapse, no dead band", async ({ page }) => {
    await openForward(page);
    // §A regression guard: repeated `x = f(x)` bindings must NOT collapse to
    // one node. The repeated steps prove de-collapse by COUNT (was: 2 nodes).
    await expect(node(page, "F.relu")).toHaveCount(3);   // 3 functional relus
    await expect(node(page, "self.pool")).toHaveCount(2); // pool applied twice
    // Every distinct layer step is present exactly once.
    for (const name of ["self.conv1", "self.bn1", "self.conv2", "self.dropout", "self.fc1", "self.fc2"]) {
      await expect(node(page, name)).toHaveCount(1);
    }

    // Ordering along the data path (L-R main axis): conv1 < conv2 < fc1 < fc2.
    const xOf = async (label: string) => (await node(page, label).first().boundingBox())!.x;
    const [c1, c2, f1, f2] = await Promise.all(
      ["self.conv1", "self.conv2", "self.fc1", "self.fc2"].map(xOf),
    );
    expect(c1).toBeLessThan(c2);
    expect(c2).toBeLessThan(f1);
    expect(f1).toBeLessThan(f2);

    // No dead band: the void Ben saw was layout reserving height for the
    // collapsed steps. With every step present, no main-axis gap should dwarf
    // the typical inter-node spacing.
    const boxes: Box[] = [];
    const all = page.locator(".vg-thread-node");
    for (let i = 0; i < (await all.count()); i++) {
      const b = await all.nth(i).boundingBox();
      if (b) boxes.push(b);
    }
    const { maxGap, median, count } = deadBandReport(boxes, "x");
    expect(count).toBeGreaterThanOrEqual(12); // all steps, not the collapsed 2
    expect(maxGap, `dead band: maxGap ${maxGap} vs median ${median}`)
      .toBeLessThanOrEqual(Math.max(median * 3, 160));
  });

  test("screenshot — the forward data path", async ({ page }) => {
    await openForward(page);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "cnn-forward-thread.png"), fullPage: false });
  });
});
