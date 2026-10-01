// Greenfield prompt routing (2026-10-01, item 9 of the hooks-feedback brief):
// a prompt about a planned thread the code does not have yet gets THAT
// thread's plan — what it serves, where it will live, its primary steps with
// the boundary they cross, the open question about it — and not a keyword
// guess at existing code. Once per thread per session.
//
//   npm run test:plan-prompt
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runHook } from "../scripts/cli/hooks.mjs";

let base, root;
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-planprompt-"));
  root = join(base, "map");
  process.env.VG_CACHE_DIR = join(base, "cache");
  cpSync("test/fixtures/plan/map_demo", root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });
const ctx = (session, prompt) => runHook("prompt", { session_id: session, prompt }, { absRoot: root, pipeline: {} })?.json?.hookSpecificOutput?.additionalContext ?? "";

test("a prompt about an unbuilt planned thread gets its plan, not a keyword guess", () => {
  const out = ctx("g", "let us build render_dashboard now so operators see the forecasts");
  assert.match(out, /### Planned thread "render_dashboard" — NOT BUILT YET/);
  assert.match(out, /serves: operators see/);
  assert.match(out, /process Dashboard \(code to live at web\/\)/);
  assert.match(out, /primary steps: fetch_forecasts → b3:get \[dashboard → api over HTTP, carries pump_id\]/);
  assert.match(out, /open questions it depends on: q1 Server-render the dashboard/);
  assert.doesNotMatch(out, /Possibly related: thread/, "no keyword guess at existing code");
  assert.doesNotMatch(out, /named no code VibeGraph could route/);
  assert.doesNotMatch(ctx("g", "keep going on render_dashboard"), /Planned thread "render_dashboard"/, "once per session");
});

test("words alone route too (two distinctive words of its id, purpose or steps); a built thread is not sent this way", () => {
  assert.match(ctx("w", "the forecasts read endpoint: start with read_forecasts"), /### Planned thread "GET \/forecasts"/);
  assert.doesNotMatch(ctx("b", "change the POST /readings validation"), /Planned thread "POST \/readings"/, "realised: its real thread is routed instead");
});
