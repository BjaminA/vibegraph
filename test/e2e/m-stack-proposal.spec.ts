/**
 * M-STACK.4 (PLAN-M-STACK.md) — the brief proposes a TOOL the project
 * stack does not have; the human confirms it with the objective; it
 * becomes a stated policy. Nothing installs anything.
 *
 * Proves, on the gate and on disk:
 *   * the objective gate renders the proposal WITH the alternatives it
 *     rejected — the human is confirming a decision, not a preference;
 *   * before the confirm, .vibegraph/constraints.json does NOT carry it;
 *   * confirming stores it as a `stack-policy` with source
 *     "orchestrator", the structured policy, and a scope that includes
 *     the tool itself (so it keeps applying to whatever adopts it);
 *   * the run's note says the tools were stored and nothing was installed.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4296 PORT=4296 \
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/work_run/fake_worker.mjs" \
 *   FAKE_EDIT_FILE=models.py FAKE_EDIT_NODE=module/list_users.fn \
 *   FAKE_REQUIRE_HANDOFF=1 FAKE_STACK_PROPOSAL=redis \
 *     npx playwright test test/e2e/m-stack-proposal.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const STUBBED = !!process.env.FAKE_STACK_PROPOSAL;
const PROPOSED = process.env.FAKE_STACK_PROPOSAL ?? "redis";
const MODELS = join(process.cwd(), FIXTURE, "models.py");
const RUN_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "work-run.json");
const SNAP_DIR = join(process.cwd(), FIXTURE, ".vibegraph", "work-snapshots");
const CONSTRAINTS_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "constraints.json");

const constraints = () =>
  (existsSync(CONSTRAINTS_FILE) ? JSON.parse(readFileSync(CONSTRAINTS_FILE, "utf-8")).constraints ?? [] : []);

test.describe("M-STACK.4 — the brief proposes a tool; the human confirms it into a policy", () => {
  test.skip(!IS_FLASK || !STUBBED, "Requires flask_demo + fake_worker with FAKE_STACK_PROPOSAL");

  let original = "";
  test.beforeAll(() => {
    original = readFileSync(MODELS, "utf-8");
    rmSync(CONSTRAINTS_FILE, { force: true });
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
  });
  test.afterAll(() => {
    writeFileSync(MODELS, original, "utf-8");
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
    rmSync(CONSTRAINTS_FILE, { force: true });
  });

  test("the proposal is shown with its alternatives, and only the confirm writes it", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    await page.click("[data-work-run-toggle]");
    await page.click("[data-work-run-mode-orchestrated]");
    await page.fill("[data-work-run-task]", "tidy `list_users` bookkeeping in models.py");
    await page.click("[data-work-run-start]");

    const gate = page.locator("[data-orchestration-gate]");
    await expect(gate).toHaveAttribute("data-orchestration-status", "ready", { timeout: 60_000 });

    // The proposal is at the gate, with what it rejected and why.
    const proposal = page.locator(`[data-orchestration-stack-proposal="${PROPOSED}"]`);
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText(PROPOSED);
    await expect(proposal).toContainText("considered instead: sqlite3");
    await expect(page.locator("[data-orchestration-stack-proposals]"))
      .toContainText("confirming states them as policies, it installs nothing");

    // Nothing is stored before the human confirms.
    expect(constraints().some((c: any) => c.policy?.tool === PROPOSED)).toBe(false);

    await page.click("[data-work-run-ratify]");

    // On confirm: a stack-policy, orchestrator-stated, scoped by the tool.
    await expect.poll(() => constraints().some((c: any) => c.policy?.tool === PROPOSED), { timeout: 30_000 }).toBe(true);
    const stored = constraints().find((c: any) => c.policy?.tool === PROPOSED);
    expect(stored.kind).toBe("stack-policy");
    expect(stored.source).toBe("orchestrator");
    expect(stored.policy.rule).toBe("prefer");
    expect(stored.policy.role).toBe("cache");
    expect(stored.scope.stack).toEqual([PROPOSED]);
    expect(stored.scope.all).toBe(true);
    expect(stored.note).toMatch(/nothing was installed/);
    expect(stored.text).toMatch(/Considered instead: sqlite3/);

    // And the board lists it beside the other stated constraints, with
    // its imperative and its orchestrator provenance — a confirmed
    // proposal is a policy like any other, not a hidden setting.
    const row = page.locator(`[data-constraint-row="${stored.id}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toHaveAttribute("data-constraint-source", "orchestrator");
    await expect(row.locator(`[data-constraint-policy="${stored.id}"]`)).toContainText(`prefer ${PROPOSED}`);
  });
});
