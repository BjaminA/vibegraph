// Groups first, tools by name, checks said as checks (2026-10-09, from a
// field brief that called a remote, policy-gated command platform "a local
// shell-out": the groups a person had agreed were shown as "not evidence",
// the platform's own definition was never in the facts, and the policy
// checks were dropped for being only tests).
//
//   - a full draft with no settled groups proposes the GROUPS alone, and
//     waits for a person; once settled the brief is drafted without a groups
//     section and a STATED group is citable (group:<id>); --skip-groups keeps
//     the one call
//   - a tool box's definition (the stack taxonomy's TOOL_NOTES) is in the
//     facts as tool-def:<package>
//   - `checked` says a property is tested: it needs a [verify] citation, and a
//     feature resting only on one is told to say so
//
//   npm run test:brief-groups-first
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBriefFacts } from "../src/server/brief_facts.ts";
import { checkLine } from "../src/server/brief_checks.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vg-gfirst-"));
const proj = join(tmp, "p");
cpSync(join(ROOT, "test/fixtures/system/views_demo"), proj, { recursive: true });
for (const f of ["brief.json", "architecture.json"]) rmSync(join(proj, ".vibegraph", f), { force: true });
after(() => rmSync(tmp, { recursive: true, force: true }));
const cli = (args, env = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args],
  { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", VG_PERSON_NO_TTY: "1", ...env } });
const saved = (o) => { const f = join(tmp, `r${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, "```json\n" + JSON.stringify(o) + "\n```"); return f; };
const GROUPS = { groups: [{ op: "add", id: "g-orders", label: "Order decisions", kind: "process", members: ["cluster:scripts:decider"], cites: ["cluster:scripts:decider->zone:ledger/status:uses:write"] }], names: {}, omitted: [] };
const SPEC = { spec: { function: [{ text: "Decides when an order is released, by a state machine run in the decider.", words: ["decides"], cites: ["topology:sm:order-phase", "group:g-orders"], boxes: ["cluster:scripts:decider"] }], method: [], feature: [] }, omitted: [] };

test("with no settled groups the first draft proposes the groups alone, and the brief waits for a person", () => {
  const first = cli(["brief", "codebase", proj, "--reply", saved({ ...GROUPS, ...SPEC })]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^groups first: no groups are settled yet/m);
  const p = JSON.parse(readFileSync(join(proj, ".vibegraph/brief.json"), "utf-8")).proposed;
  assert.deepEqual([p.groups.map((g) => g.id), p.spec.function.length], [["g-orders"], 0], "only the groups were asked for and kept");
  const wait = cli(["brief", "codebase", proj, "--reply", saved(SPEC)]);
  assert.equal(wait.status, 1);
  assert.match(wait.stderr, /the brief's proposed groups wait for a person/);
});

test("once a person ratifies them, the brief is drafted without a groups section and may cite a stated group", () => {
  assert.equal(cli(["brief", "codebase", "ratify", "groups", proj]).status, 0);
  const dry = cli(["brief", "codebase", proj, "--dry-run"]);
  assert.doesNotMatch(dry.stdout, /"groups": \[/, "the settled groups are not re-proposed");
  assert.match(dry.stdout, /- group:g-orders \[stated process\] "Order decisions": cluster:scripts:decider/);
  const r = cli(["brief", "codebase", proj, "--reply", saved(SPEC)]);
  assert.equal(r.status, 0, r.stderr);
  const line = JSON.parse(readFileSync(join(proj, ".vibegraph/brief.json"), "utf-8")).proposed.spec.function[0];
  assert.deepEqual(line.cites, ["topology:sm:order-phase", "group:g-orders"], "a stated group is citable");
});

test("--skip-groups keeps the one-call draft; a PROPOSED group is not citable", () => {
  const p2 = join(tmp, "p2");
  cpSync(join(ROOT, "test/fixtures/system/views_demo"), p2, { recursive: true });
  for (const f of ["brief.json", "architecture.json"]) rmSync(join(p2, ".vibegraph", f), { force: true });
  const r = cli(["brief", "codebase", p2, "--skip-groups", "--reply", saved({ ...GROUPS, ...SPEC })]);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /groups first/);
  const p = JSON.parse(readFileSync(join(p2, ".vibegraph/brief.json"), "utf-8")).proposed;
  assert.deepEqual([p.groups.length, p.spec.function.length], [1, 1]);
  assert.deepEqual(p.spec.function[0].cites, ["topology:sm:order-phase"], "group:g-orders was only proposed: not evidence yet");
  assert.ok(existsSync(join(p2, ".vibegraph/brief.json")));
});

test("a tool box carries what the tool IS, from the vendor's docs", () => {
  const model = { nodes: [{ id: "tool:@grpc/grpc-js", kind: "tool", label: "@grpc/grpc-js", sublabel: "gRPC", refs: [] }], edges: [], groups: [] };
  const f = buildBriefFacts(model, { root: proj, readLines: () => null });
  assert.match(f.text, /WHAT THE TOOLS ARE[^\n]*\n- tool-def:@grpc\/grpc-js \(tool:@grpc\/grpc-js\): gRPC for Node over HTTP\/2/);
  assert.equal(f.roles.get("tool-def:@grpc/grpc-js"), "declare");
});

test("`checked` needs a check; a feature resting only on a check is told to say so", () => {
  const facts = { roles: new Map([["bin/probe.mjs:3", "verify"], ["cluster:a", "use"]]), rules: [], labels: new Map(), data: { ops: [], zones: new Map() } };
  const ok = checkLine("feature", { text: "The command tiers are checked by a probe.", words: ["checked"], cites: ["bin/probe.mjs:3"] }, facts);
  assert.deepEqual([ok.errors, ok.warnings], [[], []]);
  const bad = checkLine("feature", { text: "Tiers are checked.", words: ["checked"], cites: ["cluster:a"] }, facts);
  assert.match(bad.errors.join(), /says the property is checked, but cites no check/);
  const plain = checkLine("feature", { text: "Each identity acts under its own rights.", words: ["per-identity-access"], cites: ["bin/probe.mjs:3"] }, facts);
  assert.match(plain.warnings.join(), /rests only on a check \(\[verify\]\) — say it is `checked`/);
});
