/**
 * M-PROVIDER — the Models panel end to end: a tier is pointed at a LOCAL
 * (Ollama) server, the endpoint is probed SERVER-side against a fake Ollama
 * started by this spec, the probe result shows on the panel, and the route
 * is persisted to `.vibegraph/models.json` and echoed back sanitised (a
 * bad endpoint never lands). No real model, no real claude.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4292 PORT=4292 \
 *     npx playwright test test/e2e/m-provider-panel.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const MODELS_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "models.json");

test.describe("M-PROVIDER — the Models panel: providers per tier, a probed local endpoint, persisted routes", () => {
  test.skip(!IS_FLASK, "Requires flask_demo");

  let fake: Server;
  let endpoint = "";
  let generates = 0;
  test.beforeAll(async () => {
    rmSync(MODELS_FILE, { force: true });
    fake = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const json = (o: unknown) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
        if (req.url === "/api/version") return json({ version: "0.9.3-fake" });
        if (req.url === "/api/tags") return json({ models: [{ name: "qwen2.5-coder:7b" }, { name: "qwen3:8b" }] });
        if (req.url === "/api/generate") { generates++; return json({ response: "OK", eval_count: 4, eval_duration: 160_000_000, load_duration: 900_000_000 }); }
        res.writeHead(404); res.end();
      });
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
    endpoint = `http://127.0.0.1:${(fake.address() as any).port}`;
  });
  test.afterAll(() => {
    fake?.close();
    rmSync(MODELS_FILE, { force: true });
  });

  test("point the worker tier at a local server, probe it, and see the route persisted", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // Open the Models panel (the toolbar's models toggle).
    await page.click("[data-models-toggle]");
    const panel = page.locator("[data-model-tiers-panel]");
    await expect(panel).toBeVisible();
    // Three tiers, each with a provider select; the worker tier is new.
    expect(await page.locator("[data-model-provider]").count()).toBe(3);
    await expect(page.locator('[data-model-tier-row="worker"]')).toContainText("Work-run workers");

    // Local server: set the fake endpoint + model, Test it.
    await page.fill("[data-model-local-endpoint]", endpoint);
    await page.fill("[data-model-local-name]", "qwen2.5-coder:7b");
    await page.click("[data-model-local-test]");
    const result = page.locator("[data-model-probe-result]");
    await expect(result).toHaveAttribute("data-model-probe-ok", "true", { timeout: 15_000 });
    await expect(result).toContainText("Ollama 0.9.3-fake");
    await expect(result).toContainText("2 model(s)");
    await expect(result).toContainText("qwen2.5-coder:7b: 25 tok/s");
    expect(generates).toBe(1);

    // Route the worker tier to the local server; the floor warning appears.
    await page.selectOption('[data-model-provider="worker"]', "ollama");
    await expect(page.locator('[data-model-floor-warning="worker"]')).toBeVisible();
    await expect(page.locator('[data-model-tier-row="worker"]')).toContainText(`Local server at ${endpoint}`);

    // Persisted, sanitised, per project.
    await expect.poll(() => existsSync(MODELS_FILE), { timeout: 10_000 }).toBe(true);
    const saved = JSON.parse(readFileSync(MODELS_FILE, "utf-8"));
    expect(saved.local).toEqual({ endpoint, model: "qwen2.5-coder:7b" });
    expect(saved.routes.worker).toEqual({ provider: "ollama" });
    expect(saved.routes.thinking).toBeUndefined();

    // A bad endpoint is refused at the boundary: the input shows the error state and nothing is saved for it.
    await page.fill("[data-model-local-endpoint]", "ftp://nope");
    await expect(page.locator("[data-model-local-test]")).toBeDisabled();
    await page.locator("[data-model-local-endpoint]").blur();
    const after = JSON.parse(readFileSync(MODELS_FILE, "utf-8"));
    expect(after.local.endpoint).toBe(endpoint);

    // A reload shows the SERVER's settings (not a stale local copy).
    await page.reload();
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click("[data-models-toggle]");
    await expect(page.locator('[data-model-provider="worker"]')).toHaveValue("ollama");
    await expect(page.locator("[data-model-local-endpoint]")).toHaveValue(endpoint);
  });
});
