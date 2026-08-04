/**
 * M-FV.0 — assignment RHS fidelity in the file view.
 *
 * The redesign brief reported `self.login_view =` rendering with nothing
 * after the `=`, where the source is `= None`. Verification (§0.1) showed the
 * RHS is already carried in the IR `preview` field — so this is a render
 * guarantee, not missing data: every assignment must show its RHS verbatim,
 * and `rhsOf()` must never emit a dangling operator with empty trailing text.
 *
 * Boot with VG_FIXTURE=test/fixtures/threads/big_demo. login_manager.py has a
 * `LoginManager.__init__` whose `self.X = …` fields cover the brief's exact
 * examples: `= None`, `= AnonymousUserMixin`, `= {}`, `= "basic"`.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_demo"), "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

// id → the RHS text the node must display (the `preview` from parse_cst.py).
const CASES: Array<{ id: string; rhs: string }> = [
  { id: "module/LoginManager.class/__init__.fn/self_login_view.assign", rhs: "None" },
  { id: "module/LoginManager.class/__init__.fn/self_anonymous_user.assign", rhs: "AnonymousUserMixin" },
  { id: "module/LoginManager.class/__init__.fn/self_blueprint_login_views.assign", rhs: "{}" },
  { id: "module/LoginManager.class/__init__.fn/self_session_protection.assign", rhs: "basic" },
];

test.describe("file view — assignment RHS fidelity", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Directory fixtures boot into the thread index — pivot to Files and open
    // login_manager.py to land on its diagram.
    await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="login_manager.py"]');
    await page.waitForSelector(".react-flow__node-classDefNode", { timeout: 15_000 });
  });

  test("self.X fields render their RHS verbatim — never a bare `=`", async ({ page }) => {
    for (const { id, rhs } of CASES) {
      const node = page.locator(`.react-flow__node[data-id="${id}"]`);
      await expect(node).toHaveCount(1);
      // The RHS value is present after the operator (the §0.1 fidelity claim).
      await expect(node).toContainText(rhs);
      // Regression guard for the dangling-operator bug: the rendered text is
      // not just the name followed by an operator with nothing after it.
      const text = ((await node.textContent()) ?? "").replace(/\s+/g, " ").trim();
      expect(text).not.toMatch(/=\s*$/);
    }
  });
});
