/**
 * M-AGENT2 (PLAN-M-AGENT.md) — the Agent Manager run board, living
 * renderer:
 *
 *  1. toolbar → board → task → DRAFT gate (packets + coverage gaps,
 *     nothing running);
 *  2. Ratify → stub packets advance SERIALLY through review gates —
 *     evidence renders (labelled self-report + real assertion counts);
 *  3. Approve/Reject drive the run; a reject leaves the outcome
 *     honestly FAILED;
 *  4. a seeded run file with an ESCALATED packet renders the amber
 *     escalation card with its reason after a reload.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4280 PORT=4280 \
 *     npx playwright test test/e2e/m-agent2-run-board.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const RUN_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "work-run.json");

test.describe("M-AGENT2 — the run board", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");
  test.afterEach(() => rmSync(RUN_FILE, { force: true }));

  // 2026-09-25: in a short window the scrolling form squeezed the task box to
  // a sliver that cut its placeholder in half. It holds three rows, grows with
  // what is typed, and never scrolls — the form around it does.
  test("the task box is never squeezed and never hides what is typed", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click("[data-work-run-toggle]");
    const box = page.locator("[data-work-run-task]");
    await expect(box).toBeAttached();
    const fit = () => box.evaluate((el: HTMLTextAreaElement) => ({
      h: el.clientHeight, over: el.scrollHeight - el.clientHeight,
      rows: el.clientHeight / (parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2),
    }));
    const empty = await fit();
    expect(empty.rows, "at least three rows when empty").toBeGreaterThanOrEqual(3);
    expect(empty.over, "the placeholder is not cut").toBeLessThanOrEqual(1);
    await box.fill(Array.from({ length: 9 }, (_, i) => `line ${i + 1}: harden \`create_user\` in app.py`).join("\n"));
    const full = await fit();
    expect(full.h, "grows with the text").toBeGreaterThan(empty.h);
    expect(full.over, "a long task is shown whole").toBeLessThanOrEqual(1);
  });

  test("launch → draft gate → ratify → evidence gates → honest failed outcome", async ({ page }) => {
    rmSync(RUN_FILE, { force: true });
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    await page.click("[data-work-run-toggle]");
    const panel = page.locator("[data-work-run-panel]");
    await expect(panel).toBeVisible();

    await page.fill("[data-work-run-task]", "harden `create_user` and `list_users` in app.py");
    await page.click("[data-work-run-start]");

    // The DRAFT gate: packets visible, nothing has run.
    const gate = page.locator("[data-work-run-gate]");
    await expect(gate).toBeVisible({ timeout: 10_000 });
    await expect(panel).toHaveAttribute("data-run-status", "draft");
    const draftPackets = await page.locator("[data-packet-card]").count();
    expect(draftPackets).toBeGreaterThan(1);
    await expect(page.locator('[data-packet-card][data-packet-status="pending"]')).toHaveCount(draftPackets);

    // Ratify → the stub advances serially; gates arrive one at a time.
    await page.click("[data-work-run-ratify]");
    const firstGate = page.locator('[data-packet-card][data-packet-status="awaiting-review"]');
    await expect(firstGate).toHaveCount(1, { timeout: 10_000 });

    // Evidence: the labelled self-report + REAL structural facts.
    // (M-AGENT3: the worker is the stubbed session declared in the npm
    // script's FAKE_SYNTH_RESPONSE — a done block with no edits.)
    const evidence = page.locator("[data-packet-evidence]");
    await expect(evidence).toContainText("board-stub: reviewed, no edits");
    await expect(evidence).toContainText("assertions:");
    await expect(evidence).toContainText("self-consistency, not conformance to external reality");

    // Approve the first gate; REJECT the second TWICE — M-AGENT4's
    // bounded retry sends the first rejection back for one re-draft
    // (the card shows attempt 2), and only the second rejection fails it.
    await page.click("[data-packet-approve]");
    await expect(page.locator('[data-packet-card][data-packet-status="done"]')).toHaveCount(1, { timeout: 10_000 });

    const secondGate = page.locator('[data-packet-card][data-packet-status="awaiting-review"]');
    await secondGate.waitFor({ state: "visible", timeout: 10_000 });
    const rejectedId = await secondGate.getAttribute("data-packet-card");
    await page.click("[data-packet-reject]");
    // The SAME packet returns to the gate as attempt 2, not failed.
    const retryGate = page.locator(`[data-packet-card="${rejectedId}"][data-packet-status="awaiting-review"]`);
    await retryGate.waitFor({ state: "visible", timeout: 15_000 });
    await expect(retryGate).toContainText("attempt 2");
    await page.click("[data-packet-reject]");
    await expect(page.locator(`[data-packet-card="${rejectedId}"][data-packet-status="failed"]`))
      .toBeVisible({ timeout: 10_000 });

    for (let i = 0; i < draftPackets + 2; i++) {
      const btn = page.locator("[data-packet-approve]");
      if (await btn.count() === 0) break;
      await btn.click();
      await page.waitForTimeout(300);
    }

    // The run finishes and never claims success with a failed packet.
    await expect(page.locator("[data-work-run-outcome]")).toBeVisible({ timeout: 15_000 });
    await expect(panel).toHaveAttribute("data-run-status", "failed");
    await expect(page.locator("[data-work-run-outcome]"))
      .toContainText("an incomplete run never claims success");
  });

  test("a seeded escalated packet renders the amber card with its reason", async ({ page }) => {
    const packet = (id: string, order: number, status: string) => ({
      id, status, attempts: 1,
      plan: {
        order, entryPointId: `app.py:handler${order}`, qualifiedName: `app:handler${order}`,
        kind: "route", matchedOn: ["handler"], score: 1, filesReached: ["app.py"],
        boundaries: {
          staticallyComplete: true, resolutionGaps: 0, runtimeDispatch: 0,
          uncaptured: 0, dependsOn: [], outsidePlan: { reaches: [], reachedBy: [] },
        },
        skill: { status: "none", note: "" },
      },
      evidence: null,
      escalation: status === "escalated"
        ? { reason: "needs the payments service outside this plan" } : null,
    });
    mkdirSync(join(process.cwd(), FIXTURE, ".vibegraph"), { recursive: true });
    writeFileSync(RUN_FILE, JSON.stringify({
      version: "1", task: "seeded escalation render", createdAt: new Date().toISOString(),
      status: "paused", unmatchedTokens: [], cycles: [], planNote: "seeded",
      packets: [packet("p1", 1, "done"), packet("p2", 2, "escalated")],
    }));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click("[data-work-run-toggle]");

    const esc = page.locator("[data-packet-escalation]");
    await expect(esc).toBeVisible({ timeout: 10_000 });
    await expect(esc).toContainText("needs the payments service outside this plan");
    await expect(esc).toContainText("stopped at its boundary instead of guessing");
    await expect(page.locator("[data-escalation-resolve]")).toBeVisible();
    await expect(page.locator("[data-escalation-fail]")).toBeVisible();
  });
});
