/**
 * M-STACK.5 (PLAN-M-STACK.md) — the deterministic stack pre-check, live.
 *
 * A worker reaches for a tool a stated policy forbids. No model reads the
 * diff: the IR delta's new import node resolves to a tool, the policy is
 * bound to that tool, and the packet is REJECTED with the alternative
 * named — which is what the bounded retry's RETRY NOTICE then carries.
 *
 * This is the cheap, exact check the M-ORCH.4 limit named ("callers of X
 * only in Y needed a grammar" — a policy bound to a tool IS that grammar
 * for imports).
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4298 PORT=4298 \
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/work_run/fake_worker.mjs" \
 *   FAKE_EDIT_FILE=models.py FAKE_EDIT_NODE=module/list_users.fn \
 *   FAKE_REQUIRE_HANDOFF=1 FAKE_ADD_IMPORT=requests \
 *     npx playwright test test/e2e/m-stack-precheck.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const FORBIDDEN = process.env.FAKE_ADD_IMPORT ?? "";
const MODELS = join(process.cwd(), FIXTURE, "models.py");
const VG_DIR = join(process.cwd(), FIXTURE, ".vibegraph");
const RUN_FILE = join(VG_DIR, "work-run.json");
const SNAP_DIR = join(VG_DIR, "work-snapshots");
const CONSTRAINTS_FILE = join(VG_DIR, "constraints.json");

// The stated decision the check enforces: HTTP leaves through the
// project's own wrapper. Human-stated, authoritative — exactly the shape
// examples/fleet-telemetry's c1 has.
const POLICY = {
  version: "1",
  constraints: [{
    id: "c1",
    kind: "proxy",
    text: "Outbound HTTP leaves through models.http_client only; a bare requests call anywhere else bypasses the egress proxy.",
    scope: { all: true },
    source: "human",
    createdAt: "2026-09-08T00:00:00.000Z",
    policy: {
      tool: FORBIDDEN || "requests",
      role: "http-client",
      rule: "replace-with",
      with: "models.http_client",
      reason: "the proxy and the service token live in the wrapper",
    },
  }],
};

test.describe("M-STACK.5 — a forbidden tool in the IR delta is rejected without a model", () => {
  test.skip(!IS_FLASK || !FORBIDDEN, "Requires flask_demo + fake_worker with FAKE_ADD_IMPORT");

  let original = "";
  test.beforeAll(() => {
    original = readFileSync(MODELS, "utf-8");
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
    mkdirSync(VG_DIR, { recursive: true });
    writeFileSync(CONSTRAINTS_FILE, JSON.stringify(POLICY, null, 2) + "\n", "utf-8");
  });
  test.afterAll(() => {
    writeFileSync(MODELS, original, "utf-8");
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
    rmSync(CONSTRAINTS_FILE, { force: true });
  });

  test("the packet is rejected naming the policy and the alternative; the file is restored", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });

    await page.click("[data-work-run-toggle]");
    await page.click("[data-work-run-mode-orchestrated]");
    await page.fill("[data-work-run-task]", "tidy `list_users` bookkeeping in models.py");
    await page.click("[data-work-run-start]");

    const gate = page.locator("[data-orchestration-gate]");
    await expect(gate).toHaveAttribute("data-orchestration-status", "ready", { timeout: 60_000 });
    await page.click("[data-work-run-ratify]");

    // The first packet's review is a REJECT that names the policy, the
    // rule, and what to use instead — the text the retry notice carries.
    const readRun = () => {
      try { return existsSync(RUN_FILE) ? JSON.parse(readFileSync(RUN_FILE, "utf-8")) : null; } catch { return null; }
    };
    const packet0 = () => readRun()?.packets?.[0] ?? null;
    await expect.poll(() => packet0()?.review?.reason ?? "", { timeout: 150_000 })
      .toMatch(/introduced requests in models\.py/);
    // The bounded retry repeats the same reach, so the packet settles failed.
    await expect.poll(() => packet0()?.status ?? "", { timeout: 150_000 }).toBe("failed");

    const run = JSON.parse(readFileSync(RUN_FILE, "utf-8"));
    const p1 = run.packets[0];
    expect(p1.review.verdict).toBe("reject");
    expect(p1.review.reason).toMatch(/policy c1 \(human-stated\) says to replace with models\.http_client/);
    // M-BOUNDARY.3 - the reject names the SITE, so the retry notice tells the
    // worker which line to change. This stub only IMPORTS the tool, which is
    // the smaller thing and says so; a call would name the node and its text.
    expect(p1.review.reason).toMatch(/imported at \S*requests\S*[^)]*no call through it yet/);
    expect(p1.review.reason).toMatch(/Use models\.http_client instead\./);
    expect(p1.review.reason).toMatch(/Reason given: the proxy and the service token live in the wrapper/);
    // Deterministic: the reject came from the pre-checks, not a spawn —
    // the reviewer verdict is recorded as the orchestrator's, and its
    // wording is the pre-check's, never a model's prose.
    expect(p1.review.reason.startsWith("pre-check:")).toBe(true);
    // The second attempt is rejected the same way, so the packet fails
    // rather than sneaking through on a retry that repeats itself.
    expect(p1.attempts).toBeGreaterThanOrEqual(2);
    expect(p1.status).toBe("failed");

    // Every rejection restores the snapshot: the forbidden import is not
    // on disk, and neither is the worker's marker. Wait for the RUN to
    // settle first: every packet here reaches models.py and every stub
    // worker reaches for the forbidden tool, so right after p1 fails the
    // NEXT packet may already be mid-edit on the same file (the flake this
    // spec had, 1 in 3 back to back).
    await expect.poll(() => readRun()?.status ?? "", { timeout: 150_000 }).toMatch(/^(failed|done)$/);
    const after = readFileSync(MODELS, "utf-8");
    if (/^import requests$/m.test(after) || after !== original) {
      // Diagnostic for the flake this spec had: say WHICH packet left the bytes.
      const final = JSON.parse(readFileSync(RUN_FILE, "utf-8"));
      console.log("[precheck-diag] run", final.status, final.packets.map((p: any) =>
        `${p.id}:${p.status}#${p.attempts} review=${p.review?.by ?? "-"}/${p.review?.verdict ?? "-"} diffs=${(p.evidence?.diffs ?? []).map((d: any) => d.file).join("+") || "-"} started=${p.startedAt ?? "-"} reviewedAt=${p.review?.at ?? "-"}`).join(" | "));
      for (const p of final.packets) {
        if (p.review?.by === "pre-checks") {
          console.log(`[precheck-diag] ${p.id} irDelta=${JSON.stringify(p.evidence?.irDelta ?? null)} preCheck=${JSON.stringify(p.evidence?.preCheck ?? null)}`);
        }
      }
      try { console.log("[precheck-diag] snapshots left:", existsSync(SNAP_DIR) ? readdirSync(SNAP_DIR).join(",") : "(none)"); } catch {}
      const trace = process.env.VG_TRACE_MAP;
      if (trace && existsSync(trace)) console.log("[precheck-trace]\n" + readFileSync(trace, "utf-8").split("\n").slice(-120).join("\n"));
    }
    expect(after).not.toMatch(/^import requests$/m);
    expect(after).toBe(original);
  });
});
