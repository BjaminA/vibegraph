// Rung 4 of the run-time ladder (2026-10-08): a recorded run, opted in by a
// person. On a copy of test/fixtures/declared/feed_ts with a runnable demo (an
// in-memory client listing two inboxes), the run records which zone each
// operation reaches — never the names — and the map marks what it saw.
//
//   npm run test:recorded-runs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { patternRegex } from "../src/server/trace_config.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vg-runs-"));
const proj = join(tmp, "p");
cpSync(join(ROOT, "test/fixtures/declared/feed_ts"), proj, { recursive: true });
after(() => rmSync(tmp, { recursive: true, force: true }));
writeFileSync(join(proj, "bin/demo.ts"), [
  "#!/usr/bin/env node",
  "// a demo run: an in-memory client with two inboxes; the feed reads and watches them",
  'import { Registry, type Client, type Channel } from "../src/registry.ts";',
  'import { inboxFeed } from "../src/feed.ts";',
  "const channel = (): Channel => ({ watch: () => () => {}, read: async () => \"\" });",
  'const client: Client = { list: async () => ["reviewer--ann", "clerk--bob"], open: async () => channel() };',
  "const registry = new Registry(client);",
  "const feed = inboxFeed(registry, await registry.inboxes());",
  "await feed.readAll();",
  "await feed.watchAll(() => {});",
  "",
].join("\n"));
const cli = (args, env = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args],
  { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", ...env } });
const runFiles = () => { try { return readdirSync(join(proj, ".vibegraph/traces")).filter((f) => f.startsWith("run-")); } catch { return []; } };

test("a hole matches any run of characters; the rest is literal", () => {
  assert.equal(patternRegex("inbox_{Role}__{User}"), "^inbox_.+?__.+?$");
  assert.ok(new RegExp(patternRegex("a.b/{x}")).test("a.b/1") && !new RegExp(patternRegex("a.b/{x}")).test("axb/1"));
});

test("nothing is recorded until a person enables it; an agent cannot", () => {
  assert.equal(cli(["trace", "run", proj, "--", process.execPath, "bin/demo.ts"]).status, 1);
  assert.deepEqual(runFiles(), []);
  const agent = cli(["trace", "enable", proj], { CLAUDECODE: "1" });
  assert.equal(agent.status, 1);
  assert.match(agent.stderr, /refused: `trace enable`/);
});

test("enabled, a run records the zone of each operation — not a name — and the map marks it observed", () => {
  const on = cli(["trace", "enable", proj]);
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /tracing ENABLED[\s\S]*never a value, a key or a name/);
  const settings = JSON.parse(readFileSync(join(proj, ".claude/settings.local.json"), "utf-8"));
  assert.match(settings.env.NODE_OPTIONS, /--import=file:\/\/.*node_tracer\.mjs\?root=/, "Node processes Claude Code starts here load the recorder");
  assert.match(readFileSync(join(proj, ".vibegraph/.gitignore"), "utf-8"), /traces\/run-\*\.jsonl/);
  const r = cli(["trace", "run", proj, "--", process.execPath, "bin/demo.ts"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const files = runFiles();
  assert.equal(files.length, 1, r.stdout);
  const events = readFileSync(join(proj, ".vibegraph/traces", files[0]), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([...new Set(events.map((e) => `${e.actor} ${e.action} ${e.zone}`))].sort(), ["bin/demo.ts read inbox", "bin/demo.ts watch inbox"]);
  assert.ok(events.every((e) => Object.keys(e).sort().join() === "action,actor,at,source,zone"), "nothing but who, what verb, which zone, when");
  assert.doesNotMatch(readFileSync(join(proj, ".vibegraph/traces", files[0]), "utf-8"), /reviewer|ann|clerk|bob/, "no name is written");
  assert.match(r.stdout, /1 recorded run\(s\)[\s\S]*Scripts read store\/inbox — in 1 run/, "the demo runs in the Scripts box beside the decider");
  cli(["export", proj]);
  const md = readFileSync(join(proj, ".vibegraph/knowledge/architecture.md"), "utf-8");
  assert.match(md, /observed in 1 recorded run/, "the map says what the run saw");
});

test("an operation a run saw that the code does not show is OBSERVED — an edge said as such, a fact the Brief can rest on", async () => {
  const { buildPolyglotEnvelope } = await import("../scripts/regen_polyglot.mjs");
  const { buildStackIndex } = await import("../src/server/stack.ts");
  const { buildCrossingIndex } = await import("../src/server/crossings.ts");
  const { archModelForEnvelope } = await import("../src/server/arch_envelope.ts");
  const { briefInputs } = await import("../src/server/brief_inputs.ts");
  // the code reads and watches the inboxes; a run saw the decider WRITE one
  writeFileSync(join(proj, ".vibegraph/traces/run-by-hand.jsonl"), JSON.stringify({ actor: "bin/decider.ts", action: "write", zone: "inbox", at: "2026-10-08T00:00:00Z", source: "vibegraph-tracer" }) + "\n");
  const env = buildPolyglotEnvelope(proj).envelope;
  const model = archModelForEnvelope(env, buildStackIndex(env, proj), buildCrossingIndex(env), proj);
  const e = model.edges.find((x) => x.evidence === "observed");
  assert.ok(e && e.protocol === "write" && e.to.endsWith("/inbox"), model.edges.map((x) => `${x.id} ${x.evidence ?? ""}`).join("\n"));
  assert.match(briefInputs(proj, model).facts.text, /zone:store\/inbox: [^\n]*writes by Scripts \(observed in a recorded run, not seen in the code\)/);
});

test("disabled, the recorder is not loaded and records nothing more; forbidden, it cannot be enabled", () => {
  assert.equal(cli(["trace", "disable", proj]).status, 0);
  const settings = JSON.parse(readFileSync(join(proj, ".claude/settings.local.json"), "utf-8"));
  assert.equal(settings.env?.NODE_OPTIONS, undefined);
  const before = runFiles().length;
  spawnSync(process.execPath, ["bin/demo.ts"], { cwd: proj, env: { ...process.env, NODE_OPTIONS: `--import=${new URL("../scripts/node_tracer.mjs", import.meta.url).href}?root=${encodeURIComponent(proj)}` } });
  assert.equal(runFiles().length, before, "loaded by hand while disabled, the recorder does nothing");
  assert.equal(cli(["trace", "forbid", proj]).status, 0);
  const again = cli(["trace", "enable", proj]);
  assert.equal(again.status, 1);
  assert.match(again.stdout + again.stderr, /forbidden/);
  assert.ok(existsSync(join(proj, ".vibegraph/trace.json")));
});
