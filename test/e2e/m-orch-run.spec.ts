/**
 * M-ORCH (PLAN-M-CONTRACT.md) — the orchestrated run, end-to-end with ONE
 * scripted stub playing all three roles (fake_worker.mjs keys on the
 * prompt): the ORCHESTRATOR drafts the brief, the WORKER edits through
 * the real MCP chokepoint ONLY when its prompt carries the orchestrator's
 * HANDOFF (FAKE_REQUIRE_HANDOFF), and the REVIEWER approves each packet.
 *
 * Proves, on disk and on the board:
 *   * the objective gate shows the brief (objective + per-packet handoff)
 *     and the human confirms ONCE — no Approve click ever happens;
 *   * confirmation stores the brief's global constraint with source
 *     "orchestrator" in .vibegraph/constraints.json, and the board lists it;
 *   * every packet reaches done with `review.by === "orchestrator"`;
 *   * the worker's marker landed in models.py — which can only happen
 *     if the handoff reached the worker prompt;
 *   * the honest summary names who reviewed.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4286 PORT=4286 \
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/work_run/fake_worker.mjs" \
 *   FAKE_EDIT_FILE=models.py FAKE_EDIT_NODE=module/list_users.fn FAKE_REQUIRE_HANDOFF=1 \
 *     npx playwright test test/e2e/m-orch-run.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const STUBBED = (process.env.VG_CLAUDE_BIN ?? "").includes("fake_worker") && !!process.env.FAKE_REQUIRE_HANDOFF;
const MODELS = join(process.cwd(), FIXTURE, "models.py");
const RUN_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "work-run.json");
const SNAP_DIR = join(process.cwd(), FIXTURE, ".vibegraph", "work-snapshots");
const CONSTRAINTS_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "constraints.json");

test.describe("M-ORCH — the orchestrated run: one objective gate, orchestrator-reviewed packets", () => {
  test.skip(!IS_FLASK || !STUBBED, "Requires flask_demo + fake_worker stub with FAKE_REQUIRE_HANDOFF");

  let original = "";
  test.beforeAll(() => {
    original = readFileSync(MODELS, "utf-8");
    rmSync(CONSTRAINTS_FILE, { force: true });
    // M-ORCH.4 — the spec before this one in the chain may still be tearing down; never inherit its run.
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
  });
  test.afterAll(() => {
    writeFileSync(MODELS, original, "utf-8");
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
    rmSync(CONSTRAINTS_FILE, { force: true });
  });

  test("confirm the objective once; the orchestrator hands off, reviews, and the run completes", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    await page.click("[data-work-run-toggle]");
    await page.click("[data-work-run-mode-orchestrated]");
    await expect(page.locator("[data-work-run-mode]")).toHaveAttribute("data-work-run-mode", "orchestrated");
    // M-ORCH.4 — this spec proves the MODEL-review path, so it opts into
    // `review: full` explicitly (the default `pre-checks` policy approves
    // clean packets without a model — proven by m-orch-parallel.spec.ts).
    await page.check("[data-work-run-review-full]");
    await page.fill("[data-work-run-task]", "tidy `list_users` bookkeeping in models.py");
    await page.click("[data-work-run-start]");

    // The objective gate: the brief arrives (the stub answers instantly)
    // with the objective, a task + handoff per packet, and a global constraint.
    const gate = page.locator("[data-work-run-gate]");
    await expect(gate).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-orchestration-gate]")).toHaveAttribute("data-orchestration-status", "ready", { timeout: 15_000 });
    await expect(page.locator("[data-orchestration-objective]")).toContainText("Stub objective");
    await expect(page.locator("[data-orchestration-handoff]").first()).toContainText("HANDOFF-MARKER");
    await expect(page.locator("[data-orchestration-globals]")).toContainText("perf-lever");
    await expect(page.locator("[data-orchestration-nochange]").first()).toContainText("no change needed");
    await expect(page.locator("[data-run-mode]")).toContainText("orchestrated");

    // ONE human action: confirm the objective. No approve/reject after this.
    await page.click("[data-work-run-ratify]");

    await expect(page.locator("[data-work-run-panel]"))
      .toHaveAttribute("data-run-status", "done", { timeout: 60_000 });

    // The brief's global constraint became a STATED constraint, source orchestrator.
    expect(existsSync(CONSTRAINTS_FILE)).toBe(true);
    const stored = JSON.parse(readFileSync(CONSTRAINTS_FILE, "utf-8"));
    expect(stored.constraints.length).toBeGreaterThanOrEqual(1);
    expect(stored.constraints[0].source).toBe("orchestrator");
    expect(stored.constraints[0].kind).toBe("perf-lever");
    await expect(page.locator('[data-constraint-row][data-constraint-source="orchestrator"]').first()).toBeVisible();

    // Every packet was reviewed by the orchestrator; none awaited a human.
    // M-ORCH.2 — the stub marks the LAST packet "no change needed": it is
    // settled at the objective gate with the brief's reason, no worker ever
    // runs for it (no evidence), and the run still ends clean.
    const run = JSON.parse(readFileSync(RUN_FILE, "utf-8"));
    expect(run.mode).toBe("orchestrated");
    expect(run.review).toBe("full");
    expect(run.orchestration.status).toBe("ready");
    expect(run.orchestration.storedConstraintIds.length).toBeGreaterThanOrEqual(1);
    const last = run.packets[run.packets.length - 1];
    expect(run.orchestration.packetTasks[last.id]?.noChange).toBe(true);
    expect(last.status).toBe("no-change");
    expect(last.evidence).toBeNull();
    expect(last.review?.by).toBe("orchestrator");
    expect(last.review?.reason).toMatch(/no change needed \(confirmed brief\): Stub verified/);
    for (const p of run.packets.slice(0, -1)) {
      expect(p.status).toBe("done");
      expect(p.review?.by).toBe("orchestrator");
      expect(p.review?.verdict).toBe("approve");
    }
    expect(run.summary.note).toContain("1 packet(s) needed no change per the confirmed brief (no worker spawned)");
    await expect(page.locator(`[data-packet-card="${last.id}"]`)).toHaveAttribute("data-packet-status", "no-change");
    const byOrchestrator = page.locator('[data-packet-review-by="orchestrator"]');
    expect(await byOrchestrator.count()).toBe(run.packets.length);

    // The worker edited ONLY because its prompt carried the handoff.
    const finalBytes = readFileSync(MODELS, "utf-8");
    expect(finalBytes).toMatch(/worker-marker-\d+-\d{13}/);

    // The honest summary says who reviewed.
    await expect(page.locator("[data-work-run-summary]")).toContainText("by the orchestrator");
  });
});
