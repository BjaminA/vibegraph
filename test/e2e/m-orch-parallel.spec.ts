/**
 * M-ORCH.4 (PLAN-M-CONTRACT.md) — LANES + pre-check approvals, end to end
 * on the POLYGLOT fixture (a Python API + a TS gateway that share no file)
 * with the scripted stub (fake_worker.mjs plays orchestrator, workers, and
 * reviewer):
 *   * the brief declares an EDIT SCOPE per packet (FAKE_SCOPE=alternate:
 *     p1 → api/app.py, p2 → api/db.py, p3 → gateway/schema.ts,
 *     p4 → gateway/client.ts), shown at the objective gate;
 *   * with lanes ×3, the Python packet p1 and the TS packet p3 are
 *     OBSERVED running at once (the stub holds its session open
 *     FAKE_WORKER_DELAY_MS after its edit) — while p2, which READS
 *     api/app.py that p1 is changing, waits for p1 (the read-after-write
 *     guard: startedAt after p1's review), and p4 waits for p3 likewise;
 *   * p2, scoped to api/db.py, has its api/app.py edit REFUSED by the
 *     chokepoint with the owning packet named — the file is never touched
 *     by it, and the refusal reaches the evidence as its self-report;
 *   * p1's clean in-scope edit is approved by the deterministic
 *     PRE-CHECKS (`review.by === "pre-checks"`, no reviewer spawn); the
 *     no-diff packets go to the model (the stub approves them);
 *   * the run ends clean and the summary counts pre-check approvals apart.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/polyglot/shop_demo VG_PORT=4290 PORT=4290 \
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/work_run/fake_worker.mjs" \
 *   FAKE_EDIT_FILE=api/app.py FAKE_EDIT_NODE=module/create_order.fn FAKE_REQUIRE_HANDOFF=1 \
 *   FAKE_SCOPE=alternate FAKE_WORKER_DELAY_MS=2500 \
 *     npx playwright test test/e2e/m-orch-parallel.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_SHOP = FIXTURE.includes("shop_demo");
const STUBBED = (process.env.VG_CLAUDE_BIN ?? "").includes("fake_worker") && process.env.FAKE_SCOPE === "alternate";
const FILES = ["api/app.py", "api/db.py", "api/orders.py", "gateway/server.ts", "gateway/client.ts", "gateway/schema.ts"];
const abs = (rel: string) => join(process.cwd(), FIXTURE, rel);
const RUN_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "work-run.json");
const VG_DIR = join(process.cwd(), FIXTURE, ".vibegraph");

test.describe("M-ORCH.4 — lanes: independent packets run in parallel; reads wait for writes; pre-checks approve clean packets", () => {
  test.skip(!IS_SHOP || !STUBBED, "Requires polyglot shop_demo + fake_worker stub with FAKE_SCOPE=alternate");

  const original: Record<string, string> = {};
  test.beforeAll(() => {
    for (const f of FILES) original[f] = readFileSync(abs(f), "utf-8");
    rmSync(VG_DIR, { recursive: true, force: true });
  });
  test.afterAll(() => {
    for (const f of FILES) writeFileSync(abs(f), original[f], "utf-8");
    rmSync(VG_DIR, { recursive: true, force: true });
  });

  test("python and TS packets run at once; a reader waits for its writer; an out-of-scope edit is refused; pre-checks approve", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");
    // Four languages boot through four frontends — the thread index takes longer than a python-only fixture.
    await page.waitForSelector("[data-thread-index]", { timeout: 60_000 });

    await page.click("[data-work-run-toggle]");
    await page.click("[data-work-run-mode-orchestrated]");
    // The launch form shows the lanes choice (default ×3) and the review policy.
    await expect(page.locator("[data-work-run-lanes]")).toHaveAttribute("data-work-run-lanes", "3");
    await page.fill("[data-work-run-task]", "tidy bookkeeping in api/app.py and gateway/server.ts");
    await page.click("[data-work-run-start]");

    // The objective gate shows the brief's EDIT SCOPE per packet.
    await expect(page.locator("[data-orchestration-gate]")).toHaveAttribute("data-orchestration-status", "ready", { timeout: 15_000 });
    const scopes = page.locator("[data-orchestration-scope]");
    expect(await scopes.count()).toBe(4);
    await expect(scopes.first()).toContainText("edits only · api/app.py");
    await expect(page.locator("[data-run-lanes]")).toContainText("lanes ×3");
    await expect(page.locator("[data-run-review]")).toContainText("pre-checks");

    // ONE human action.
    await page.click("[data-work-run-ratify]");

    // Concurrency is OBSERVED, not assumed: at some point ≥ 2 packet cards are running.
    let maxRunning = 0;
    await expect.poll(async () => {
      const n = await page.locator('[data-packet-card][data-packet-status="running"]').count();
      maxRunning = Math.max(maxRunning, n);
      return maxRunning;
    }, { timeout: 30_000, intervals: [100, 200, 300] }).toBeGreaterThanOrEqual(2);

    await expect(page.locator("[data-work-run-panel]"))
      .toHaveAttribute("data-run-status", "done", { timeout: 90_000 });

    const run = JSON.parse(readFileSync(RUN_FILE, "utf-8"));
    expect(run.mode).toBe("orchestrated");
    expect(run.parallel).toBe(3);
    expect(run.review).toBe("pre-checks");
    const by = (id: string) => run.packets.find((p: any) => p.id === id);
    const scope = (id: string) => run.orchestration.packetTasks[id].files;
    expect(scope("p1")).toEqual(["api/app.py"]);
    expect(scope("p2")).toEqual(["api/db.py"]);
    expect(scope("p3")).toEqual(["gateway/schema.ts"]);
    expect(scope("p4")).toEqual(["gateway/client.ts"]);
    for (const p of run.packets) expect(p.status).toBe("done");

    // The read-after-write guard: p2 READS api/app.py, which p1 CHANGES → p2
    // started only after p1 was reviewed; p4 reads gateway/schema.ts → after p3.
    expect(by("p2").startedAt >= by("p1").review.at).toBe(true);
    expect(by("p4").startedAt >= by("p3").review.at).toBe(true);
    // p1 (python) and p3 (TS) share nothing: both started before either was reviewed.
    expect(by("p3").startedAt < by("p1").review.at).toBe(true);
    expect(by("p1").startedAt < by("p3").review.at).toBe(true);

    // p1: an in-scope edit, approved by the PRE-CHECKS — no model read it.
    expect(by("p1").review.by).toBe("pre-checks");
    expect(by("p1").review.verdict).toBe("approve");
    // The reason leads with the CONSTRAINT verdicts (derived ones included)
    // and then the deterministic facts. It led straight with the file count
    // until 2026-09-21: the built server had never loaded standings.json
    // (`import.meta.url` does not exist in the esbuild CJS bundle), so every
    // Run 1 verb was silently advisory in dist and its verdicts never
    // reached this line. Asserting the whole string START again would
    // re-pin that bug, so assert what the line must CONTAIN.
    expect(by("p1").review.reason).toMatch(/^pre-checks passed — /);
    expect(by("p1").review.reason).toContain("1 file(s) changed inside the edit scope (api/app.py)");
    expect(by("p1").review.reason).toContain("every edited file re-parsed and re-linked");
    expect(by("p1").review.reason).toContain("No model read this diff.");
    // A derived check that GATES says "holds" here; an advisory one never
    // appears in a pass reason at all.
    expect(by("p1").review.reason).toMatch(/constraint derived:[a-z-]+ holds/);
    expect(by("p1").evidence.diffs.map((d: any) => d.file)).toEqual(["api/app.py"]);
    expect(by("p1").evidence.preCheck.needsEyes).toEqual([]);
    // p2: scoped to api/db.py, its api/app.py edit was REFUSED with the owner named.
    expect(by("p2").evidence.diffs).toEqual([]);
    expect(by("p2").evidence.summary).toMatch(/api\/app\.py is outside packet p2's edit scope \(api\/db\.py\)\. api\/app\.py belongs to p1 \(done\)/);
    expect(by("p2").review.by).toBe("orchestrator");
    expect(by("p2").evidence.preCheck.needsEyes.join("|")).toMatch(/no bytes changed/);
    // p3/p4 (TS): the stub's target is not in their remit → no-op → the model reviewed them.
    for (const id of ["p3", "p4"]) { expect(by(id).evidence.diffs).toEqual([]); expect(by(id).review.by).toBe("orchestrator"); }

    // Disk agrees: exactly one marker in api/app.py; every other file byte-identical.
    expect((readFileSync(abs("api/app.py"), "utf-8").match(/worker-marker-\d+-\d{13}/g) ?? []).length).toBe(1);
    for (const f of FILES.filter((x) => x !== "api/app.py")) expect(readFileSync(abs(f), "utf-8")).toBe(original[f]);

    // ── M-BATCH — WARM WORKER SESSIONS ──────────────────────────────
    //
    // This spec's shape is already the case that matters: p2 READS
    // api/app.py, which p1 CHANGES, so p2 waits for p1 — and a cold p2
    // would then rediscover the file p1 had just edited. It resumes p1's
    // session instead. Same for p4 after p3.
    //
    // The stub echoes back a --resume id and mints a fresh one otherwise,
    // so a SHARED id is proof of reuse rather than an artifact of a
    // constant, and every id is asserted to look real.
    for (const id of ["p1", "p2", "p3", "p4"]) expect(by(id).sessionId).toMatch(/^fake-/);
    expect(by("p2").sessionId).toBe(by("p1").sessionId);
    expect(by("p2").sessionPackets).toBe(2);
    expect(by("p4").sessionId).toBe(by("p3").sessionId);
    // ...and the two chains never collapse into one: p1/p2 (python) and
    // p3/p4 (TS) share no file, so a stranger's context is never inherited.
    expect(by("p3").sessionId).not.toBe(by("p1").sessionId);
    expect(by("p1").sessionPackets).toBe(1);

    // The honest summary counts the pre-check approval apart, and the board shows it.
    expect(run.summary.note).toMatch(/1 approved on pre-checks alone/);
    await expect(page.locator("[data-work-run-summary]")).toContainText("approved on pre-checks alone");
    expect(await page.locator('[data-packet-review-by="pre-checks"]').count()).toBe(1);
  });
});
