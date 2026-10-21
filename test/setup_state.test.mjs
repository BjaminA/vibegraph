// THE SETUP (2026-10-20, src/server/setup_state.ts + scripts/cli/setup.mjs):
// one fixed order — software specs, architecture groups, the Brief, rules,
// (direction), hooks, and after the setup, not counted, a plan for what is built
// next (2026-10-21) — read from the project's files at zero tokens. Walked here on test/fixtures/setup/setup_demo: a
// script posting through an in-house SDK no table knows, a Firestore mirror
// (a platform SDK), a shell script running an in-house command, and a README
// that names the SDK beside its docs page.
//
//   npm run test:setup
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvelope } from "../scripts/quality_check.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { setupState, SETUP_HOOK_MARKER } from "../src/server/setup_state.ts";
import { repoUrl, publishedReadme } from "../src/server/software_candidates.ts";
import { runSetup, setupText } from "../scripts/cli/setup.mjs";
import { nowState } from "../src/server/now_state.ts";
import { saveSpec } from "../src/server/software_store.ts";
import { loadArchStore, saveArchStore } from "../src/server/arch_store.ts";
import { saveBrief } from "../src/server/brief_store.ts";
import { addConstraint } from "../src/server/constraint_store.ts";
import { emptyPlan, savePlan } from "../src/server/plan_store.ts";
import { OBSERVED_OBJECTIVE } from "../src/server/plan_observe.ts";
import { cacheDirFor } from "../scripts/envelope_cache.mjs";
import { HOOK_MARKER, applySkills, outdatedSkills } from "../scripts/cli/init.mjs";
import { locate } from "../scripts/cli/paths.mjs";
import { spawnSync } from "node:child_process";

delete process.env.CLAUDECODE; // acts as a person
let base, root, stack;
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-setup-"));
  process.env.VG_CACHE_DIR = join(base, "cache");
  root = join(base, "setup_demo");
  cpSync("test/fixtures/setup/setup_demo", root, { recursive: true });
  const { envelope } = loadEnvelope(root, null, {}, { cache: false });
  stack = buildStackIndex(envelope, root);
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

const state = () => setupState(root, { stack });
const step = (s, id) => s.steps.find((x) => x.id === id);
const restack = () => { stack = buildStackIndex(loadEnvelope(root, null, {}, { cache: false }).envelope, root); };

test("the order, and the first step: a platform SDK is a candidate; a package no table knows is classified FIRST", () => {
  const s = state();
  assert.deepEqual(s.steps.map((x) => x.id), ["software", "groups", "brief", "rules", "direction", "hooks", "plan"]);
  assert.equal(s.next.id, "software");
  assert.equal(s.of, 5, "direction is optional and the plan comes after the setup: neither is counted");
  assert.equal(s.after, null, "the plan is offered only once nothing in the setup is left");
  // a boundary tool a table knows (redis, a cache) is a candidate too, after the platform:
  // knowing its role is not knowing how this project must use it
  assert.deepEqual(s.software.candidates.map((x) => [x.name, x.kind, x.role]), [["firebase", "platform", "platform"], ["redis", "table", "cache"]]);
  assert.match(step(s, "software").facts.join("\n"), /redis \(redis\) — cache; a table knows its role — a spec adds its current API and rules/);
  // the README names redis beside a link to a HOSTING provider: a mention,
  // ranked after the package's own README (the live run drafted the postgres
  // driver from its host's marketing page, 20 of 57 items unquoted)
  assert.deepEqual(s.software.candidates[1].docs, [
    { url: "https://cdn.jsdelivr.net/npm/redis@4.7.0/README.md", from: "redis's published README (jsDelivr, the version the manifest declares)" },
    { url: "https://upstash.com/redis", from: "README.md" },
  ], "its published README first; a product link that only names it after");
  // the live run on a public Next.js app: six of eight "candidates" were UI
  // libraries no table knew — not knowing a role is a question, not a spec
  assert.deepEqual(s.software.unclassified.map((x) => x.name), ["@acme/ledger-client"]);
  const cmds = step(s, "software").commands.map((c) => c.run);
  assert.ok(cmds.includes("vibegraph-knowledge classify --apply"), cmds.join("\n"));
  assert.match(step(s, "software").now.text, /Classify the 1 package no table knows/);
  assert.deepEqual(s.software.commands.map((x) => x.name), ["ledgerctl"], "a command no table knows is listed, never held open");
  assert.ok(!s.software.candidates.some((x) => x.name === "src.mirror"), "the project's own funnel is not a tool to specify");
});

