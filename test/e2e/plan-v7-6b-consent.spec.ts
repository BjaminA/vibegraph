/**
 * PLAN-v7 6b (gate) — CONSENT for an effectful changeset check, manual path
 * + token integrity.
 *
 * Scenario 1 — TOKEN INTEGRITY (raw WS, no UI): a forged/stale consent token
 * never runs anything. The reply is the honest decline ("consent token
 * stale"), the check did not run, and a FRESH token is re-minted for the
 * gate. This pins the SM3 consent-integrity model on the changeset floor:
 * scope-bound (this changeset content + this offense set), fresh-scan
 * re-validated, unforgeable.
 *
 * Scenario 2 — THE MANUAL CONSENT ARC (UI): a canned changeset whose check
 * writes a file via `with open(...)` (the 6a-fixed floor shape) → the gate
 * opens with the danger-framed effect gate listing the offense, Accept
 * DISABLED, disk clean → "Run the check anyway" (consent) → the check runs in
 * the sandbox, labelled consented (never laundered as pure), floor green →
 * Accept & build lands the file through the chokepoint.
 *
 * Boot (see package.json test:e2e-plan-v7-6b):
 *   VG_FIXTURE=test/fixtures/greenfield_blank VG_PORT=4241 PORT=4241 \
 *     npx playwright test test/e2e/plan-v7-6b-consent.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BLANK = FIXTURE.includes("greenfield_blank");
const ROOT = join(process.cwd(), FIXTURE);
const PORT = process.env.VG_PORT ?? "4241";
const SHOT_DIR = "reviews/m-plan-v7-6b";

const SYSTEM_PLAN = {
  version: "1",
  description: "a flask API with a sqlite note store",
  subsystems: [
    { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
    { id: "db", kind: "db", label: "SQLite note store", groundedIn: "a sqlite note store" },
  ],
  edges: [{ from: "backend", to: "db", groundedIn: "a sqlite note store" }],
  drafted: false,
  ratifiedAt: "2026-07-03T00:00:00.000Z",
};

// The increment is trivially fine; the CHECK is deliberately effectful —
// `with open(...)` writes a scratch file (in the SANDBOX copy's cwd). This
// is the exact shape the 6a floor fix made visible.
const CHANGESET = {
  label: "metrics with an effectful check",
  files: [
    { path: "metrics.py", content: "def count_notes(notes):\n    return len(notes)\n" },
  ],
  check: {
    module: [
      "from metrics import count_notes",
      "",
      "",
      "def __vg_check__():",
      '    with open("scratch.txt", "w") as f:',
      "        f.write(str(count_notes([1, 2])))",
      "",
    ].join("\n"),
    description: "counting works; the check deliberately writes a scratch file",
  },
  drafted: false,
};

test.use({ video: "on" });

function cleanFixture() {
  rmSync(join(ROOT, ".vibegraph"), { recursive: true, force: true });
  for (const f of ["metrics.py"]) rmSync(join(ROOT, f), { force: true });
}

// One request/reply over a raw WS client — the server treats us exactly like
// the webview (same boundary validation), letting the spec speak the token
// protocol directly.
function wsRoundtrip(send: object, replyType: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`no ${replyType} reply in 30s`)); }, 30_000);
    ws.on("open", () => ws.send(JSON.stringify(send)));
    ws.on("message", (buf: Buffer) => {
      const msg = JSON.parse(buf.toString());
      if (msg.type === replyType) {
        clearTimeout(timer);
        ws.close();
        resolve(msg.payload);
      }
    });
    ws.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
  });
}

test.describe("PLAN-v7 6b — effectful-check consent", () => {
  test.skip(!IS_BLANK, "Requires VG_FIXTURE=test/fixtures/greenfield_blank");

  test.beforeAll(() => {
    cleanFixture();
    mkdirSync(join(ROOT, ".vibegraph"), { recursive: true });
    writeFileSync(join(ROOT, ".vibegraph", "system-plan.json"), JSON.stringify(SYSTEM_PLAN, null, 2) + "\n", "utf-8");
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    cleanFixture();
  });

  test("a forged consent token never runs the check — honest stale decline + fresh re-mint", async () => {
    // Un-tokened propose: declined, offenses listed, a token minted.
    const declined = await wsRoundtrip(
      { type: "changeset-propose", payload: { changeset: CHANGESET } },
      "changeset-proposal",
    );
    expect(declined.ok).toBe(true);
    expect(declined.floor.ok).toBe(false);
    expect(declined.floor.check.ran).toBe(false);
    expect(declined.floor.check.pure).toBe(false);
    expect(declined.floor.check.consentToken).toBeTruthy();
    expect(declined.floor.check.error).toContain("not confidently pure");
    expect((declined.floor.check.offenses ?? []).some((o: any) => o.effectKind === "fs" && o.target === "open")).toBe(true);

    // Forged token: refused with the honest stale reason; the check still
    // did NOT run; a fresh (valid) token is re-minted for the gate.
    const forged = await wsRoundtrip(
      { type: "changeset-propose", payload: { changeset: CHANGESET, effectConsentToken: "deadbeef".repeat(8) } },
      "changeset-proposal",
    );
    expect(forged.floor.ok).toBe(false);
    expect(forged.floor.check.ran).toBe(false);
    expect(forged.floor.check.consented).toBeFalsy();
    expect(forged.floor.check.error).toContain("consent token stale");
    expect(forged.floor.check.consentToken).toBeTruthy();

    // Scope-bound: the minted token authorizes THIS changeset content only.
    // The same token on an EDITED changeset (one byte of check drift) fails.
    const edited = {
      ...CHANGESET,
      check: { ...CHANGESET.check, module: CHANGESET.check.module.replace("scratch.txt", "other.txt") },
    };
    const stale = await wsRoundtrip(
      { type: "changeset-propose", payload: { changeset: edited, effectConsentToken: declined.floor.check.consentToken } },
      "changeset-proposal",
    );
    expect(stale.floor.check.ran).toBe(false);
    expect(stale.floor.check.error).toContain("consent token stale");

    // ...and the REAL token on the UNCHANGED changeset runs the check,
    // labelled consented — the full server-side consent contract.
    const consented = await wsRoundtrip(
      { type: "changeset-propose", payload: { changeset: CHANGESET, effectConsentToken: declined.floor.check.consentToken } },
      "changeset-proposal",
    );
    expect(consented.floor.check.consented).toBe(true);
    expect(consented.floor.check.ran).toBe(true);
    expect(consented.floor.check.ok).toBe(true);
    expect(consented.floor.check.pure).toBe(false); // never laundered
    expect(consented.floor.ok).toBe(true);
    expect(existsSync(join(ROOT, "metrics.py"))).toBe(false); // propose never writes
  });

  test("manual consent arc: effect gate → consent → consented green floor → accept builds", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('button:has-text("System")')).toBeVisible({ timeout: 15_000 });

    await page.evaluate((changeset) => {
      document.dispatchEvent(new CustomEvent("vg-changeset-propose", { detail: { changeset } }));
    }, CHANGESET);

    // The gate opens with the danger-framed consent block; Accept disabled.
    const gate = page.locator("[data-changeset-gate]");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    const effectGate = page.locator("[data-changeset-effect-gate]");
    await expect(effectGate).toBeVisible();
    await expect(effectGate).toContainText(/file-system effect/i);
    await expect(effectGate).toContainText("open");
    await expect(page.locator("[data-changeset-accept]")).toBeDisabled();
    expect(existsSync(join(ROOT, "metrics.py"))).toBe(false);

    await page.screenshot({ path: join(SHOT_DIR, "consent-gate.png") });

    // Consent → the check runs in the sandbox, labelled honestly.
    await page.click("[data-changeset-consent]");
    await expect(page.locator("[data-check-consented]")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-changeset-check][data-check-ok="true"]')).toHaveCount(1);
    await expect(page.locator("[data-changeset-effect-gate]")).toHaveCount(0);
    await expect(page.locator("[data-changeset-accept]")).toBeEnabled();

    await page.screenshot({ path: join(SHOT_DIR, "consented-green.png") });

    // Accept & build — the file lands through the chokepoint.
    await page.click("[data-changeset-accept]");
    await expect.poll(() => existsSync(join(ROOT, "metrics.py")), { timeout: 15_000 }).toBe(true);
    await expect(gate).toHaveCount(0, { timeout: 10_000 });
  });
});
