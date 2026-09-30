/**
 * The README / guide screenshots, regenerated from real fixtures — not a
 * test (it asserts only what it needs to reach each view) and skipped unless
 * VG_DOCS_SHOTS=1. Run all of them with:
 *
 *   ./scripts/docs_screenshots.sh
 *
 * Each describe block needs its own server fixture (VG_FIXTURE); the script
 * boots each in turn. Output: docs/screenshots/*.png at 1500×940.
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SHOTS = process.env.VG_DOCS_SHOTS === "1";
const OUT = "docs/screenshots";
const FIX = process.env.VG_FIXTURE ?? "";
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, name) });

async function boot(page: Page) {
  await page.setViewportSize({ width: 1500, height: 940 });
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 20_000 });
  const banner = page.locator("[data-key-banner]");
  if (await banner.count()) await banner.locator("button").click();
  await page.waitForTimeout(600);
}

async function openThread(page: Page, entry: string) {
  await page.click(`[data-thread-index-row][data-entry-id="${entry}"]`);
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(1200);
}

async function openMap(page: Page, lens: string) {
  // The system tier is derived after the threads, so an early click can land
  // before the view has anything to show: click until it is up.
  const system = page.locator("[data-toolbar-group=\"views\"]").getByRole("button", { name: "System", exact: true });
  for (let i = 0; i < 8 && !(await page.locator("[data-system-view]").count()); i++) {
    if (i === 0 || (await system.getAttribute("data-active")) !== "true") await system.click();
    await page.waitForTimeout(4000);
  }
  await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 10_000 });
  if ((await page.locator("[data-system-view]").getAttribute("data-system-mode")) !== "map") {
    await page.locator("[data-system-arch-toggle]").click();
  }
  await page.locator(`[data-arch-lens="${lens}"]`).click();
  await expect(page.locator(`[data-arch-lens="${lens}"]`)).toHaveAttribute("data-active", "true");
  await page.mouse.move(2, 2);
  await page.waitForTimeout(1500);
}

test.describe("docs screenshots — fleet-telemetry", () => {
  test.skip(!SHOTS || !FIX.includes("fleet-telemetry"), "VG_DOCS_SHOTS=1 VG_FIXTURE=examples/fleet-telemetry");
  test.setTimeout(120_000);

  test("launchpad: threads nested under the thread that starts them", async ({ page }) => {
    await boot(page);
    await shot(page, "01-launchpad.png");
  });

  test("thread: ranked, with its tests and configuration chips", async ({ page }) => {
    await boot(page);
    await openThread(page, "telemetry/app.py:ingest_route");
    const control = page.locator("[data-thread-rank-control]");
    await control.locator('[data-rank-level="1"]').click();
    await page.waitForTimeout(1200);
    await shot(page, "02-thread.png");
    await control.locator('[data-rank-level="2"]').click();
    await page.waitForTimeout(1200);
    const env = page.locator("[data-thread-env-chip]");
    if (await env.count()) {
      await env.click();
      await page.waitForTimeout(500);
      await shot(page, "07-thread-config.png");
    }
  });

  test("architecture map: bird's-eye, and the configuration lens", async ({ page }) => {
    await boot(page);
    await openMap(page, "birdseye");
    await shot(page, "05-architecture.png");
    await openMap(page, "config");
    await shot(page, "08-config-lens.png");
  });

  test("code view: rank gutter, env reads, unreached code", async ({ page }) => {
    await boot(page);
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="telemetry/http_client.py"]');
    await page.click('button[title="Show source for the active file"]');
    await expect(page.locator("[data-code-view]")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await shot(page, "06-code-insight.png");
  });

  test("investigation board: pins across threads, a question, a note", async ({ page }) => {
    await boot(page);
    await openThread(page, "telemetry/app.py:ingest_route");
    const tooltip = page.locator("[data-thread-tooltip]");
    const pin = async (label: RegExp) => {
      const node = page.locator(".vg-thread-node", { has: page.locator("[data-node-label]", { hasText: label }) }).first();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(400);
      await node.hover({ force: true });
      await expect(tooltip).toBeVisible({ timeout: 5_000 });
      await tooltip.locator("[aria-label='Pin']").click();
      await tooltip.locator("[data-investigate-pin]").click();
      await tooltip.locator("[aria-label='Close tooltip']").click();
    };
    await pin(/^ingest_batch$/);
    await pin(/^validate_batch$/);
    const board = page.locator("[data-investigation-panel]");
    await expect(board.locator("[data-investigation-pin]")).toHaveCount(2);
    await board.locator("[data-investigation-question]").fill("Why did one sensor page twice in a minute?");
    await board.locator("[data-investigation-note]").first().fill("accepts the batch before the dedup window is read");
    await board.locator("[data-investigation-question]").click();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(600);
    await shot(page, "09-investigation.png");
    await page.locator("[data-investigation-delete]").click();
  });

  test("generic direction: the skills, where they apply, what the hooks send", async ({ page }) => {
    await boot(page);
    await page.click("[data-skills-toggle]");
    await page.waitForTimeout(800);
    await shot(page, "11-direction.png");
  });
});

test.describe("docs screenshots — journeys", () => {
  test.skip(!SHOTS || !FIX.includes("journeys_demo"), "VG_DOCS_SHOTS=1 VG_FIXTURE=test/fixtures/journeys/journeys_demo");
  test("the Journeys lens: page to page by the links it renders", async ({ page }) => {
    await boot(page);
    await openMap(page, "journeys");
    await shot(page, "10-journeys.png");
  });
});

test.describe("docs screenshots — the plan", () => {
  test.skip(!SHOTS || !FIX.includes("plan_demo"), "VG_DOCS_SHOTS=1 VG_FIXTURE=test/fixtures/plan/plan_demo");
  test.setTimeout(120_000);
  test("the Plan panel, and the plan on the map", async ({ page }) => {
    await boot(page);
    await page.click("[data-plan-toggle]");
    await expect(page.locator("[data-plan-counts]")).toBeVisible({ timeout: 15_000 });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(500);
    await shot(page, "16-plan-panel.png");
    await page.click("[data-plan-toggle]");
    await openMap(page, "overview");
    await page.locator('[data-plan-view="plan"]').click();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1200);
    await shot(page, "17-plan-map.png");
    await page.locator('[data-plan-view="overlay"]').click();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1200);
    await shot(page, "18-plan-overlay.png");
  });
});

test.describe("docs screenshots — Agent Manager", () => {
  test.skip(!SHOTS || !FIX.includes("hooked_demo"), "VG_DOCS_SHOTS=1 VG_FIXTURE=test/fixtures/hooked_run/hooked_demo (+ the stub claude)");
  test.setTimeout(120_000);
  test("a Claude Code run with the hooks: the block, then the server's evidence", async ({ page }) => {
    await boot(page);
    await page.click("[data-work-run-toggle]");
    await page.locator("[data-work-run-task]").fill("add a wipe() to app.py that calls store.purge");
    await page.click("[data-hooked-start]");
    await expect(page.locator("[data-hooked-status]")).toHaveAttribute("data-hooked-status", "awaiting-review", { timeout: 60_000 });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(800);
    await shot(page, "12-agent-manager.png");
    await page.click("[data-hooked-reject]");
    await expect(page.locator("[data-hooked-status]")).toHaveAttribute("data-hooked-status", "rejected", { timeout: 30_000 });
  });
});

// Terminal output, rendered from the REAL command output the script captured
// (VG_DOCS_TERM = a directory of <name>.txt files).
test.describe("docs screenshots — terminal", () => {
  const dir = process.env.VG_DOCS_TERM ?? "";
  test.skip(!SHOTS || !dir || !existsSync(dir), "VG_DOCS_SHOTS=1 VG_DOCS_TERM=<dir of captured output>");
  for (const [file, title, png] of [
    ["hook.txt", "UserPromptSubmit hook — what Claude receives with the prompt", "13-hook-context.png"],
    ["check.txt", "vibegraph-knowledge check", "14-check.png"],
    ["dataflow.txt", "vibegraph-knowledge dataflow", "15-dataflow.png"],
  ] as const) {
    test(`terminal: ${file}`, async ({ page }) => {
      const path = join(dir, file);
      test.skip(!existsSync(path), `${path} not captured`);
      const text = readFileSync(path, "utf-8");
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      await page.setViewportSize({ width: 1500, height: 940 });
      await page.setContent(`<!doctype html><html><head><style>
        @font-face { font-family: JBM; src: local("JetBrains Mono"), local("DejaVu Sans Mono"); }
        html,body { margin:0; background:#101114; }
        .win { margin:24px; border:1px solid #2a2d34; border-radius:12px; overflow:hidden; background:#16181d; }
        .bar { display:flex; align-items:center; gap:8px; padding:12px 16px; border-bottom:1px solid #2a2d34; color:#8b919c; font:13px Inter, system-ui, sans-serif; }
        .dot { width:12px; height:12px; border-radius:50%; background:#2f333b; }
        .t { margin-left:8px; }
        pre { margin:0; padding:20px 24px; color:#d7dae0; font:13px/1.55 JBM, "DejaVu Sans Mono", monospace; white-space:pre-wrap; word-break:break-word; }
        .k { color:#5fd4c4; } .w { color:#e8b86a; } .e { color:#ef7f7f; } .m { color:#8b919c; }
      </style></head><body><div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="t">${esc(title)}</span></div><pre>${
        esc(text)
          .replace(/^(\$ .*)$/gm, '<span class="k">$1</span>')
          .replace(/(VIOLATED|UNGUARDED|\[UNGUARDED\])/g, '<span class="e">$1</span>')
          .replace(/(UNVERIFIABLE|review\b)/g, '<span class="w">$1</span>')
          .replace(/\b(PASS)\b/g, '<span class="k">$1</span>')
      }</pre></div></body></html>`);
      const box = await page.locator(".win").boundingBox();
      await page.screenshot({ path: join(OUT, png), clip: { x: 0, y: 0, width: 1500, height: Math.min(940, Math.ceil((box?.y ?? 0) + (box?.height ?? 900) + 24)) } });
    });
  }
});
