/**
 * M-ARCH A1+C — the PyTorch architecture view (the 5th lens).
 *
 * Living-renderer proof: the schematic renders one typed glyph per DECLARED
 * layer, in forward()-application order, with glyph type mapping to the layer
 * class. A non-nn.Module class is NOT shown.
 *
 * Boot: VG_FIXTURE=test/fixtures/architecture/cnn_demo. SmallCNN(nn.Module)
 * declares conv1/bn1/pool/conv2/dropout/fc1/fc2; forward applies them in the
 * order conv1, bn1, pool, conv2, dropout, fc1, fc2 (functional F.relu / x.view
 * are not layers — shown by the forward thread, not here). Trainer is a plain
 * class and must not appear.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("cnn_demo"), "Requires VG_FIXTURE=test/fixtures/architecture/cnn_demo");

const REVIEW_DIR = join(process.cwd(), "reviews", "architecture");
// Layer name → expected glyph type, in forward-application order.
const EXPECTED: Array<[string, string]> = [
  ["conv1", "Conv2d"],
  ["bn1", "BatchNorm2d"],
  ["pool", "MaxPool2d"],
  ["conv2", "Conv2d"],
  ["dropout", "Dropout"],
  ["fc1", "Linear"],
  ["fc2", "Linear"],
];

async function openArchitecture(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Arch" }).click();
  await expect(page.locator("[data-architecture-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400); // settle fitView
}

test.describe("M-ARCH — architecture schematic view", () => {
  test("renders the model header and exactly the declared layers", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await openArchitecture(page);

    // The recognized model; the plain Trainer class is absent.
    await expect(page.locator('[data-model-header][data-model-name="SmallCNN"]')).toHaveCount(1);
    await expect(page.locator('[data-model-header][data-model-name="Trainer"]')).toHaveCount(0);

    // One glyph per declared layer — exactly the 7, no more.
    await expect(page.locator("[data-layer-glyph]")).toHaveCount(EXPECTED.length);

    // Each layer glyph carries the correct type (by identity, not "some glyph").
    for (const [name, type] of EXPECTED) {
      await expect(
        page.locator(`[data-layer-glyph][data-layer-name="${name}"][data-layer-type="${type}"]`),
        `layer ${name} should be a ${type} glyph`,
      ).toHaveCount(1);
    }

    // Net-type: a conv+pool+linear stack reads as a CNN, high confidence.
    const hdr = page.locator('[data-model-header][data-model-name="SmallCNN"]');
    await expect(hdr).toHaveAttribute("data-net-type", "convolutional");
    await expect(hdr).toHaveAttribute("data-net-confidence", "high");

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  test("glyph order equals forward() application order", async ({ page }) => {
    await openArchitecture(page);
    // react-flow positions are absolute; read each glyph's y and assert the
    // declared forward order stacks top→down.
    const ys: number[] = [];
    for (const [name] of EXPECTED) {
      const box = await page.locator(`[data-layer-glyph][data-layer-name="${name}"]`).boundingBox();
      expect(box, `no box for ${name}`).not.toBeNull();
      ys.push(box!.y);
    }
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i], `${EXPECTED[i][0]} should sit below ${EXPECTED[i - 1][0]}`).toBeGreaterThan(ys[i - 1]);
    }
  });

  test("screenshot — the schematic", async ({ page }) => {
    await openArchitecture(page);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "cnn-schematic.png"), fullPage: false });
  });
});
