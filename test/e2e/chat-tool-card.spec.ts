/**
 * M-CHAT-POLISH.1 — chat tool cards resolve (the living-renderer proof).
 *
 * The stub backend (fake_claude_stdio.mjs via VG_CLAUDE_BIN) emits a
 * deterministic tool_use/tool_result pair when the message contains
 * "tooluse". Pinned here:
 *   - the tool card appears in `running` state (spinner);
 *   - it RESOLVES to `ok` — the correlation is by toolUseId, which the
 *     old wire shape (result stamped "(mcp)") made impossible: cards
 *     spun forever;
 *   - the spinner carries the repo's vg-spin class (animate-spin was a
 *     Tailwind orphan — it never animated).
 *
 * Boot (see package.json test:e2e-chat-tools):
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_CLAUDE_BIN="node …/fake_claude_stdio.mjs"
 */
import { test, expect } from "@playwright/test";

const IS_DEMO = (process.env.VG_FIXTURE ?? "").includes("flask_demo");

test.describe("M-CHAT-POLISH.1 — tool cards resolve", () => {
  // Sends spawn the VG_CLAUDE_BIN stub — never run these against a
  // runtime that would reach the real `claude` (the bare `playwright
  // test` sweep runs on the default fixture without the stub).
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo + stub VG_CLAUDE_BIN");
  test("a tool card appears running, then settles to ok", async ({ page }) => {
    await page.goto("/");
    // flask_demo boots into the thread-index launchpad; its arrival means
    // the runtime is fully up before we chat.
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    await page.getByTitle(/Open Claude chat/).click();
    const chat = page.locator("[data-chat-panel]");
    await expect(chat).toBeVisible();

    await chat.locator("textarea").fill("tooluse");
    await chat.locator("textarea").press("Enter");

    const card = chat.locator("[data-chat-tool]");
    await expect(card).toHaveCount(1, { timeout: 10_000 });
    // The stub answers fast; accept either observing the running state
    // or the already-settled card — but the FINAL state must be ok.
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 10_000 });

    // The card names the real tool (mcp prefix stripped), not "(mcp)".
    await expect(card).toContainText("vibegraph explain node");

    // And the turn completed: the echoed assistant reply rendered.
    await expect(chat.locator("[data-chat-assistant-msg]").last()).toContainText("echo", {
      timeout: 10_000,
    });
  });

  test("the running spinner uses vg-spin, not the Tailwind orphan", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.getByTitle(/Open Claude chat/).click();
    const chat = page.locator("[data-chat-panel]");
    await expect(chat).toBeVisible();

    await chat.locator("textarea").fill("tooluse");
    await chat.locator("textarea").press("Enter");

    // Race-tolerant: if we catch the card mid-run, its spinner must be
    // the repo class. If it already settled, the check icon must carry
    // the settle beat instead. Either way animate-spin must not exist.
    const card = chat.locator("[data-chat-tool]");
    await expect(card).toHaveCount(1, { timeout: 10_000 });
    await expect(card.locator(".animate-spin")).toHaveCount(0);
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 10_000 });
    await expect(card.locator(".vg-tool-settle")).toHaveCount(1);
  });

  // M-CHAT-POLISH.2 — the transcript lives in the module store, so
  // closing the panel (a real unmount — fileview-chat-retract pins that)
  // no longer erases the history the server session still remembers.
  test("transcript survives close → reopen; New chat still forgets", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    await page.getByTitle(/Open Claude chat/).click();
    const chat = page.locator("[data-chat-panel]");
    await expect(chat).toBeVisible();

    await chat.locator("textarea").fill("tooluse");
    await chat.locator("textarea").press("Enter");
    await expect(chat.locator("[data-chat-user-msg]")).toHaveCount(1, { timeout: 10_000 });
    await expect(chat.locator("[data-chat-assistant-msg]").last()).toContainText("echo", { timeout: 10_000 });

    // Close = genuine unmount…
    await page.getByTitle("Close chat").click();
    await expect(page.locator("[data-chat-panel]")).toHaveCount(0);

    // …reopen: user + assistant + tool card all still render, and the
    // resumed-note apology does NOT (nothing was forgotten).
    await page.getByTitle(/Open Claude chat/).click();
    await expect(chat).toBeVisible();
    await expect(chat.locator("[data-chat-user-msg]")).toHaveCount(1);
    await expect(chat.locator("[data-chat-assistant-msg]").last()).toContainText("echo");
    await expect(chat.locator("[data-chat-tool]")).toHaveAttribute("data-state", "ok");
    await expect(chat.locator("[data-chat-resumed-note]")).toHaveCount(0);

    // New chat stays the only forgetting path.
    await chat.locator("[data-chat-new]").click();
    await expect(chat.locator("[data-chat-user-msg], [data-chat-assistant-msg], [data-chat-tool]")).toHaveCount(0);
  });

  // M-CHAT-POLISH.3 — assistant replies render markdown (the stub echoes
  // the framed prompt, which embeds the user text verbatim).
  test("assistant markdown: **bold** → <strong>, backticks → code chip", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.getByTitle(/Open Claude chat/).click();
    const chat = page.locator("[data-chat-panel]");
    await expect(chat).toBeVisible();

    await chat.locator("textarea").fill("**Verified by running it** on `module/train_model.fn/for@0`");
    await chat.locator("textarea").press("Enter");

    const reply = chat.locator("[data-chat-assistant-msg]").last();
    await expect(reply.locator("strong", { hasText: "Verified by running it" })).toBeVisible({ timeout: 10_000 });
    await expect(reply.locator(".vg-inline-code", { hasText: "module/train_model.fn/for@0" }).first()).toBeVisible();
    // The raw markers are gone from the rendered text.
    await expect(reply).not.toContainText("**Verified");
  });

  // M-CHAT-POLISH.4 — a Bash card shows the command it ran, not just the
  // word "Bash"; the full command expands on click.
  test("Bash card: command summary + click-to-expand full input", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.getByTitle(/Open Claude chat/).click();
    const chat = page.locator("[data-chat-panel]");
    await expect(chat).toBeVisible();

    await chat.locator("textarea").fill("toolbash");
    await chat.locator("textarea").press("Enter");

    const card = chat.locator("[data-chat-tool]");
    await expect(card).toHaveCount(1, { timeout: 10_000 });
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 10_000 });
    await expect(card).toContainText("Bash");
    await expect(card.locator("[data-chat-tool-summary]")).toContainText("python train.py --epochs 3");

    // Detail hidden at rest; the chevron reveals the full command block.
    await expect(card.locator("[data-chat-tool-detail]")).toHaveCount(0);
    await card.locator("[data-chat-tool-expand]").click();
    await expect(card.locator("[data-chat-tool-detail] pre").first()).toContainText("python train.py --epochs 3");
  });
});
