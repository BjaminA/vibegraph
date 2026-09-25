/**
 * M-ORCH.3 (PLAN-M-CONTRACT.md) — SYSTEM PACKETS end-to-end: the brief
 * proposes work no thread owns (a NEW module), the human confirms it with
 * the objective, a bounded worker CREATES the module through the
 * chokepoint (vibegraph_create_file), the orchestrator REJECTS the first
 * attempt (the created file is deleted — Reject undoes creations too), the
 * bounded retry re-creates it, the review approves, the run ends clean.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4288 PORT=4288 \
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/work_run/fake_worker.mjs" \
 *   FAKE_EDIT_FILE=models.py FAKE_EDIT_NODE=module/list_users.fn FAKE_REQUIRE_HANDOFF=1 \
 *   FAKE_SYSTEM_PACKET=orchestrator_notes.py FAKE_REVIEW_SYSTEM_FIRST=reject \
 *     npx playwright test test/e2e/m-orch-system.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const SYSTEM_FILE = process.env.FAKE_SYSTEM_PACKET ?? "";
const STUBBED = (process.env.VG_CLAUDE_BIN ?? "").includes("fake_worker") && !!SYSTEM_FILE;
const MODELS = join(process.cwd(), FIXTURE, "models.py");
const CREATED = join(process.cwd(), FIXTURE, SYSTEM_FILE);
const RUN_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "work-run.json");
const SNAP_DIR = join(process.cwd(), FIXTURE, ".vibegraph", "work-snapshots");
const CONSTRAINTS_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "constraints.json");

test.describe("M-ORCH.3 — system packets: proposed by the brief, confirmed by the human, created through the chokepoint", () => {
  test.skip(!IS_FLASK || !STUBBED, "Requires flask_demo + fake_worker stub with FAKE_SYSTEM_PACKET");

  let original = "";
  test.beforeAll(() => {
    original = readFileSync(MODELS, "utf-8");
    rmSync(CREATED, { force: true });
    rmSync(CONSTRAINTS_FILE, { force: true });
    // M-ORCH.4 — the spec before this one in the chain may still be tearing down; never inherit its run.
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
  });
  test.afterAll(() => {
    writeFileSync(MODELS, original, "utf-8");
    rmSync(CREATED, { force: true });
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
    rmSync(CONSTRAINTS_FILE, { force: true });
  });

  test("the proposed module is created, deleted on reject, re-created on retry, and the run ends clean", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    await page.click("[data-work-run-toggle]");
    await page.click("[data-work-run-mode-orchestrated]");
    await page.fill("[data-work-run-task]", "tidy `list_users` bookkeeping in models.py");
    await page.click("[data-work-run-start]");

    // The objective gate shows the proposed system packet BEFORE anything exists on disk.
    await expect(page.locator("[data-orchestration-gate]")).toHaveAttribute("data-orchestration-status", "ready", { timeout: 15_000 });
    await expect(page.locator('[data-orchestration-system-packet="x1"]')).toContainText(SYSTEM_FILE);
    expect(existsSync(CREATED)).toBe(false);

    await page.click("[data-work-run-ratify]");

    // The system packet card appears (materialised on confirm) with its chip.
    await expect(page.locator('[data-packet-card="x1"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-packet-card="x1"] [data-packet-system]')).toContainText("system packet");

    await expect(page.locator("[data-work-run-panel]"))
      .toHaveAttribute("data-run-status", "done", { timeout: 90_000 });

    const run = JSON.parse(readFileSync(RUN_FILE, "utf-8"));
    const x1 = run.packets.find((p) => p.id === "x1");
    expect(x1).toBeTruthy();
    expect(x1.plan.kind).toBe("system");
    expect(x1.plan.origin).toBe("brief");
    expect(x1.plan.filesReached).toEqual([SYSTEM_FILE]);
    expect(x1.plan.boundaries.dependsOn.length).toBeGreaterThanOrEqual(1); // after p1 (the brief's `after`)
    // attempt 1 was REJECTED (created file deleted), attempt 2 approved.
    expect(x1.attempts).toBe(2);
    expect(x1.status).toBe("done");
    expect(x1.review?.by).toBe("orchestrator");
    expect(x1.review?.verdict).toBe("approve");
    // the evidence names the CREATED file: whole-file diff + a created IR delta
    expect(x1.evidence.diffs.map((d) => d.file)).toEqual([SYSTEM_FILE]);
    expect(x1.evidence.diffs[0].diff).toContain("+NOTE = ");
    expect(JSON.stringify(x1.evidence.irDelta)).toContain('"created":true');
    // the module is on disk with the retry's marker, parsed through the chokepoint
    const created = readFileSync(CREATED, "utf-8");
    expect(created).toMatch(/NOTE = "orchestrator-system-marker-\d+-\d{13}"/);
    // every thread packet still went its normal way
    for (const p of run.packets.filter((q) => q.id !== "x1")) {
      expect(["done", "no-change"]).toContain(p.status);
    }
    expect(run.summary.note).toContain("approved");
    await expect(page.locator("[data-work-run-summary]")).toContainText("by the orchestrator");
  });
});
