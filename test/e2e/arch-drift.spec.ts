/**
 * Architecture groups that outlast the code (2026-10-05): ratified groups
 * carry a baseline; when the map moves past them (clusters no group holds,
 * new deployment units, new planned items) the map says so and offers an
 * UPDATE — a model extends the ratified groups (they stay fixed) and a person
 * ratifies, which moves the baseline. Stub model: fake_claude_arch.mjs.
 *
 *   VG_FIXTURE=test/fixtures/webstack/next_demo VG_PORT=4332 PORT=4332 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/arch/fake_claude_arch.mjs" \
 *     npx playwright test test/e2e/arch-drift.spec.ts --workers=1
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const STORE = join(process.cwd(), FIXTURE, ".vibegraph", "architecture.json");
const KNOWLEDGE = join(process.cwd(), FIXTURE, ".vibegraph", "knowledge");

test.describe("architecture drift since ratification", () => {
  test.skip(!FIXTURE.includes("next_demo"), "Requires VG_FIXTURE=test/fixtures/webstack/next_demo");
  test.afterAll(() => { if (existsSync(STORE)) rmSync(STORE); rmSync(KNOWLEDGE, { recursive: true, force: true }); });

  test("the map says what changed since ratification, and an update extends the ratified group", async ({ page }) => {
    test.setTimeout(90_000);
    // Ratified a while ago, over a smaller map: one group around the web app,
    // and no deployment units known then.
    mkdirSync(dirname(STORE), { recursive: true });
    writeFileSync(STORE, JSON.stringify({
      version: "1", names: {},
      groups: [{ id: "g-mine", kind: "host", label: "app host", wraps: ["cluster:web:."], note: "ratified from m (2026-10-01)" }],
      ratified: { at: "2026-10-01T00:00:00.000Z", model: "m" },
      baseline: { at: "2026-10-01T00:00:00.000Z", clusters: ["cluster:web:."], ungrouped: [], deploy: [] },
    }, null, 2));

    await page.addInitScript(() => { try { localStorage.removeItem("vg-system-mode"); localStorage.removeItem("vg-arch-lens"); } catch { /* */ } });
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
    const banner = page.locator("[data-key-banner]");
    if (await banner.count()) await banner.locator("button").click();
    await page.getByRole("button", { name: "System" }).click();
    await page.locator("[data-system-arch-toggle]").click();
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "map");

    const drift = page.locator('[data-arch-drift="substantial"]');
    await expect(drift).toBeVisible({ timeout: 15_000 });
    await expect(drift).toContainText("ungrouped");
    await expect(drift).toContainText("new deploy unit");
    expect(await drift.getAttribute("title")).toMatch(/cluster:mcp:\.|cluster:scripts:\./);

    await page.locator("[data-arch-update]").click();
    const bar = page.locator("[data-arch-proposal-bar]");
    await expect(bar.locator("[data-arch-proposal-summary]")).toContainText("update from", { timeout: 20_000 });
    await bar.locator("[data-arch-ratify]").click();
    await expect(page.locator("[data-arch-drift]")).toHaveCount(0, { timeout: 15_000 });

    const store = JSON.parse(readFileSync(STORE, "utf-8"));
    const g = store.groups.find((x: { id: string }) => x.id === "g-mine");
    expect(g.label).toBe("app host"); // an update only adds; the model's rename did not land
    expect(g.wraps).toEqual(["cluster:web:."]);
    expect(g.match).toEqual([{ kind: "cluster", family: ["mcp", "scripts"] }]);
    expect(store.baseline.clusters).toEqual(expect.arrayContaining(["cluster:web:.", "cluster:mcp:.", "cluster:scripts:."]));
    expect(store.baseline.deploy.length).toBeGreaterThan(0);
  });
});
