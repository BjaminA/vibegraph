// The Brief (2026-10-08): one model call writes the system's function /
// method / key features, group changes, names, scopes and a start-here path
// — and nothing of it survives that the facts it was shown do not support.
// On a copy of test/fixtures/system/views_demo, through the real CLI, with a
// SAVED reply (no model is called):
//
//   B1  the vocabulary: a project adds words, never redefines one
//   B5  citations not shown are dropped (a line left with none is INFERRED);
//       a line with no vocabulary word is refused; a box's own id is no
//       evidence for its name; group changes need a citation and real
//       members; scopes only for silent boxes; limits hold; left-out listed
//   the store: PROPOSED until a person ratifies (an agent is refused); spec
//       ratified into brief.json, groups into architecture.json; the export's
//       architecture.md opens with the ratified Brief; a cited line that
//       changes makes the line STALE
//
//   npm run test:brief
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeBriefVocabulary } from "../src/shared/brief_types.ts";
import { buildBriefFacts } from "../src/server/brief_facts.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vg-brief-"));
const proj = join(tmp, "p");
cpSync(join(ROOT, "test/fixtures/system/views_demo"), proj, { recursive: true });
after(() => rmSync(tmp, { recursive: true, force: true }));
const cli = (args, env = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args],
  { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", ...env } });

const reply = {
  spec: {
    function: [
      { text: "Decides when an order is released, by a state machine run in the decider.", words: ["decides"], cites: ["topology:sm:order-phase", "cluster:scripts:decider->zone:ledger/status:uses:write"], boxes: ["cluster:scripts:decider"] },
      { text: "Serves clerks and partners who file order requests.", words: ["serves"], cites: ["cluster:cli-package-script:app->zone:ledger/requests:uses:write"] },
      { text: "A third function line.", words: ["exchanges"], cites: ["cluster:cli-package-script:gateway->zone:ledger/status:uses:read"] },
      { text: "A fourth function line, over the limit.", words: ["reports"], cites: ["plan:stores:ledger"] },
    ],
    method: [
      { text: "Teleports orders between hosts.", words: ["teleports"], cites: ["tool:fetch"] },
      { text: "Partitions the ledger so the decider alone writes status.", words: ["partitions", "levitates"], cites: ["topology:store:ledger", "cluster:scripts:decider->zone:ledger/status:uses:write"], boxes: ["cluster:scripts:decider", "zone:ledger/status", "no:such:box"] },
    ],
    feature: [{ text: "Decisions are kept for audit.", words: ["audit-trail"], cites: ["docs/AUDIT.md:3"] }],
  },
  groups: [
    { op: "add", id: "g-ledger-writers", label: "Ledger writers", kind: "trust", members: ["cluster:scripts:.", "cluster:scripts:decider", "no:such:box"], cites: ["cluster:scripts:.->zone:ledger/approver:uses:write"] },
    { op: "rename", id: "g-missing", label: "Nothing", cites: ["topology:store:ledger"] },
    { op: "add", id: "g-uncited", label: "No evidence", members: ["tool:fetch"], cites: [] },
  ],
  names: { "tool:fetch": { name: "Ledger HTTP client", cites: ["tool:fetch"] } },
  scopes: [{ box: "tool:fetch", summary: "an HTTP client", words: [{ word: "call", cites: [] }], cites: [] }],
  primaryPath: { steps: ["tools/appoint.ts:main", "decider/bin/decider.ts:main", "nowhere:main"], cites: ["plan:processes:decider"] },
  omitted: ["the archiver: planned, not built"],
};

test("B1: a project adds brief words; a redefinition or a malformed word is refused", () => {
  const r = mergeBriefVocabulary({ method: { federates: "joins several stores into one view", enforces: "redefined", "Bad Word": "x" } });
  assert.equal(r.vocab.method.federates, "joins several stores into one view");
  assert.match(r.vocab.method.enforces, /platform refuses/);
  assert.ok(r.errors.some((e) => /already defined/.test(e)) && r.errors.some((e) => /lower-case/.test(e)), r.errors.join("\n"));
});

test("B0: a group label the facts no longer support is shown as a citable fact, so a rename can rest on it", () => {
  const model = { nodes: [], edges: [], groups: [{ id: "g-hosts", label: "Hosts (PORT 3000)", wraps: [], source: "stated" }] };
  const f = buildBriefFacts(model, { root: proj, readLines: () => null, staleLabels: [{ group: "g-hosts", why: "names port 3000, and 2 of its 2 process box(es) show no such port" }] });
  assert.match(f.text, /- g-hosts "Hosts \(PORT 3000\)": \n  label:g-hosts: LABEL STALE — the label names port 3000/);
  assert.ok(f.cites.has("label:g-hosts"));
});

test("B5: only what the facts support is kept, and the refusals say why", () => {
  writeFileSync(join(tmp, "reply.json"), "Here is the brief:\n```json\n" + JSON.stringify(reply) + "\n```\n");
  const r = cli(["brief", "codebase", proj, "--skip-groups", "--reply", join(tmp, "reply.json")]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const b = JSON.parse(readFileSync(join(proj, ".vibegraph/brief.json"), "utf-8")).proposed;
  assert.equal(b.spec.function.length, 3, "the fourth function line is over the limit");
  assert.equal(b.spec.method.length, 1, "a line using only an unknown word is refused");
  assert.deepEqual(b.spec.method[0].words, ["partitions"]);
  assert.deepEqual(b.spec.method[0].boxes, ["cluster:scripts:decider", "zone:ledger/status"]);
  assert.deepEqual(b.spec.feature[0].cites, [], "an invented citation is dropped: the line is INFERRED");
  assert.deepEqual(b.groups.map((g) => g.id), ["g-ledger-writers"]);
  assert.deepEqual(b.groups[0].members, ["cluster:scripts:.", "cluster:scripts:decider"]);
  assert.deepEqual(b.names["tool:fetch"].cites, [], "a box's own id is no evidence for its name");
  assert.deepEqual(b.scopes, [], "tool:fetch is not a silent box");
  assert.deepEqual(b.primaryPath.steps, ["tools/appoint.ts:main", "decider/bin/decider.ts:main"]);
  assert.ok(b.omitted.includes("the archiver: planned, not built"));
  const reasons = b.refused.map((x) => `${x.item}: ${x.reason}`).join("\n");
  for (const re of [/over the limit of 3 function lines/, /uses no method word/, /not in the method vocabulary: levitates/, /no group g-missing to rename/, /g-uncited: no valid citation/, /member no:such:box is not a box/, /not one of the silent boxes/, /step nowhere:main/]) assert.match(reasons, re);
  assert.match(r.stdout, /brief PROPOSED/);
  assert.ok(Object.keys(b.hashes).length > 0);
});

test("a person ratifies; an agent cannot; groups land in architecture.json; architecture.md opens with the Brief", () => {
  const agent = cli(["brief", "codebase", "ratify", proj], { CLAUDECODE: "1" });
  assert.equal(agent.status, 1);
  assert.match(agent.stderr, /refused: `brief codebase ratify`/);
  const spec = cli(["brief", "codebase", "ratify", "spec", proj]);
  assert.equal(spec.status, 0, spec.stderr);
  const groups = cli(["brief", "codebase", "ratify", "groups", proj]);
  assert.equal(groups.status, 0, groups.stderr);
  const arch = JSON.parse(readFileSync(join(proj, ".vibegraph/architecture.json"), "utf-8"));
  const g = arch.groups.find((x) => x.id === "g-ledger-writers");
  assert.deepEqual(g.wraps, ["cluster:scripts:.", "cluster:scripts:decider"]);
  assert.match(g.note, /from the brief/);
  assert.equal(arch.names["tool:fetch"], "Ledger HTTP client");
  const rejected = cli(["brief", "codebase", "reject", "path", proj]);
  assert.equal(rejected.status, 0, rejected.stderr);
  const rec = JSON.parse(readFileSync(join(proj, ".vibegraph/brief.json"), "utf-8"));
  assert.equal(rec.proposed, undefined, "every section decided");
  assert.deepEqual(rec.history.map((h) => `${h.section}:${h.decision}`), ["spec:ratify", "groups:ratify", "path:reject"]);
  const exp = cli(["export", proj]);
  assert.equal(exp.status, 0, exp.stderr);
  const md = readFileSync(join(proj, ".vibegraph/knowledge/architecture.md"), "utf-8");
  const at = md.indexOf("## Brief");
  assert.ok(at > 0 && at < md.indexOf("\n## ", at + 3), "the Brief is the first section");
  assert.match(md, /\*\*Function\*\*\n- Decides when an order is released/);
  assert.match(md, /Decisions are kept for audit\. _\(INFERRED — no citation\)_/);
});

test("B7: a line goes STALE only when exactly what it cites changes, and says what changed", () => {
  // moving code is not a change: the cited edge is the same write
  const f = join(proj, "decider/src/transitions.ts");
  writeFileSync(f, `// a line added above the write\n${readFileSync(f, "utf-8")}`);
  assert.doesNotMatch(cli(["brief", "codebase", "show", proj]).stdout, /STALE/, "nothing a line cites changed");
  // the state machine it cites changes
  const topo = join(proj, ".vibegraph/topology/ledger.json");
  writeFileSync(topo, readFileSync(topo, "utf-8").replace(/"to": "held"/, '"to": "parked"'));
  const show = cli(["brief", "codebase", "show", proj]);
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /Function: Decides when an order is released[^\n]*\[STALE: topology:sm:order-phase changed\]/);
  assert.match(show.stdout, /topology:sm:order-phase changed — was: "state machine order-phase: filed→held[^"]*", now: "state machine order-phase: filed→parked/, "the card says what changed");
  assert.doesNotMatch(show.stdout, /Function: Serves clerks[^\n]*STALE/, "a line whose citations did not change stays fresh");
  assert.doesNotMatch(show.stdout, /Method: Partitions[^\n]*STALE/);
});

