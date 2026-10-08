/**
 * The GUI brief's acceptance tests (2026-10-05): kinds and chips, one panel
 * sheet, concise plan items, the Rules panel. Fixture: a ledger project with
 * a plan (a process at a folder, its identity, a store with two zones), a
 * declared topology, and three stated rules — one agent-stated, one with an
 * open proposal — so two reviews wait for a person.
 *
 *   VG_FIXTURE=test/fixtures/gui/gui_demo VG_PORT=4307 PORT=4307 \
 *     npx playwright test test/e2e/gui-design.spec.ts --workers=1
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_GUI = FIXTURE.includes("gui_demo");
const ROOT = resolve(FIXTURE || ".");
const RULES_FILE = join(ROOT, ".vibegraph", "constraints.json");
const CLI = resolve("scripts/cli/main.mjs");
const cli = (args: string[], cwd: string) =>
  execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", CLI, ...args], { cwd, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", VG_PERSON_NO_TTY: "1" } }); // the test acts as the person (0.28's no-terminal guard)
const person = () => { try { return execFileSync("git", ["config", "user.name"], { cwd: ROOT, encoding: "utf-8" }).trim() || userInfo().username; } catch { return userInfo().username; } };

async function openApp(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-top-toolbar]", { timeout: 30_000 });
  const banner = page.locator("[data-key-banner]");
  if (await banner.count()) await banner.locator("button").click();
  await expect(page.locator("[data-rules-toggle]")).toBeVisible({ timeout: 30_000 });
}

/** The sheet's rectangle and its computed background. */
const sheetBox = (page: Page) => page.locator("[data-panel-sheet]").boundingBox();

