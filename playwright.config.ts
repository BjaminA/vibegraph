import { defineConfig } from "@playwright/test";
import * as path from "path";

// Default fixture is the M2/M3 stalwart `sample_advanced.py`. M4b capture
// specs override via env so they can point the server at aero_demo or
// big_demo without permanently switching the default test target.
//
// Pinned to a different port from the default so a capture run can sit
// alongside a normal `npm test` without colliding on 4200.
const FIXTURE = process.env.VG_FIXTURE ?? "test/fixtures/sample_advanced.py";
const PORT = parseInt(process.env.VG_PORT ?? "4200", 10);

export default defineConfig({
  testDir: "test/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `node ${path.join("dist", "server.js")} ${FIXTURE}`,
    port: PORT,
    // Was `true`, and it silently poisoned runs: Playwright only checks that
    // SOMETHING answers on the port, never that it serves this spec's
    // fixture. A leftover server on 4211 (big_demo) made the conn_demo spec
    // fail for a whole session and get written off three times as a
    // "pre-existing, unrelated" failure — including once after a stash-and-
    // recheck, which reproduced only because the stray server was up for
    // both runs. Same cause made test:mcp / test:mcp-run report 20 failures.
    // With reuse off, an occupied port is a loud startup error instead of a
    // wrong-project test run. Each spec already sets its own VG_PORT, so
    // little is lost.
    reuseExistingServer: false,
    timeout: 15_000,
    // M7 wave 2 — preserve PATH + HOME so the spawned server can locate
    // the `claude` CLI (chat backend) and read keychain auth. PYTHONPATH
    // stays explicit so libcst resolves out of .pydeps/.
    env: {
      PYTHONPATH: ".pydeps",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      // M-RUN e2e (test:e2e-run) drives the SM2 arg synthesizer through a
      // deterministic stub instead of the real `claude` CLI (auth/cost —
      // M10R.7). Forwarded only when the invoking script sets them, so other
      // e2e groups (incl. the chat backend) are untouched.
      ...(process.env.VG_CLAUDE_BIN ? { VG_CLAUDE_BIN: process.env.VG_CLAUDE_BIN } : {}),
      ...(process.env.FAKE_SYNTH_RESPONSE ? { FAKE_SYNTH_RESPONSE: process.env.FAKE_SYNTH_RESPONSE } : {}),
      // M-SKILL.5 — the routing e2e asserts on the prompt the chat backend
      // actually sent; the stdio stub appends each turn here when set.
      ...(process.env.FAKE_PROMPT_LOG ? { FAKE_PROMPT_LOG: process.env.FAKE_PROMPT_LOG } : {}),
      // OPUS-SHOWDOWN — opt-in persistent builder session (one stream-json
      // child per build run instead of a claude -p spawn per increment).
      ...(process.env.VG_BUILD_SESSION ? { VG_BUILD_SESSION: process.env.VG_BUILD_SESSION } : {}),
    },
  },
});
