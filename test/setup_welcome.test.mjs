// The setup offered to a NEW project (2026-10-21, src/server/setup_welcome.ts):
// the app opens on a project where nothing of the setup has started and offers
// it, once; "Not now" is kept per person under the cache, never in the project.
// The now-state carries the offer and every setup step in order, for the guide.
//
//   npm run test:setup-welcome
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dismissWelcome, isFreshProject, offerWelcome, welcomeDismissed } from "../src/server/setup_welcome.ts";
import { nowState } from "../src/server/now_state.ts";
import { addConstraint, loadConstraints, removeConstraint } from "../src/server/constraint_store.ts";
import { SETUP_HOOK_MARKER } from "../src/server/setup_state.ts";

let base;
const project = (name) => { const r = join(base, name); mkdirSync(r, { recursive: true }); writeFileSync(join(r, "app.py"), "def main():\n    return 1\n"); return r; };
before(() => { base = mkdtempSync(join(tmpdir(), "vg-welcome-")); process.env.VG_CACHE_DIR = join(base, ".cache-test"); });
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

test("a project is new until any part of the setup starts in it", () => {
  const root = project("fresh");
  assert.equal(isFreshProject(root), true, "code and nothing else");
  mkdirSync(join(root, ".vibegraph"));
  writeFileSync(join(root, ".vibegraph", ".gitignore"), "runs/\n");
  assert.equal(isFreshProject(root), true, "VibeGraph's own .gitignore is not the setup");
  for (const f of ["architecture.json", "brief.json", "plan.json", "setup.json", "direction.json"]) {
    writeFileSync(join(root, ".vibegraph", f), "{}\n");
    assert.equal(isFreshProject(root), false, `${f} means the setup started`);
    rmSync(join(root, ".vibegraph", f));
  }
  const c = addConstraint(root, { kind: "invariant", text: "only the store writes orders", scope: { all: true } }, "human");
  assert.equal(isFreshProject(root), false, "a stated rule");
  removeConstraint(root, c.id);
  assert.equal(loadConstraints(root).length, 0);
  assert.equal(isFreshProject(root), true);
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: `vgk hook prompt ${SETUP_HOOK_MARKER}` }] }] } }));
  // the first field report: .vibegraph deleted to start again, the hooks still
  // installed, and the project was never offered the setup
  assert.equal(isFreshProject(root), true, "installed hooks are not the setup: `init --hooks` often comes first");
});

test("offered once: 'Not now' is kept per person under the cache, and VG_WELCOME=off stops it", () => {
  const root = project("offer");
  assert.equal(offerWelcome(root, {}), true);
  assert.equal(offerWelcome(root, { VG_WELCOME: "off" }), false, "the browser suites run on bare fixtures");
  assert.equal(welcomeDismissed(root), false);
  dismissWelcome(root);
  assert.equal(welcomeDismissed(root), true);
  assert.equal(offerWelcome(root, {}), false);
  assert.equal(existsSync(join(root, ".vibegraph")), false, "nothing written to the project");
  assert.equal(isFreshProject(root), true, "setting the offer aside does not start the setup");
  assert.equal(offerWelcome(project("other"), {}), true, "kept per project");
});

test("the now-state carries the offer, every step in its order, and the next one", () => {
  const root = project("now");
  const s = nowState(root).setup;
  assert.equal(s.welcome, true);
  // with no stack facts yet the software step is left out, never guessed (setup_state.ts)
  assert.deepEqual(s.steps.map((x) => x.id), ["groups", "brief", "rules", "objective", "direction", "hooks"]);
  assert.deepEqual(nowState(root, { stack: { tools: [] } }).setup.steps.map((x) => x.id), ["software", "groups", "brief", "rules", "objective", "direction", "hooks"]);
  const brief = s.steps.find((x) => x.id === "brief");
  assert.equal(brief.spends, true, "the Brief asks a model");
  const groups = s.steps.find((x) => x.id === "groups");
  assert.equal(groups.status, "todo");
  assert.equal(s.next, s.steps.find((x) => x.status === "waiting" || x.status === "todo").id);
  dismissWelcome(root);
  assert.equal(nowState(root).setup.welcome, false);
  assert.ok(readdirSync(process.env.VG_CACHE_DIR).length > 0, "the dismissal lives in the cache");
});