/** A CSS colour (any syntax the browser computes) composited over another, as sRGB. */
async function rgbOver(page: Page, top: string, under: string): Promise<[number, number, number]> {
  return page.evaluate(([t, u]) => {
    const c = document.createElement("canvas"); c.width = c.height = 1;
    const x = c.getContext("2d")!;
    x.fillStyle = u; x.fillRect(0, 0, 1, 1);
    x.fillStyle = t; x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]] as [number, number, number];
  }, [top, under]);
}
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test.describe("the GUI brief: kinds, one panel sheet, concise plan, rules", () => {
  test.skip(!IS_GUI, "Requires VG_FIXTURE=test/fixtures/gui/gui_demo");
  test.use({ viewport: { width: 1600, height: 1000 } });
  let saved = "";
  test.beforeAll(() => { saved = readFileSync(RULES_FILE, "utf-8"); });
  test.afterEach(() => { writeFileSync(RULES_FILE, saved); });

  test("1. a Rules button counts what awaits a person and opens a centred sheet", async ({ page }) => {
    await openApp(page);
    await expect(page.locator("[data-rules-badge]")).toHaveText("2"); // c3 (agent-stated) + c1's proposal p1
    await page.locator("[data-rules-toggle]").click();
    await expect(page.locator('[data-panel-sheet="rules"]')).toBeVisible();
    const b = (await sheetBox(page))!;
    expect(Math.abs(b.x + b.width / 2 - 800)).toBeLessThanOrEqual(8);
    expect(Math.abs(b.y + b.height / 2 - 500)).toBeLessThanOrEqual(8);
    expect(b.width).toBeGreaterThanOrEqual(900);
    expect(b.height).toBeGreaterThanOrEqual(600);
    await expect(page.locator('[data-sheet-badge="rules"]')).toContainText("2");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-panel-sheet]")).toHaveCount(0);
  });

  test("2. each rule shows its id, who stated it and the verdict `check` prints; Accept writes what `constraint accept` writes", async ({ page }) => {
    const printed = cli(["check"], ROOT);
    await openApp(page);
    await page.locator("[data-rules-toggle]").click();
    await page.locator('[data-sheet-nav-item="all"]').click();
    for (const id of ["c1", "c3"]) {
      const verdict = new RegExp(`\\[${id}\\][^\\n]*→ (pass|VIOLATED|UNVERIFIABLE)`).exec(printed)![1].toLowerCase();
      const row = page.locator(`[data-rule-row="${id}"]`);
      await expect(row.locator(`[data-chip="rule"][data-chip-ref="${id}"]`)).toBeVisible();
      await expect(row.locator("[data-rule-live]")).toHaveAttribute("data-rule-live", verdict);
    }
    await expect(page.locator('[data-rule-row="c1"]')).toHaveAttribute("data-constraint-source", "human");
    await expect(page.locator('[data-rule-row="c3"] [data-verdict="agent"]')).toContainText("agent · not reviewed");
    await expect(page.locator('[data-rule-row="c2"]')).toHaveAttribute("data-rule-verdict", "prose");
    // c1's rule bullet is drawn with chips: the function and the file.
    await expect(page.locator('[data-rule-row="c1"] [data-item-bullet="rule"] [data-chip="function"]')).toHaveText("appoint");
    await expect(page.locator('[data-rule-row="c1"] [data-item-bullet="rule"] [data-chip="path"]')).toHaveText("tools/assign-approver.ts");

    // The CLI's accept, on a copy of the same file: the reference result.
    const ref = mkdtempSync(join(tmpdir(), "vg-accept-"));
    mkdirSync(join(ref, ".vibegraph"));
    copyFileSync(RULES_FILE, join(ref, ".vibegraph", "constraints.json"));
    cli(["constraint", "accept", "c1", "p1", ref], ref);
    const want = JSON.parse(readFileSync(join(ref, ".vibegraph", "constraints.json"), "utf-8")).constraints.find((c: { id: string }) => c.id === "c1");

    await page.locator('[data-sheet-nav-item="awaiting"]').click();
    await expect(page.locator('[data-rule-proposal="c1:p1"] [data-rule-diff]')).toContainText("tools/remove-approver.ts");
    await page.locator('[data-rule-accept="c1:p1"]').click();
    await expect(page.locator("[data-rules-message]")).toContainText("accepted p1");
    const got = JSON.parse(readFileSync(RULES_FILE, "utf-8")).constraints.find((c: { id: string }) => c.id === "c1");
    const strip = (c: Record<string, unknown>) => ({ ...c, changes: (c.changes as Array<Record<string, unknown>>).map(({ at, ...rest }) => rest) });
    expect(strip(got)).toEqual(strip(want));
    expect(got.changes.at(-1).who).toBe(person());
    await expect(page.locator("[data-rules-badge]")).toHaveText("1");
    await page.locator('[data-sheet-nav-item="history"]').click();
    await expect(page.locator("[data-rules-history]").first()).toContainText(person());
  });

  // 2026-10-08 (Ben: "remove multi colour — keep in theme with the app"): the
  // panels were tinted apart; they now share the app's surface, told apart by
  // title and icon, so all four backgrounds are the same.
  test("3. Plan, Rules, Stack and Agent Manager share one frame; the switcher moves between them; one surface colour", async ({ page }) => {
    await openApp(page);
    await page.locator("[data-plan-toggle]").click();
    const first = (await sheetBox(page))!;
    const bgs: string[] = [];
    const node = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg-node").trim());
    for (const id of ["plan", "rules", "stack", "agents"]) {
      if (id !== "plan") await page.locator(`[data-sheet-tab="${id}"]`).click();
      await expect(page.locator(`[data-panel-sheet="${id}"]`)).toBeVisible();
      expect(await sheetBox(page)).toEqual(first);
      const bg = await page.locator("[data-panel-sheet]").evaluate((el) => getComputedStyle(el).backgroundColor);
      bgs.push(bg);
      const [a, b] = [await rgbOver(page, bg, "black"), await rgbOver(page, node, "black")];
      for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i]) / 255).toBeLessThanOrEqual(0.07);
    }
    expect(new Set(bgs).size).toBe(1);
  });

  test("4. a plan item has at most three bullets above its fold, none wraps past two lines, the prose is folded", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await openApp(page);
    await page.locator("[data-plan-toggle]").click();
    const items = page.locator("[data-plan-panel] [data-plan-item]");
    await expect(items.first()).toBeVisible({ timeout: 15_000 });
    const n = await items.count();
    expect(n).toBeGreaterThan(3);
    for (let i = 0; i < n; i++) {
      const it = items.nth(i);
      expect(await it.locator(":scope > ul > li").count()).toBeLessThanOrEqual(3);
      for (const h of await it.locator(":scope > ul > li > span").evaluateAll((els) => els.map((e) => [e.getBoundingClientRect().height, parseFloat(getComputedStyle(e).lineHeight)]))) {
        expect(h[0]).toBeLessThanOrEqual(2 * h[1] + 2);
      }
      const prose = it.locator("[data-plan-detail]");
      if (await prose.count()) {
        expect(await it.locator(":scope > details").evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
        await expect(prose).toBeHidden();
      }
    }
    await expect(page.locator('[data-plan-item="processes:order-service"] summary')).toContainText("Why realised");
    // The scorecard filters.
    await page.locator('[data-plan-counts] [data-verdict="not-built"]').click();
    await expect(page.locator('[data-plan-panel] [data-plan-item="processes:audit-feed"]')).toBeVisible();
    await expect(page.locator('[data-plan-panel] [data-plan-item="processes:order-service"]')).toHaveCount(0);
  });

  for (const theme of ["dark", "light", "system-light"] as const) {
    test(`5. every chip reads at 4.5:1 or better on its own fill (${theme})`, async ({ page }) => {
      if (theme === "system-light") await page.emulateMedia({ colorScheme: "light" });
      await page.addInitScript((t) => { try { localStorage.setItem("vg-theme", t === "system-light" ? "system" : t); } catch { /* */ } }, theme);
      await openApp(page);
      if (theme === "system-light") expect(await page.evaluate(() => document.documentElement.hasAttribute("data-theme"))).toBe(false);
      await page.locator("[data-plan-toggle]").click();
      await page.locator("[data-sheet-key]").click(); // the legend: one chip of every kind
      const chips = page.locator("[data-panel-sheet] .vg-chip");
      await expect(chips.first()).toBeVisible({ timeout: 15_000 });
      const sheetBg = await page.locator("[data-panel-sheet]").evaluate((el) => getComputedStyle(el).backgroundColor);
      const base = await rgbOver(page, sheetBg, "white");
      const seen = new Set<string>();
      for (const c of await chips.evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute("data-chip"), fg: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor })))) {
        const fill = await rgbOver(page, c.bg, `rgb(${base.join(",")})`);
        const fg = await rgbOver(page, c.fg, `rgb(${fill.join(",")})`);
        expect(contrast(fg, fill), `${c.kind} chip`).toBeGreaterThanOrEqual(4.5);
        seen.add(String(c.kind));
      }
      for (const k of ["process", "function", "module", "store", "zone", "path", "type", "json", "xml", "identity", "config", "external", "rule", "question"]) expect(seen.has(k), k).toBe(true);
    });
  }

  test("6. order-service shows a path, an identity and a zone chip, and each focuses its object", async ({ page }) => {
    await openApp(page);
    const item = '[data-plan-item="processes:order-service"]';
    const open = async () => { await page.locator("[data-plan-toggle]").click(); await expect(page.locator(item)).toBeVisible({ timeout: 15_000 }); };
    await open();
    await expect(page.locator(`${item} [data-chip="path"][data-chip-ref="order_service/"]`)).toBeVisible();
    await expect(page.locator(`${item} [data-chip="identity"][data-chip-ref="order-service"]`)).toBeVisible();
    await expect(page.locator(`${item} [data-chip="zone"][data-chip-ref="ledger/status"]`)).toHaveAttribute("data-dashed", "true");

    await page.locator(`${item} [data-chip="zone"][data-chip-ref="ledger/status"]`).click();
    await expect(page.locator("[data-panel-sheet]")).toHaveCount(0);
    await expect(page.locator('[data-arch-id="topo:zone:status"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-arch-inspector]")).toContainText("status");

    await open();
    await page.locator(`${item} [data-chip="identity"][data-chip-ref="order-service"]`).click();
    await expect(page.locator("[data-arch-inspector]")).toContainText("order-service", { timeout: 20_000 });

    await open();
    await page.locator(`${item} [data-chip="path"][data-chip-ref="order_service/"]`).click();
    await expect(page.locator("[data-panel-sheet]")).toHaveCount(0);
    await expect(page.getByText("decide.ts", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  });

  test("7. at 390 px the sheet has no sideways scroll and its navigation sits above the content", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await page.locator("[data-rules-toggle]").click();
    const sheet = page.locator("[data-panel-sheet]");
    await expect(sheet).toBeVisible();
    const over = await sheet.evaluate((el) => [...el.querySelectorAll("*")].filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1 && getComputedStyle(e).overflowX !== "visible" && getComputedStyle(e).overflowX !== "hidden").map((e) => e.className || e.tagName));
    expect(over).toEqual([]);
    const sb = (await sheet.boundingBox())!;
    expect(sb.x).toBeGreaterThanOrEqual(0);
    expect(sb.x + sb.width).toBeLessThanOrEqual(390);
    const nav = (await page.locator("[data-sheet-nav]").boundingBox())!;
    const content = (await page.locator("[data-sheet-content]").boundingBox())!;
    expect(nav.y + nav.height).toBeLessThanOrEqual(content.y + 1);
  });

  test("the thread view lists the rules on its thread", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-thread-index-row][data-entry-id^="bin/order-service.ts"]').first().click();
    await expect(page.locator("[data-thread-rules-chip]")).toBeVisible({ timeout: 20_000 });
    await page.locator("[data-thread-rules-chip]").click();
    await expect(page.locator('[data-thread-rule="c1"]')).toBeVisible();
  });
});
