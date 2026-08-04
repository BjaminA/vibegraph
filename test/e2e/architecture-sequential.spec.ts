/**
 * Sitting-3 — container expansion (living renderer).
 *
 * `seq_mlp` holds the case from Ben's pump-lab sitting: WearRegressor
 * declares its whole stack as ONE `self.net = nn.Sequential(...)`. Before
 * expansion the schematic showed a single "Sequential net" card ("1 layers",
 * "? Unknown", params invisible) and the forward thread's `self.net` step
 * said only "Sequential".
 *
 * The M-NEST arg-walk already mints each member as a nested call node (real
 * IR, positional order — which IS application order by the nn.Sequential
 * contract), so deriveModels flattens the members into the layer stack:
 * per-member glyphs with param badges, an honest layer count, an MLP
 * classification, and a thread subtitle naming the member chain.
 *
 * StarNet (`nn.Sequential(*layers)`) mints no members and must stay a
 * single collapsed container card — expansion never guesses.
 *
 * Boot: VG_FIXTURE=test/fixtures/architecture/seq_mlp (test:e2e-arch-seq).
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("seq_mlp"), "Requires VG_FIXTURE=test/fixtures/architecture/seq_mlp");

const REVIEW_DIR = join(process.cwd(), "reviews", "architecture");

async function openArch(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Arch" }).click();
  await expect(page.locator("[data-architecture-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
}

test.describe("Sitting-3 — Sequential container expansion", () => {
  test("WearRegressor expands to 5 member glyphs with param badges; classified MLP", async ({ page }) => {
    await openArch(page);
    const hdr = page.locator('[data-model-header][data-model-name="WearRegressor"]');
    await expect(hdr).toBeVisible();
    // Honest classification: the Linears are visible now → MLP, high confidence.
    await expect(hdr).toHaveAttribute("data-net-type", "mlp");
    await expect(hdr).toHaveAttribute("data-net-confidence", "high");
    await expect(hdr).toContainText("5 layers");

    // One glyph per member, indexed into the container (net[0] is valid
    // Python), with per-member param counts from their own literal args.
    const expected: Array<[string, string, string | null]> = [
      ["net[0]", "Linear", "576"],
      ["net[1]", "ReLU", null],
      ["net[2]", "Linear", "2.1K"],
      ["net[3]", "ReLU", null],
      ["net[4]", "Linear", "33"],
    ];
    for (const [name, type, params] of expected) {
      const glyph = page.locator(`[data-layer-glyph][data-layer-name="${name}"]`);
      await expect(glyph).toBeVisible();
      await expect(glyph).toHaveAttribute("data-layer-type", type);
      if (params) await expect(glyph.locator("[data-layer-params]")).toHaveText(params);
    }
    // The container card itself is replaced by its members.
    await expect(page.locator('[data-layer-glyph][data-layer-name="net"]')).toHaveCount(0);
  });

  test("StarNet (*layers) stays a single collapsed container — no guessed members", async ({ page }) => {
    await openArch(page);
    const hdr = page.locator('[data-model-header][data-model-name="StarNet"]');
    await expect(hdr).toContainText("1 layers");
    await expect(page.locator('[data-layer-glyph][data-layer-name="body"]')).toBeVisible();
    await expect(page.locator('[data-layer-glyph][data-layer-name^="body["]')).toHaveCount(0);
  });

  test("forward thread: self.net names the member chain, not a bare 'Sequential'", async ({ page }) => {
    await openArch(page);
    await page.locator('[data-model-header][data-model-name="WearRegressor"]').click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);
    const step = page.locator(".vg-thread-node").filter({
      has: page.getByText("self.net", { exact: true }),
    });
    await expect(step).toContainText("Sequential — Linear(8, 64) → ReLU() → Linear(64, 32)");
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "seq-forward-thread.png"), fullPage: false });
  });

  test("screenshot — expanded schematic", async ({ page }) => {
    await openArch(page);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "seq-mlp-expanded.png"), fullPage: false });
  });
});
