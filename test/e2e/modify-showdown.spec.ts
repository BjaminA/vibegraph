/**
 * MODIFY-SHOWDOWN — VibeGraph arm driver (real Opus 5, billed).
 *
 * Counterpart to opus-showdown.spec.ts, but for the MODIFY scenario:
 * a targeted change to a busy app (the Django-admin scale fixture,
 * ~8.3k LOC / 29 files) driven through the GUI chat with the target
 * node selected — the product's "point at the code, ask" path.
 *
 * NOT part of the test chain: gated on VG_MODIFY_SHOWDOWN=1. The server
 * must ALREADY be running (reuseExistingServer) on a work COPY of the
 * fixture, booted with VG_CLAUDE_BIN=test/tools/claude_meter.sh and
 * VG_METER_DIR pointing at reviews/modify-showdown-2026-08/meter — the
 * playwright webServer env whitelist would not forward the meter vars.
 *
 * Run (see reviews/modify-showdown-2026-08/REPORT.md for the full recipe):
 *   PORT=4278 VG_CLAUDE_BIN=$PWD/test/tools/claude_meter.sh \
 *     VG_METER_ARM=vibegraph-modify \
 *     VG_METER_DIR=$PWD/reviews/modify-showdown-2026-08/meter \
 *     node dist/server.js <work-copy>/src &
 *   VG_MODIFY_SHOWDOWN=1 VG_PORT=4278 PORT=4278 \
 *     npx playwright test test/e2e/modify-showdown.spec.ts
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const ENABLED = process.env.VG_MODIFY_SHOWDOWN === "1";
const SHOT_DIR = "reviews/modify-showdown-2026-08";

// Shared task text — the block between the two `---` rules in TASK.md,
// byte-identical to what the plain arm receives.
function taskText(): string {
  const md = readFileSync(join(process.cwd(), SHOT_DIR, "TASK.md"), "utf8");
  const parts = md.split(/^---$/m);
  if (parts.length < 3) throw new Error("TASK.md missing --- delimited task block");
  return parts[1].trim();
}

test.describe("MODIFY-SHOWDOWN — VibeGraph chat arm (real Opus 5)", () => {
  test.skip(!ENABLED, "Requires VG_MODIFY_SHOWDOWN=1 + a pre-booted metered server (real billed Opus spawns)");
  test.setTimeout(15 * 60_000);

  test("targeted modify via chat with node selected", async ({ page }) => {
    const t0 = Date.now();
    await page.goto("/");

    // Launchpad: open the thread owning the target function.
    await page.waitForSelector("[data-thread-index]", { timeout: 20_000 });
    await page.getByText("utils:prepare_lookup_value", { exact: true }).click();
    await page.waitForSelector(".react-flow__node", { timeout: 20_000 });
    await page.screenshot({ path: `${SHOT_DIR}/a1-thread-open.png` });

    // Select the seed node — editor opens, chat docks with node context.
    const seed = page.locator(".react-flow__node", { hasText: "prepare_lookup_value" }).first();
    await seed.click({ position: { x: 14, y: 14 } });
    const chat = page.locator("[data-chat-panel]");
    await expect(chat).toBeVisible({ timeout: 10_000 });
    const input = chat.locator("textarea");
    await expect(input).toBeEnabled();
    await page.screenshot({ path: `${SHOT_DIR}/a2-node-selected.png` });

    // One turn: the shared task, verbatim.
    await input.fill(taskText());
    await input.press("Enter");
    await expect(input).toBeDisabled({ timeout: 15_000 }); // turn started
    await page.screenshot({ path: `${SHOT_DIR}/a3-turn-running.png` });

    // Turn boundary = busy cleared (stream-json result event).
    await expect(input).toBeEnabled({ timeout: 12 * 60_000 });
    const turnMs = Date.now() - t0;
    await expect(page.locator("[data-chat-assistant-msg]").first()).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/a4-turn-complete.png`, fullPage: true });

    const reply = (await page.locator("[data-chat-assistant-msg]").last().textContent()) ?? "";
    console.log(`MODIFY-SHOWDOWN armA wall-clock: ${turnMs}ms`);
    console.log(`MODIFY-SHOWDOWN armA reply tail: ${reply.slice(-400)}`);
  });
});
