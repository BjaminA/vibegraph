/**
 * M-STACK.3 (PLAN-M-STACK.md) — the Stack panel, end to end on the
 * four-language polyglot fixture.
 *
 * Proves the two halves stay apart on screen and on disk:
 *   * the panel lists the project's tools BY ROLE from the live index —
 *     python imports (flask, requests), a TS specifier (express), bash
 *     command words (curl, psql), a C++ include (gtest/gtest.h) — with
 *     the project FUNNEL (api.db wrapping sqlite3) named as such;
 *   * "state a policy" WRITES NOTHING: it opens the constraint form
 *     pre-filled with the tool, because a policy is a human decision, not
 *     a consequence of a fact;
 *   * confirming lands a `stack-policy` constraint in
 *     .vibegraph/constraints.json with scope.stack + the structured
 *     policy, and the panel then shows it bound under that tool.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/polyglot/shop_demo VG_PORT=4294 PORT=4294 \
 *     npx playwright test test/e2e/m-stack-panel.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_POLYGLOT = FIXTURE.includes("shop_demo");
const CONSTRAINTS_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "constraints.json");

test.describe("M-STACK — the Stack panel: facts, and the policies stated about them", () => {
  test.skip(!IS_POLYGLOT, "Requires the polyglot shop_demo fixture");

  test.beforeAll(() => rmSync(CONSTRAINTS_FILE, { force: true }));
  test.afterAll(() => rmSync(CONSTRAINTS_FILE, { force: true }));

  test("the panel lists tools by role from the index; stating a policy from it lands on disk", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 20_000 });

    // ── the facts ────────────────────────────────────────────────────
    await page.click("[data-stack-toggle]");
    const panel = page.locator("[data-stack-panel]");
    await expect(panel).toBeVisible();

    // One index, four frontends' evidence.
    await expect(panel.locator('[data-stack-tool="flask"]')).toBeVisible();
    await expect(panel.locator('[data-stack-tool="requests"]')).toBeVisible();
    await expect(panel.locator('[data-stack-tool="express"]')).toBeVisible();
    await expect(panel.locator('[data-stack-tool="curl"]')).toBeVisible();
    await expect(panel.locator('[data-stack-tool="psql"]')).toBeVisible();
    await expect(panel.locator('[data-stack-tool="gtest/gtest.h"]')).toBeVisible();

    // Grouped by role, and the roles are the taxonomy's.
    await expect(panel.locator('[data-stack-role-group="web-framework"]')).toBeVisible();
    await expect(panel.locator('[data-stack-role-group="http-client"]')).toBeVisible();
    await expect(panel.locator('[data-stack-role-group="db"]')).toBeVisible();

    // The project FUNNEL is a fact with its own origin, named as a wrapper.
    const funnel = panel.locator('[data-stack-tool="api.db"]');
    await expect(funnel).toBeVisible();
    await expect(funnel).toHaveAttribute("data-stack-origin", "project");
    await expect(funnel).toContainText("project funnel wrapping sqlite3");

    // M-BOUNDARY.2 - presence and USE are shown as different facts. sqlite3
    // is reached through the api.db funnel, so it is called; a tool whose
    // files a thread merely walks says "present ... not called".
    const called = panel.locator('[data-stack-called="sqlite3"]');
    await expect(called).toBeVisible();
    await expect(called).toContainText("called on");
    await expect(panel.locator('[data-stack-called="api.db"]')).toContainText("called on");

    // Every fact carries its evidence count — never a bare claim.
    await expect(panel.locator('[data-stack-evidence="requests"]')).toContainText("site(s)");

    // ── stating a policy: the panel writes NOTHING itself ────────────
    expect(existsSync(CONSTRAINTS_FILE)).toBe(false);
    await page.click('[data-stack-state-policy="sqlite3"]');
    expect(existsSync(CONSTRAINTS_FILE)).toBe(false);

    // It opened the ONE constraint form, pre-filled with the tool.
    const form = page.locator("[data-constraint-form]");
    await expect(form).toBeVisible();
    await expect(page.locator("[data-constraint-kind]")).toHaveValue("stack-policy");
    await expect(page.locator("[data-constraint-policy-tool]")).toHaveValue("sqlite3");
    await expect(page.locator('[data-stack-scope-chip="sqlite3"]')).toBeVisible();

    await page.selectOption("[data-constraint-rule]", "replace-with");
    await page.fill("[data-constraint-policy-with]", "api.db");
    await page.fill(
      "[data-constraint-text]",
      "Database access goes through api/db.py; no other module opens its own sqlite3 connection.",
    );
    await page.click("[data-constraint-add]");

    // ── on disk: the structured policy + the DYNAMIC tool scope ──────
    await expect.poll(() => existsSync(CONSTRAINTS_FILE), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => {
      const stored = JSON.parse(readFileSync(CONSTRAINTS_FILE, "utf-8")).constraints ?? [];
      return stored[0]?.policy?.with ?? null;
    }, { timeout: 10_000 }).toBe("api.db");

    const stored = JSON.parse(readFileSync(CONSTRAINTS_FILE, "utf-8")).constraints;
    expect(stored).toHaveLength(1);
    expect(stored[0].kind).toBe("stack-policy");
    expect(stored[0].source).toBe("human");
    expect(stored[0].scope).toEqual({ stack: ["sqlite3"] });
    expect(stored[0].policy).toEqual({ tool: "sqlite3", rule: "replace-with", with: "api.db" });

    // ── and the panel now shows it bound under the tool it concerns ──
    await page.click("[data-work-run-close]");
    await page.click("[data-stack-toggle]");
    await page.click("[data-stack-toggle]");
    const bound = page.locator(`[data-stack-policy="sqlite3:${stored[0].id}"]`);
    await expect(bound).toBeVisible();
    await expect(bound).toContainText("replace sqlite3 with api.db");
    await expect(bound).toContainText("human-stated");
    // The fact above it is untouched: a policy never overwrites a fact.
    await expect(page.locator('[data-stack-tool="sqlite3"]')).toHaveAttribute("data-stack-origin", "stdlib");
  });
});