test("classified as a boundary it becomes a candidate, with the docs link found in the project's prose; classified as a utility it needs no spec", () => {
  const classify = (tool, role) => addConstraint(root, { kind: "stack-policy", text: `${tool}, classified`, scope: { stack: [tool] }, note: "classified by test (agent — NOT human-reviewed)", policy: { tool, role, rule: "describe" } }, "agent");
  classify("@acme/ledger-client", "platform");
  restack();
  const s = state();
  assert.deepEqual(s.software.unclassified, []);
  const c = s.software.candidates.find((x) => x.name === "acme");
  assert.deepEqual([c.kind, c.role, c.packages], ["classified", "platform", ["@acme/ledger-client"]], "a scope is one candidate named for it");
  assert.deepEqual(c.docs[0], { url: "https://ledger.example.com/docs/client", from: "README.md" }, "the project's own docs line names the package exactly: it comes first");
  assert.equal(c.docs[1].url, "https://cdn.jsdelivr.net/npm/@acme/ledger-client@1.2.0/README.md", "then its published README");
  const add = step(s, "software").commands.find((x) => x.run.includes("software add acme"));
  assert.deepEqual(add, { run: "vibegraph-knowledge software add acme --from https://ledger.example.com/docs/client", who: "claude", why: add.why, spends: true });
  // the classification is not a rule waiting for a person
  assert.equal(step(s, "rules").status, "todo");
});

test("a package with no docs anywhere gets its published README as the source", () => {
  assert.deepEqual(publishedReadme({ tool: "@vercel/blob", version: "^1.2.3", evidence: [{ file: "app/api/upload/route.ts", kind: "import" }] }),
    { url: "https://cdn.jsdelivr.net/npm/@vercel/blob@1.2.3/README.md", from: "@vercel/blob's published README (jsDelivr, the version the manifest declares)" });
  assert.equal(publishedReadme({ tool: "postgres", version: "latest", evidence: [{ file: "lib/db.ts", kind: "import" }] }).url, "https://cdn.jsdelivr.net/npm/postgres/README.md");
  assert.equal(publishedReadme({ tool: "httpx", evidence: [{ file: "svc/client.py", kind: "import" }] }).url, "https://pypi.org/pypi/httpx/json");
  assert.equal(publishedReadme({ tool: "libfoo", evidence: [{ file: "src/a.cpp", kind: "include" }] }), null);
});

test("the checklist's hook marker is the installer's (it cannot import init.mjs into the server bundle)", () => {
  assert.equal(SETUP_HOOK_MARKER, HOOK_MARKER);
});

