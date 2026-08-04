/**
 * M-ARCH D — net-type classifier (honesty gate).
 *
 * Heuristic classification rendered confidence-honestly: a single strong
 * family → that type; a MIX of strong families → reported as a mix, NEVER
 * collapsed; nothing discriminating → unknown at low confidence (recessive).
 *
 * Boot: VG_FIXTURE=test/fixtures/architecture/model_zoo. zoo.py defines one
 * model per branch: MLP (linear-only), CharRNN (LSTM), TextTransformer
 * (TransformerEncoder), ConvAttnNet (Conv + MultiheadAttention → hybrid),
 * MysteryNet (only an unrecognized layer → unknown/low-confidence).
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("model_zoo"), "Requires VG_FIXTURE=test/fixtures/architecture/model_zoo");

const REVIEW_DIR = join(process.cwd(), "reviews", "architecture");

async function openArchitecture(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Arch" }).click();
  await expect(page.locator("[data-architecture-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
}

function header(page: import("@playwright/test").Page, name: string) {
  return page.locator(`[data-model-header][data-model-name="${name}"]`);
}

test.describe("M-ARCH — net-type classifier honesty", () => {
  test("each model is classified by its discriminating family", async ({ page }) => {
    await openArchitecture(page);
    await expect(header(page, "MLP")).toHaveAttribute("data-net-type", "mlp");
    await expect(header(page, "CharRNN")).toHaveAttribute("data-net-type", "recurrent");
    await expect(header(page, "TextTransformer")).toHaveAttribute("data-net-type", "transformer");
  });

  test("an even conv+attention model is a hybrid, not collapsed", async ({ page }) => {
    await openArchitecture(page);
    const h = header(page, "ConvAttnNet");
    await expect(h).toHaveAttribute("data-net-type", "hybrid");
    await expect(h).toHaveAttribute("data-net-confidence", "high");
    // The mix is named, not flattened to one label.
    await expect(h.locator("[data-net-chip]")).toContainText("Conv + Attention");
  });

  test("a ViT (conv stem + transformer body) is NOT a confident CNN", async ({ page }) => {
    await openArchitecture(page);
    const h = header(page, "TinyViT");
    // Attention dominates → transformer (or hybrid), never convolutional.
    const netType = await h.getAttribute("data-net-type");
    expect(netType, "ViT must not read as a CNN").not.toBe("convolutional");
    expect(["transformer", "hybrid"], `got ${netType}`).toContain(netType);
    await expect(h).toHaveAttribute("data-net-confidence", "high");
    // Composition is surfaced, not a single confident label.
    await expect(h.locator("[data-net-chip]")).toContainText("transformer body");
  });

  test("an unrecognized model is unknown at low confidence (recessive)", async ({ page }) => {
    await openArchitecture(page);
    const h = header(page, "MysteryNet");
    await expect(h).toHaveAttribute("data-net-type", "unknown");
    await expect(h).toHaveAttribute("data-net-confidence", "low");
    // Hedged copy, never a bare claim.
    await expect(h.locator("[data-net-chip]")).toContainText("Unknown");
  });

  test("screenshot — the zoo + net-type symbols", async ({ page }) => {
    await openArchitecture(page);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "zoo-classifier.png"), fullPage: false });
  });
});
