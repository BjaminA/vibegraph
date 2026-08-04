/**
 * M25 — chat revival (reverses M10-chat-removal's unmount; this spec
 * was m10-chat-unmount.spec.ts asserting the absence).
 *
 * The M10 thesis ("the terminal MCP session is the only conversational
 * path") failed contact with the user: the wish is an agent chat IN the
 * GUI that behaves like a terminal Claude Code session. It does — each
 * message spawns `claude -p` with an inline MCP config pointing back at
 * this server — so the panel is remounted.
 *
 * Asserted here (no live LLM — the claude round-trip is env-dependent
 * and was verified live; see reviews/m25-chat-revival/):
 *   - M28.3 supersedes the M25 "toggle clickable under the dock" invariant:
 *     selecting a node now DOCKS the chat beneath the editor automatically
 *     (no toggle click), and the floating toggle is only for the
 *     no-code-panel case. The docked chat is a permanent fixture (no close).
 *   - The panel opens with a focusable textarea.
 *   - The M10 removals that STAYED removed: no "Modify with Claude"
 *     strip action (Intent mode owns single-function edits); Analyze
 *     still mounted.
 *
 * Runs on the default fixture (sample_advanced.py) — no gating.
 */
import { test, expect } from "@playwright/test";

test.describe("M25 — chat revival", () => {
  test("selecting a node docks the chat beneath the editor — no toggle (M28.3)", async ({ page }) => {
    await page.goto("/");
    const fnNode = page.locator(".react-flow__node-functionDefNode").first();
    await expect(fnNode).toBeVisible({ timeout: 15_000 });

    // With nothing open the floating toggle offers a project-level chat.
    await expect(page.getByTitle(/Open Claude chat/)).toBeVisible();

    // Select a node — the editor opens (M18.1) AND the chat docks beneath
    // it, present without a toggle click (M28.3). The floating toggle
    // gives way to the docked panel.
    await fnNode.click({ position: { x: 12, y: 12 } });
    await page.waitForSelector("[data-node-editor-panel] .monaco-editor", { timeout: 10_000 });
    const chat = page.locator("[data-chat-panel]");
    await expect(chat).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTitle(/Open Claude chat/)).toHaveCount(0);

    // It's a permanent fixture of the code column: no close button.
    await expect(chat.getByTitle("Close chat")).toHaveCount(0);

    await chat.locator("textarea").click();
    await expect(chat.locator("textarea")).toBeFocused();

    // M27.3 — the New-chat affordance is in the header. Clicking it
    // empties the message area and leaves the panel usable. (Session
    // forget semantics are pinned in test:chat-stdio — no live claude
    // round-trip here.)
    const newChat = chat.locator("[data-chat-new]");
    await expect(newChat).toBeVisible();
    await newChat.click();
    await expect(chat).toBeVisible();
    await expect(chat.locator("[data-chat-user-msg], [data-chat-assistant-msg]")).toHaveCount(0);
    await chat.locator("textarea").click();
    await expect(chat.locator("textarea")).toBeFocused();
  });

  test("strip keeps Edit, chat action stays removed; Analyze now unmounted too", async ({ page }) => {
    await page.goto("/");
    const fnNode = page.locator(".react-flow__node-functionDefNode").first();
    await expect(fnNode).toBeVisible({ timeout: 15_000 });
    await fnNode.hover();
    await expect(fnNode.getByTitle("Edit source")).toBeVisible();
    await expect(fnNode.getByTitle("Modify with Claude")).toHaveCount(0);
    // 2026-08-03: Analyze joined the M10 removals — unmounted from the
    // toolbar (park-don't-delete; AnalysisCard and handleAnalyzeFile
    // remain on disk). The chat answers "what does this file do?" better
    // and takes follow-ups, so the button was redundant surface.
    await expect(page.getByRole("button", { name: "Analyze" })).toHaveCount(0);
    // Filters was NOT removed — it was renamed "Edges", because it is the
    // only way to reveal file-view flow/structure edges (both default off).
    await expect(page.getByRole("button", { name: "Filters" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edges" })).toBeVisible();
  });
});