test("live run, first finding: an installed skill names the exact command that installed it, never @latest", () => {
  const skills = join(base, "skills-home");
  const r = applySkills({ names: ["vibegraph", "vibegraph-setup", "vibegraph-rules"], root: skills, loc: locate(), cli: { invocation: ["npx", "--yes", "vibegraph-knowledge@0.36.0"], version: "0.36.0" } });
  for (const x of r) {
    const body = readFileSync(x.path, "utf-8");
    assert.match(body, /^---\nname: [\w-]+\ndescription: .+\n---\n\n> \*\*In this project, run VibeGraph as `npx --yes vibegraph-knowledge@0\.36\.0`\*\*/, `${x.name}: the note right after the frontmatter`);
    assert.doesNotMatch(body.replace(/^> \*\*In this project.*$/m, ""), /vibegraph-knowledge@latest/, `${x.name}: no @latest command left (the note names it only to rule it out)`);
  }
  // and the CLI answers --help after a command instead of failing on it
  const cli = (args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", ...args], { encoding: "utf-8" });
  const sw = cli(["software", "add", "--help"]);
  assert.equal(sw.status, 0, sw.stderr);
  assert.match(sw.stdout, /add <tool> --from <url\|file>/);
  const st = cli(["setup", "--help"]);
  assert.equal(st.status, 0, st.stderr);
  assert.match(st.stdout, /^usage:\n {2}vibegraph-knowledge setup \[<root>\]/);
});

test("a repository field becomes a browsable link, or nothing", () => {
  assert.equal(repoUrl("git+https://github.com/acme/ledger.git"), "https://github.com/acme/ledger");
  assert.equal(repoUrl({ url: "git://github.com/acme/ledger.git" }), "https://github.com/acme/ledger");
  assert.equal(repoUrl("github:acme/ledger"), "https://github.com/acme/ledger");
  assert.equal(repoUrl("acme/ledger"), "https://github.com/acme/ledger");
  assert.equal(repoUrl("file:../ledger"), null);
});

test("set aside, specified, then each later step in turn — every one read from the project's files", () => {
  // the CLI's door: skipping needs a reason; only the optional step is skippable
  assert.equal(runSetup(["skip", "software", "firebase", root]).exitCode, 2, "a reason is required");
  assert.equal(runSetup(["skip", "rules", root, "--why", "x"]).exitCode, 2, "a core step is not skippable");
  assert.equal(runSetup(["skip", "software", "firebase", root, "--why", "a public SDK the team knows"]).exitCode, 0);
  assert.equal(runSetup(["skip", "software", "redis", root, "--why", "the team knows the client"]).exitCode, 0);
  // a DRAFT spec waits for a person; the candidate it covers leaves the list
  const spec = (status) => ({ version: "1", tool: "acme", role: "platform", definition: "The ledger team's SDK for posting entries.", definitionCite: null, status,
    identity: { packages: ["@acme/ledger-client"], calls: ["postEntry"] }, operations: [], states: [], permissions: [], rules: [], sources: [] });
  assert.equal(saveSpec(root, spec("draft")).error, undefined);
  let s = state();
  assert.equal(step(s, "software").status, "waiting");
  assert.equal(s.software.candidates.length, 0);
  assert.match(step(s, "software").facts.join("\n"), /set aside: firebase \(a public SDK the team knows\)/);
  assert.ok(step(s, "software").commands.some((c) => c.run === "vibegraph-knowledge software ratify acme" && c.who === "you"));
  assert.equal(saveSpec(root, spec("ratified")).error, undefined);
  s = state();
  assert.equal(step(s, "software").status, "done");
  assert.equal(s.next.id, "groups");
  assert.deepEqual(s.next.commands.map((c) => [c.run, c.who, !!c.spends]), [["vibegraph-knowledge brief codebase --estimate", "either", false], ["vibegraph-knowledge brief codebase", "claude", true]]);

  saveArchStore(root, { ...loadArchStore(root), ratified: { at: "2026-10-20T10:00:00.000Z", model: "test" } });
  saveBrief(root, { version: "1", ratified: { spec: { function: [], method: [], feature: [] }, at: "2026-10-20T10:00:00.000Z", by: "ben", model: "test" } });
  s = state();
  assert.equal(s.next.id, "rules");

  addConstraint(root, { kind: "invariant", text: "every entry is posted through the ledger SDK, never raw HTTP", scope: { all: true } }, "agent");
  s = state();
  assert.equal(step(s, "rules").status, "waiting", "a model's rule waits for a person");
  assert.match(s.next.now.text, /1 proposed rule waits for you/);
  addConstraint(root, { kind: "invariant", text: "settled entries are mirrored once, never edited after", scope: { all: true } }, "human");
  s = state();
  assert.equal(step(s, "rules").status, "waiting", "the model's rule still waits");

  // the plan: after the setup, optional until started; a proposal in it waits
  // for a person, but the setup's own steps still come first
  assert.equal(step(s, "plan").status, "optional");
  const plan = emptyPlan("A ledger recorder that posts entries through the ledger SDK and mirrors settled ones to Firestore");
  const p1 = { id: "p1", text: "Only src/ledger.ts imports @acme/ledger-client", why: "one place to change" };
  savePlan(root, { ...plan, policies: [{ ...p1, status: "proposed" }] });
  s = state();
  assert.equal(step(s, "plan").status, "waiting");
  assert.equal(s.next.id, "rules", "a setup step left comes before the plan");
  savePlan(root, { ...plan, policies: [{ ...p1, status: "agreed" }] });
  s = state();
  assert.equal(step(s, "plan").status, "done");
  savePlan(root, plan);
  assert.equal(step(state(), "plan").status, "done", "an objective is enough: principles are the plan's, not the setup's");

  // hooks: installed but not fired, then fired
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: `node cli hook prompt ${HOOK_MARKER}` }] }] } }));
  assert.equal(step(state(), "hooks").status, "waiting");
  mkdirSync(cacheDirFor(root), { recursive: true });
  writeFileSync(join(cacheDirFor(root), "hooks-fired.json"), JSON.stringify({ prompt: { at: new Date(Date.now() + 1000).toISOString(), session: "x" } }));
  s = state();
  assert.equal(step(s, "hooks").status, "done");
  assert.equal(s.done, 4, "every core step but the waiting rules");
  assert.equal(s.next.id, "rules");
});

