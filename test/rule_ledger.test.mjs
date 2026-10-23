// Rule sourcing with accounting (2026-10-22, the root-cause handoff RC5: "rule
// sourcing is lossy and re-initialisation forgets ratified rules"). A synthetic
// project (Python and TypeScript) whose CLAUDE.md lists five rules: one about a
// folder, one naming nothing the code holds, one repeating a docstring. Expect
// the ledger to account for all five, the folder rule to carry a check, each
// draft round to reach the sentences no rule covers yet, a re-init's lost
// ratified rules to be offered back, and an unreadable entry to be named.
//
//   npm run test:rule-ledger
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { harvestRules } from "../src/server/rule_harvest.ts";
import { buildRuleLedger, formatRuleLedger, roundCandidates } from "../src/server/rule_ledger.ts";
import { buildRuleDossier } from "../src/server/rule_draft.ts";
import { addConstraint, droppedConstraints, loadConstraints } from "../src/server/constraint_store.ts";
import { setupState } from "../src/server/setup_state.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIX = "test/fixtures/rules/written_demo";
const tmp = mkdtempSync(join(tmpdir(), "vg-rules-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let env, stack, harvest;
before(() => { env = buildPolyglotEnvelope(FIX).envelope; stack = buildStackIndex(env, FIX); harvest = harvestRules(FIX, env, stack); });
const copy = (name) => { const p = join(tmp, name); cpSync(join(ROOT, FIX), p, { recursive: true }); return p; };

test("a rule section of CLAUDE.md is read first, and a folder rule carries a check", () => {
  const firstTier = harvest.candidates.filter((c) => c.tier === 1);
  assert.deepEqual(firstTier.map((c) => c.line).sort((a, b) => a - b), [7, 8, 10, 11]);
  assert.ok(harvest.candidates.findIndex((c) => c.tier !== 1) >= firstTier.length, "tier one first");
  assert.deepEqual(harvest.candidates.find((c) => c.line === 7 && c.file === "CLAUDE.md").suggestedCheck, { rule: "import-only", tool: "sqlite3", files: ["lib/db/"] });
  assert.deepEqual(harvest.unanchored.map((u) => u.line), [9], "the sentence that names nothing parsed is kept, not dropped");
});

test("the ledger accounts for all five written rules", () => {
  const l = buildRuleLedger(harvest, []);
  assert.equal(l.entries.length, 5);
  assert.deepEqual(l.counts, { stated: 0, proposed: 0, merged: 0, "next-round": 4, queued: 0, "out-of-reach": 1 });
  assert.deepEqual(l.entries.find((e) => e.line === 10).alsoIn, ["app/money.py:4"], "the docstring that repeats it is named, not counted twice");
  assert.match(formatRuleLedger(l), /CLAUDE\.md:9: it names no file, folder, function, tool or variable/);
});

test("stored rules settle their sentences, and the next round reaches the rest", () => {
  const p = copy("settle");
  const quote = (line) => harvest.candidates.find((c) => c.file === "CLAUDE.md" && c.line === line).quote;
  addConstraint(p, { kind: "invariant", text: "Only lib/db/ imports sqlite3.", scope: { files: ["lib/db/"] }, cite: { file: "CLAUDE.md", line: 7, quote: quote(7) }, check: { rule: "import-only", tool: "sqlite3", files: ["lib/db/"] } }, "human");
  addConstraint(p, { kind: "invariant", text: "The report never writes to disk.", scope: { files: ["app/report.py"] }, cite: { file: "CLAUDE.md", line: 8, quote: quote(8) } }, "agent");
  addConstraint(p, { kind: "proxy", text: quote(11), scope: { files: ["web/"] } }, "human");
  const known = loadConstraints(p);
  const l = buildRuleLedger(harvest, known);
  const by = Object.fromEntries(l.entries.map((e) => [e.line, `${e.outcome}${e.rule ? ` ${e.rule}` : ""}`]));
  assert.deepEqual(by, { 7: "stated c1", 8: "proposed c2", 9: "out-of-reach", 10: "next-round", 11: "merged c3" });
  const round = roundCandidates(harvest, known).filter((c) => c.file === "CLAUDE.md").map((c) => c.line);
  assert.deepEqual(round, [10], "a round never re-offers what a rule already covers");
  const dossier = buildRuleDossier(p, env, stack);
  const harvested = dossier.items.filter((i) => i.kind === "harvest").map((i) => i.id);
  assert.ok(harvested.includes("harvest:CLAUDE.md:10") && !harvested.includes("harvest:CLAUDE.md:7"), harvested.join(" "));
});

test("the setup says what became of the written rules", () => {
  const s = setupState(FIX, { rules: buildRuleLedger(harvest, []) });
  const step = s.steps.find((x) => x.id === "rules");
  assert.ok(step.facts.some((f) => /^5 rule sentences in CLAUDE\.md \/ AGENTS\.md rule sections: 4 for the next draft, 1 out of reach$/.test(f)), step.facts.join(" | "));
  assert.ok(step.commands.some((c) => c.run === "vibegraph-knowledge constraints ledger"));
});

test("ratified rules a re-init lost are offered back, and restoring is a person's step", () => {
  const p = copy("reinit");
  const cache = join(tmp, "cache");
  const cli = (args, extra = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args],
    { cwd: ROOT, encoding: "utf-8", env: { ...process.env, VG_CACHE_DIR: cache, CLAUDECODE: "", VG_NO_CACHE: "1", ...extra } });
  const prev = process.env.VG_CACHE_DIR;
  process.env.VG_CACHE_DIR = cache;
  try { addConstraint(p, { kind: "invariant", text: "Only lib/db/ imports sqlite3.", scope: { files: ["lib/db/"] }, check: { rule: "import-only", tool: "sqlite3", files: ["lib/db/"] } }, "human"); }
  finally { if (prev === undefined) delete process.env.VG_CACHE_DIR; else process.env.VG_CACHE_DIR = prev; }
  rmSync(join(p, ".vibegraph", "constraints.json"));
  const list = cli(["constraints", "restore", p]);
  assert.match(list.stdout, /1 rule ratified before, not in constraints\.json:\n {2}1\. \[invariant\] Only lib\/db\/ imports sqlite3\./);
  const refused = cli(["constraints", "restore", p, "--all"], { CLAUDECODE: "1" });
  assert.notEqual(refused.status, 0, "inside Claude Code a person's step is refused");
  const done = cli(["constraints", "restore", p, "--all"]);
  assert.equal(done.status, 0, done.stderr);
  const back = loadConstraints(p);
  assert.equal(back.length, 1);
  assert.equal(back[0].source, "human");
  assert.deepEqual(back[0].check, { rule: "import-only", tool: "sqlite3", files: ["lib/db/"] });
  assert.match(back[0].note, /^restored from the cache backup/);
});

test("an entry constraints.json holds that this version cannot read is named, by `check` too", () => {
  const p = copy("dropped");
  mkdirSync(join(p, ".vibegraph"), { recursive: true });
  writeFileSync(join(p, ".vibegraph", "constraints.json"), JSON.stringify({ version: "1", constraints: [
    { id: "c1", kind: "invariant", text: "Only lib/db/ imports sqlite3.", scope: { files: ["lib/db/"] }, source: "human", createdAt: "", check: { rule: "import-only", tool: "sqlite3", files: ["lib/db/"] } },
    { id: "c2", kind: "a-kind-from-later", text: "Something newer.", scope: { all: true }, source: "human", createdAt: "" },
  ] }));
  assert.deepEqual(droppedConstraints(p).map((d) => d.id), ["c2"]);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), "check", p], { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", VG_NO_CACHE: "1" } });
  assert.match(r.stdout, /constraints\.json holds 1 entry this version could not read, so not checked: c2 \(kind must be one of/);
  assert.ok(readFileSync(join(p, ".vibegraph", "constraints.json"), "utf-8").includes("a-kind-from-later"), "kept in the file");
});
