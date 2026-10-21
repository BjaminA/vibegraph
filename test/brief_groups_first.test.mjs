// Groups first, tools by name, checks said as checks (2026-10-09, from a
// field brief that called a remote, policy-gated command platform "a local
// shell-out": the groups a person had agreed were shown as "not evidence",
// the platform's own definition was never in the facts, and the policy
// checks were dropped for being only tests).
//
//   - a full draft with no settled groups proposes the GROUPS alone, and
//     waits for a person; once settled the brief is drafted without a groups
//     section and a STATED group is citable (group:<id>); --skip-groups keeps
//     the one call. Since 2026-10-21 the groups alone are the architecture
//     proposal (`architecture --propose`, with rules), not the Brief's section
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
import { ratifiedAt } from "../src/server/arch_store.ts";

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

// 2026-10-21 — the groups first are the ARCHITECTURE PROPOSAL (the map's
// "Propose groups"), with rules a later box joins by; its reply shape
const ARCH = { groups: [{ id: "g-orders", kind: "process", label: "Order decisions", match: [{ kind: "cluster", rootPrefix: "scripts" }], wraps: ["cluster:scripts:decider"], evidence: [] }], names: {}, narrative: "Orders are decided by a script." };

test("with no settled groups the first draft is the architecture proposal, and the brief waits for a person", () => {
  const dry = cli(["brief", "codebase", proj, "--dry-run"]);
  assert.match(dry.stdout, /You are proposing the DEPLOYMENT and TRUST grouping/, "the map's own proposal prompt, not the Brief's");
  assert.match(dry.stdout, /GROUPS MUST OUTLAST THE CODE/);
  const first = cli(["brief", "codebase", proj, "--reply", saved(ARCH)]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^groups first: no groups are settled yet/m);
  assert.match(first.stdout, /architecture --ratify \| --reject/);
  const proposal = JSON.parse(readFileSync(join(proj, ".vibegraph/architecture.json"), "utf-8")).proposal;
  assert.deepEqual(proposal.groups.map((g) => [g.id, g.match]), [["g-orders", [{ kind: "cluster", rootPrefix: "scripts" }]]], "kept with its rule");
  assert.ok(!existsSync(join(proj, ".vibegraph/brief.json")), "no Brief was drafted");
  const wait = cli(["brief", "codebase", proj, "--reply", saved(SPEC)]);
  assert.equal(wait.status, 1);
  assert.match(wait.stderr, /a proposed architecture waits for a person/);
});

test("once a person ratifies them, the brief is drafted without a groups section and may cite a stated group", () => {
  assert.equal(cli(["architecture", "--ratify", proj]).status, 0);
  // ratified = the stamp every "are the groups settled?" asks, and the
  // baseline drift reads
  const arch = JSON.parse(readFileSync(join(proj, ".vibegraph/architecture.json"), "utf-8"));
  assert.match(arch.ratified?.at ?? "", /^\d{4}-\d\d-\d\dT/);
  assert.ok(arch.baseline?.clusters?.includes("cluster:scripts:decider"), "drift is measured from the map as it was ratified");
  const setup = cli(["setup", proj]);
  assert.match(setup.stdout, /\[done\] 2\. Architecture groups\n\s+1 group\(s\), ratified \d{4}-/);
  // a store an earlier version wrote this way (no stamp) still reads as ratified
  assert.deepEqual(ratifiedAt({ groups: [{ id: "g", kind: "process", label: "x", wraps: [], note: "from the brief (claude); evidence: e1" }], names: {} }), { at: "", model: "claude" });
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
  // a Brief's own groups section is still decided through the Brief, and that
  // ratification is RATIFIED (2026-10-20, live setup run: the stamp every
  // "are the groups settled?" asks)
  assert.equal(cli(["brief", "codebase", "ratify", "groups", p2]).status, 0);
  assert.match(JSON.parse(readFileSync(join(p2, ".vibegraph/architecture.json"), "utf-8")).ratified?.at ?? "", /^\d{4}-\d\d-\d\dT/);
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