test("the hooks: session start carries the function and method lines; a prompt on a box's thread brings its method line once", () => {
  const start = cli(["hook", "run", "session-start", "--root", proj]);
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /The Brief \(ratified/);
  assert.match(start.stdout, /Function: Decides when an order is released/);
  assert.match(start.stdout, /Method: Partitions the ledger so the decider alone writes status/);
  const p = cli(["hook", "run", "prompt", "--prompt", "change decider/bin/decider.ts so held orders time out", "--root", proj, "--session", "s1"]);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /How this part of the system holds together \(the ratified Brief\)/);
  assert.match(p.stdout, /Partitions the ledger so the decider alone writes status/);
  const again = cli(["hook", "run", "prompt", "--prompt", "and log it in decider/bin/decider.ts", "--root", proj, "--session", "s1"]);
  assert.doesNotMatch(again.stdout, /the ratified Brief\)/, "once per session");
});

test("a line resting on a rule goes STALE when the code the rule's check names changes, and only then", () => {
  const p2 = join(tmp, "p2");
  cpSync(join(ROOT, "test/fixtures/system/views_demo"), p2, { recursive: true });
  writeFileSync(join(p2, ".vibegraph/constraints.json"), JSON.stringify({ version: "1", constraints: [{
    id: "c1", kind: "invariant", text: "Only the decider asks whether an approver is appointed.", scope: { all: true },
    check: { rule: "callers-only", target: "checkApprover", files: ["decider/src/transitions.ts"] }, source: "human", createdAt: "2026-10-08T00:00:00.000Z",
  }] }));
  writeFileSync(join(tmp, "reply3.json"), JSON.stringify({ spec: { function: [{ text: "Decides releases only once an approver is appointed.", words: ["decides"], cites: ["rule:c1"] }], method: [], feature: [] }, omitted: [] }));
  assert.equal(cli(["brief", "codebase", p2, "--skip-groups", "--reply", join(tmp, "reply3.json")]).status, 0);
  assert.equal(cli(["brief", "codebase", "ratify", "spec", p2]).status, 0);
  const store = join(p2, "lib/store.ts");
  writeFileSync(store, readFileSync(store, "utf-8").replace("Promise<unknown> {", "Promise<unknown> {\n  // unrelated"));
  assert.doesNotMatch(cli(["brief", "codebase", "show", p2]).stdout, /STALE/, "code the rule does not name");
  const tr0 = join(p2, "decider/src/transitions.ts");
  writeFileSync(tr0, `// a line above every function\n${readFileSync(tr0, "utf-8")}`);
  assert.doesNotMatch(cli(["brief", "codebase", "show", p2]).stdout, /STALE: rule:c1/, "the named function moved, unchanged");
  const tr = join(p2, "decider/src/transitions.ts");
  writeFileSync(tr, readFileSync(tr, "utf-8").replace(`readDoc("approver", "current")`, `readDoc("approver", "acting")`));
  const shown = cli(["brief", "codebase", "show", p2]).stdout;
  assert.match(shown, /Decides releases only once an approver is appointed\.\s+\[STALE: rule:c1 changed\]/);
  assert.match(shown, /the code rule:c1 guards changed: checkApprover \(decider\/src\/transitions\.ts\)/, "the guarded code, said apart from the rule");
  // the rule's own text: said as a change to the rule
  writeFileSync(tr, readFileSync(tr, "utf-8").replace(`readDoc("approver", "acting")`, `readDoc("approver", "current")`));
  assert.doesNotMatch(cli(["brief", "codebase", "show", p2]).stdout, /STALE/, "the code is back as it was");
  const cfile = join(p2, ".vibegraph/constraints.json");
  writeFileSync(cfile, readFileSync(cfile, "utf-8").replace("Only the decider asks", "Only the decider ever asks"));
  assert.match(cli(["brief", "codebase", "show", p2]).stdout, /rule:c1 changed — its text, check or scope \(was: "Only the decider asks/);
});

test("--stale re-briefs only the stale lines; ratifying replaces exactly those", () => {
  const reply2 = { spec: { function: [{ text: "Decides order releases in the decider's state machine.", words: ["decides"], cites: ["topology:sm:order-phase", "cluster:scripts:decider->zone:ledger/status:uses:write"] }], method: [], feature: [] }, omitted: [] };
  writeFileSync(join(tmp, "reply2.json"), JSON.stringify(reply2));
  const r = cli(["brief", "codebase", proj, "--stale", "--reply", join(tmp, "reply2.json")]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const p = JSON.parse(readFileSync(join(proj, ".vibegraph/brief.json"), "utf-8")).proposed;
  // only the line citing the changed state machine is stale, and restated
  assert.deepEqual(p.restates, ["Decides when an order is released, by a state machine run in the decider."]);
  assert.equal(cli(["brief", "codebase", "ratify", "spec", proj]).status, 0);
  const spec = JSON.parse(readFileSync(join(proj, ".vibegraph/brief.json"), "utf-8")).ratified.spec;
  assert.deepEqual(spec.function.map((l) => l.text), ["Serves clerks and partners who file order requests.", "A third function line.", "Decides order releases in the decider's state machine."]);
  assert.equal(spec.method.length, 1, "a line that was not stale is kept");
  assert.equal(spec.feature.length, 1, "a line that was not stale is kept");
  const show = cli(["brief", "codebase", "show", proj]);
  assert.doesNotMatch(show.stdout, /STALE/, "the re-brief rests on the code as it is now");
});
