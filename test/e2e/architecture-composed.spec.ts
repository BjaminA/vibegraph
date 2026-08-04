/**
 * M-NEST Layer 1 — nested-call de-lie (living renderer).
 *
 * `composed_demo` holds two models with the SAME architecture written two ways:
 *   FlatNet     — one call per line (`x = self.conv1(x)`); the IR always saw it.
 *   ComposedNet — composed (`x = F.relu(self.conv1(x))`, `return self.fc(x)`);
 *                 the inner conv1/conv2 used to vanish (silent truncation) and
 *                 fc dropped because return-value calls carried no callTarget.
 *
 * After Layer 1 the parser mints nested-call nodes and surfaces return-value
 * calls, so ComposedNet's forward path is complete and honest — the conv layers
 * appear as steps, and the schematic lists conv1/conv2/fc as forward layers.
 *
 * Boot: VG_FIXTURE=test/fixtures/architecture/composed_demo.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("composed_demo"), "Requires VG_FIXTURE=test/fixtures/architecture/composed_demo");

const REVIEW_DIR = join(process.cwd(), "reviews", "architecture");

async function openArch(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Arch" }).click();
  await expect(page.locator("[data-architecture-view]")).toBeVisible({ timeout: 10_000 });
}

async function openForward(page: import("@playwright/test").Page, model: string) {
  await openArch(page);
  await page.locator(`[data-model-header][data-model-name="${model}"]`).click();
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
}

// Match a thread node by its exact LABEL, not a substring — the F.relu node's
// preview row is the full source `F.relu(self.conv1(x))`, so a loose hasText
// "self.conv1" would wrongly match the wrapping F.relu node even when conv1 is
// collapsed. Exact text targets the label element only.
function node(page: import("@playwright/test").Page, label: string) {
  return page.locator(".vg-thread-node").filter({
    has: page.getByText(label, { exact: true }),
  });
}

test.describe("M-NEST L1 — composed forward de-lie", () => {
  test("both models recognised; ComposedNet schematic lists conv1/conv2/fc", async ({ page }) => {
    await openArch(page);
    await expect(page.locator('[data-model-header][data-model-name="FlatNet"]')).toBeVisible();
    await expect(page.locator('[data-model-header][data-model-name="ComposedNet"]')).toBeVisible();
    // The three declared layers all render as glyphs (none silently dropped).
    for (const name of ["conv1", "conv2", "fc"]) {
      await expect(page.locator(`[data-layer-glyph][data-layer-name="${name}"]`).first()).toBeVisible();
    }
  });

  test("collapsed by default: nested convs hidden, outer F.relu badged (honesty)", async ({ page }) => {
    await openForward(page, "ComposedNet");
    // The clutter fix: conv1/conv2 are nested inside F.relu(...) and collapsed
    // out of the default view — but never silently. The wrapping F.relu steps
    // carry a "nests" badge (mark-iff-nests), and fc/return still show.
    await expect(node(page, "F.relu").first()).toBeVisible();
    await expect(node(page, "self.fc").first()).toBeVisible();
    await expect(page.locator("[data-nest-badge]")).toHaveCount(2); // two F.relu nests
    await expect(node(page, "self.conv1")).toHaveCount(0);
    await expect(node(page, "self.conv2")).toHaveCount(0);
  });

  test("expand all: nested convs revealed, ordered conv1 → conv2 → fc → return", async ({ page }) => {
    await openForward(page, "ComposedNet");
    await page.locator("[data-thread-nests-toggle]").click();
    await page.waitForTimeout(400);
    await expect(node(page, "self.conv1").first()).toBeVisible();
    await expect(node(page, "self.conv2").first()).toBeVisible();
    // Ordered along the L-R data path: conv1 < conv2 < fc < return.
    const xOf = async (label: string) => (await node(page, label).first().boundingBox())!.x;
    const [c1, c2, fc, ret] = await Promise.all(
      ["self.conv1", "self.conv2", "self.fc", "return"].map(xOf),
    );
    expect(c1).toBeLessThan(c2);
    expect(c2).toBeLessThan(fc);
    expect(fc).toBeLessThan(ret);
  });

  test("per-node badge expands a single nest", async ({ page }) => {
    await openForward(page, "ComposedNet");
    await expect(node(page, "self.conv1")).toHaveCount(0);
    // Click the first F.relu's nest badge → only its nested conv appears.
    await page.locator("[data-nest-badge]").first().click();
    await page.waitForTimeout(400);
    // Exactly one conv revealed (the other nest stays collapsed).
    const convs = await node(page, "self.conv1").count() + await node(page, "self.conv2").count();
    expect(convs).toBe(1);
  });

  test("Visual Contract: expanded nest draws a teal container that contains its inner call", async ({ page }) => {
    await openForward(page, "ComposedNet");
    await page.locator("[data-thread-nests-toggle]").click();
    await page.waitForTimeout(400);
    // One bordered nest backdrop per expanded nest (the two F.relu wrappers).
    const boxes = page.locator('[data-thread-container][data-container-kind="nest"]');
    await expect(boxes).toHaveCount(2);
    // Containment: self.conv1's card sits within some nest box's bounds (it is
    // the revealed inner call). Full-size + untruncated (no clipping of label).
    const conv1 = await node(page, "self.conv1").first().boundingBox();
    expect(conv1).not.toBeNull();
    let contained = false;
    for (let i = 0; i < (await boxes.count()); i++) {
      const b = await boxes.nth(i).boundingBox();
      if (!b) continue;
      if (conv1!.x >= b.x - 1 && conv1!.y >= b.y - 1 &&
          conv1!.x + conv1!.width <= b.x + b.width + 1 &&
          conv1!.y + conv1!.height <= b.y + b.height + 1) {
        contained = true;
        break;
      }
    }
    expect(contained, "self.conv1 should sit inside a nest container box").toBe(true);
  });

  test("ChainNet: chain + comprehension nests carry the 'uncaptured' badge (path shown incomplete)", async ({ page }) => {
    await openForward(page, "ChainNet");
    // self.proj (chain callee) and self.head (comprehension) are NOT decomposed
    // into steps — that's the documented stopping rule. They must NOT appear as
    // silently-complete; the wrapping steps carry the dashed "uncaptured" badge.
    await expect(node(page, "self.proj").first()).toHaveCount(0); // not a standalone step
    await expect(node(page, "self.head").first()).toHaveCount(0);
    const uncaptured = page.locator('[data-nest-badge][data-nest-uncaptured="true"]');
    await expect(uncaptured).toHaveCount(2); // self.proj().relu + torch.stack
    // Uncaptured nests are not expandable — no global expand toggle appears
    // (ChainNet has zero EXTRACTED nests), so nothing can be silently revealed.
    await expect(page.locator("[data-thread-nests-toggle]")).toHaveCount(0);
  });

  test("FlatNet has no nests: conv layers always shown, no badge", async ({ page }) => {
    await openForward(page, "FlatNet");
    await expect(node(page, "self.conv1").first()).toBeVisible();
    await expect(node(page, "self.conv2").first()).toBeVisible();
    await expect(page.locator("[data-nest-badge]")).toHaveCount(0);
  });

  test("screenshot — collapsed (badged) then expanded (contained)", async ({ page }) => {
    await openForward(page, "ComposedNet");
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "composed-nests-collapsed.png"), fullPage: false });
    await page.locator("[data-thread-nests-toggle]").click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(REVIEW_DIR, "composed-nests-expanded.png"), fullPage: false });
  });
});

// M-FS9 (full-scope review P3) — the schematic cues declaration-order
// fallback instead of quietly drawing arrows that may reverse the real
// data path. ChainNet's chained/comprehension calls hide proj + head
// from the outermost-call walk → cue present; FlatNet's fully explicit
// forward keeps an uncued (trusted) order.
test("M-FS9: declaration-order fallback is cued on the model header", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
  await page.getByRole("button", { name: "Arch" }).click();
  await expect(page.locator("[data-architecture-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);

  const chain = page.locator('[data-model-header][data-model-name="ChainNet"]');
  await expect(chain.locator("[data-order-fallback]")).toBeVisible();
  await expect(chain.locator("[data-order-fallback]")).toHaveText("approx. order");

  const flat = page.locator('[data-model-header][data-model-name="FlatNet"]');
  await expect(flat.locator("[data-order-fallback]")).toHaveCount(0);
});