test("the CLI prints the order with who may run what, and the app's Next line follows the same order", () => {
  const out = runSetup([root]).text;
  assert.match(out, /^VibeGraph setup for .*: 4 of 5 steps done\. Next: Rules the code must keep\./);
  assert.match(out, /\nAfter the setup, not counted in it:\n\[done\] 7\. A plan for what you build next\n/);
  assert.match(out, /\[next\] 4\. Rules the code must keep \(waiting for you\)/);
  assert.match(out, /you:\s+vibegraph-knowledge constraints ratify <id>/);
  assert.match(out, /"you:" is a person's step/);
  const json = JSON.parse(runSetup([root, "--json"]).text);
  assert.equal(json.next.id, "rules");
  // the app: a decision waiting outranks the setup; here the model's rule is one
  const n = nowState(root, { stack });
  assert.equal(n.setup.of, 5);
  assert.equal(n.next.panel, n.waiting ? "inbox" : "rules");
});

test("live run, session 3: the tool's own name as a command, commands as run, a stale direction proposal", () => {
  const cli = (args, env = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", ...args], { encoding: "utf-8", env: { ...process.env, ...env } });
  // given the pinned command, a session ran `<cli> vibegraph-knowledge setup`
  const out = cli(["vibegraph-knowledge", "setup", root]);
  assert.equal(out.status, 0, out.stderr);
  // and every command it prints is the one that ran it, ready to paste
  assert.match(out.stdout, /you:\s+"[^"]+" "--experimental-strip-types" "--no-warnings" "[^"]+scripts\/cli\/main\.mjs" constraints ratify <id>/);
  assert.doesNotMatch(out.stdout, /^\s+(you:|either:|Claude may:)\s+vibegraph-knowledge /m);
  // dropping the name changes nothing about who may take a step
  const ratify = cli(["vibegraph-knowledge", "constraints", "ratify", "c1", root], { CLAUDECODE: "1" });
  assert.equal(ratify.status, 1);
  assert.match(ratify.stderr, /refused: `constraints ratify`/);
  // the skill's note says what "the same arguments" means, with an example
  const r = applySkills({ names: ["vibegraph-setup"], root: join(base, "skills-note"), loc: locate(), cli: { invocation: ["npx", "--yes", "vibegraph-knowledge@0.36.0"], version: "0.36.0" } });
  assert.match(readFileSync(r[0].path, "utf-8"), /`vibegraph-knowledge setup` means `npx --yes vibegraph-knowledge@0\.36\.0 setup`/);

  // a census proposal stored from code that has since changed
  mkdirSync(join(root, ".vibegraph"), { recursive: true });
  writeFileSync(join(root, ".vibegraph", "direction.json"), JSON.stringify({ version: "1", censusAt: "2026-10-20T09:00:00.000Z", rules: [
    { id: "d1", text: "Reach fetch through src.util (src/util.ts), not directly", why: "52 files use fetch through src/util.ts; 9 reach it directly", basis: "funnel:fetch", evidence: ["src/util.ts"], status: "proposed", stamp: "old" },
  ] }));
  const dir = step(setupState(root, { stack, census: [] }), "direction");
  assert.equal(dir.status, "waiting");
  assert.match(dir.facts.join("\n"), /d1: read from the code as it was at the census, and the code says otherwise now/);
  assert.equal(dir.commands[0].run, "vibegraph-knowledge direction project census", "re-read first, zero tokens");
  const list = cli(["direction", "project", root]);
  assert.match(list.stdout, /NOW: the code no longer shows this/);
  const agree = cli(["direction", "project", "agree", "d1", root]);
  assert.equal(agree.status, 1);
  assert.match(agree.stdout + agree.stderr, /d1 was read from the code as it was at the census, and the code no longer shows it/);
  assert.equal(cli(["direction", "project", "drop", "d1", root]).status, 0, "dropping a stale proposal is always allowed");
});

test("live run, session 4: a skill an older version installed is named, with the command that refreshes it", () => {
  const proj = join(base, "skills-stale");
  const home = join(base, "skills-stale-home");
  mkdirSync(proj, { recursive: true }); mkdirSync(home, { recursive: true });
  const cli = { invocation: ["npx", "--yes", "vibegraph-knowledge@0.36.0"], version: "0.36.0" };
  const installed = applySkills({ names: ["vibegraph", "vibegraph-setup"], root: proj, loc: locate(), cli });
  assert.deepEqual(outdatedSkills({ root: proj, loc: locate(), home }), [], "as installed: current, whatever command it was pinned to");
  // what an older version wrote: its own words
  const setupSkill = installed.find((x) => x.path.includes("vibegraph-setup")).path;
  writeFileSync(setupSkill, readFileSync(setupSkill, "utf-8").replace("printed as they should be run.", "for the next one."));
  const stale = outdatedSkills({ root: proj, loc: locate(), home });
  assert.deepEqual(stale.map((s) => [s.name, s.user]), [["vibegraph-setup", false]]);
  const text = setupText({ done: 0, of: 6, next: null, steps: [] }, proj, "node main.mjs", stale);
  assert.match(text, /note: vibegraph-setup was installed by an older VibeGraph and says things this one does not — refresh before following it: node main\.mjs init --skill/);
});

test("live run, session 6: a command's own help under either spelling; no plan means a person starts it first", () => {
  const cli = (args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", ...args], { encoding: "utf-8" });
  for (const spelling of ["constraints", "constraint"]) {
    const h = cli([spelling, "draft", "--help"]);
    assert.equal(h.status, 0, h.stderr);
    assert.match(h.stdout, /^usage:\n {2}vibegraph-knowledge constraint\(s\) list\|/, `${spelling}: its own usage, not the whole list`);
    assert.doesNotMatch(h.stdout, /vibegraph-knowledge view/);
  }
  const fresh = join(base, "no-plan");
  cpSync("test/fixtures/setup/setup_demo", fresh, { recursive: true });
  const obj = step(setupState(fresh, { stack }), "plan");
  assert.equal(obj.status, "optional", "after the setup, and the move that starts it is a person's");
  assert.deepEqual(obj.commands.map((c) => [c.run.split(" ").slice(1, 3).join(" "), c.who]), [["plan observe", "you"], ["plan init", "you"], ["plan draft", "claude"]]);
  const draft = cli(["plan", "draft", "--direction", "--root", fresh]);
  assert.equal(draft.status, 1);
  assert.match(draft.stdout + draft.stderr, /no plan yet, and starting one is a person's step: `vibegraph-knowledge plan observe` .* nothing was spent/);
  // once a plan exists with its objective left open, the person states it by an edit, never `plan init`
  savePlan(fresh, emptyPlan(OBSERVED_OBJECTIVE));
  const started = step(setupState(fresh, { stack }), "plan");
  assert.equal(started.status, "todo", "started with its objective left open");
  const runs = started.commands.map((c) => c.run);
  assert.ok(runs.some((r) => r.includes(`plan edit '{"op":"set-objective"`)), runs.join(" | "));
  assert.ok(!runs.some((r) => r.includes("plan init")), "a plan exists: init would be refused");
});

test("2026-10-21: the plan is offered only once every setup step is done, then the app says to start a task", () => {
  const proj = join(base, "all-done");
  cpSync("test/fixtures/setup/setup_demo", proj, { recursive: true });
  const none = { tools: [] }; // no packages to specify: the software step reads done
  saveArchStore(proj, { ...loadArchStore(proj), ratified: { at: "2026-10-21T10:00:00.000Z", model: "test" } });
  saveBrief(proj, { version: "1", ratified: { spec: { function: [], method: [], feature: [] }, at: "2026-10-21T10:00:00.000Z", by: "ben", model: "test" } });
  addConstraint(proj, { kind: "invariant", text: "settled entries are mirrored once, never edited after", scope: { all: true } }, "human");
  mkdirSync(join(proj, ".claude"), { recursive: true });
  writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `x ${HOOK_MARKER}` }] }] } }));
  mkdirSync(cacheDirFor(proj), { recursive: true });
  writeFileSync(join(cacheDirFor(proj), "hooks-fired.json"), JSON.stringify({ stop: { at: new Date(Date.now() + 1000).toISOString() } }));
  let s = setupState(proj, { stack: none });
  assert.deepEqual([s.done, s.of, s.next], [5, 5, null]);
  assert.equal(s.after?.id, "plan");
  const text = setupText(s, proj);
  assert.match(text, /5 of 5 steps done\. Every step is done\. After the setup: A plan for what you build next\./);
  assert.match(text, /\[then\] 7\. A plan for what you build next \(optional\)\n[\s\S]*you:\s+vibegraph-knowledge plan observe/);
  assert.deepEqual(nowState(proj, { stack: none }).next, { text: "Plan what you build next", panel: "plan" });
  savePlan(proj, emptyPlan("A ledger recorder that posts entries through the ledger SDK"));
  s = setupState(proj, { stack: none });
  assert.equal(s.after, null);
  assert.deepEqual(nowState(proj, { stack: none }).next, { text: "Start a task with Claude Code", panel: "agents" });
});
