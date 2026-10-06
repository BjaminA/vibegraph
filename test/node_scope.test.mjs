// "Scope this node" (2026-10-06, part 3 of In → Process → Out). Fixture
// test/fixtures/system/views_demo, box tool:fetch; the reply is the stub's
// (test/fixtures/system/fake_claude_scope.mjs). Pinned: the dossier shows the
// box's call sites as numbered lines and its edges by id, and nothing else is
// citable; the gate refuses a word outside the vocabulary and a box that does
// not exist, drops an unshown citation and the box's own id, and keeps an
// uncited claim as INFERRED; a proposed scope changes nothing until a person
// ratifies it; ratify is refused from Claude Code; a ratified scope reaches
// In → Process → Out and architecture.md.
//
//   npm run test:node-scope
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { scopeDossier, parseScope, decideScope } from "../src/server/node_scope.ts";
import { linesReader } from "../src/server/node_scope_server.ts";
import { loadArchStore } from "../src/server/arch_store.ts";
import { nodeIO } from "../src/shared/node_io.ts";

const FIX = "test/fixtures/system/views_demo";
const BOX = "tool:fetch";
let model, dossier, reply, tmp, root;
before(() => {
  const env = buildPolyglotEnvelope(FIX, { skipSystem: true }).envelope;
  model = archModelForEnvelope(env, buildStackIndex(env, FIX), buildCrossingIndex(env), FIX, undefined, { applyStore: false });
  dossier = scopeDossier(model, BOX, { readLines: linesReader(FIX) });
  const r = spawnSync(process.execPath, ["test/fixtures/system/fake_claude_scope.mjs", "You are scoping ONE box"], { encoding: "utf-8" });
  reply = JSON.parse(r.stdout).result;
  tmp = mkdtempSync(join(tmpdir(), "vg-scope-"));
  root = join(tmp, "p");
  cpSync(FIX, root, { recursive: true });
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test("the dossier: numbered call-site lines and the edges by id — and only those are citable", () => {
  assert.match(dossier.text, /lib\/store\.ts:3: +await fetch\(/);
  assert.ok(dossier.cites.has("lib/store.ts:3"));
  const e = model.edges.find((x) => x.to === BOX);
  assert.ok(dossier.cites.has(e.id), "an edge into the box is citable by id");
  assert.ok(!dossier.cites.has(BOX), "the box's own id is not evidence");
  assert.match(dossier.text, /WHAT THE CODE ALREADY SHOWS/);
});

test("the gate: unknown word and unknown box refused, unshown and circular citations dropped, uncited kept as INFERRED", () => {
  const { scope } = parseScope(reply, model, BOX, dossier, { model: "stub" });
  assert.deepEqual(scope.words.map((w) => [w.word, w.evidence]), [["call", ["lib/store.ts:3"]], ["store", []]]);
  assert.deepEqual(scope.out.map((r) => [r.node, r.evidence]), [["cluster:scripts:decider", []]]);
  assert.equal(scope.in.length, 0);
  const why = scope.refused.map((r) => `${r.item}: ${r.reason}`).join("\n");
  assert.match(why, /word teleport: not a word of the vocabulary/);
  assert.match(why, /in cluster:ghost: names a box the model was not shown/);
  assert.match(why, /word store: the box's own id is not evidence about itself/);
  assert.match(why, /out cluster:scripts:decider: citation\(s\) not among what was shown, dropped: lib\/store\.ts:99/);
  assert.match(parseScope("no json here", model, BOX, dossier, { model: "stub" }).error, /no JSON object/);
});

test("proposed changes nothing; ratified joins In → Process → Out, marked scoped, INFERRED faded", () => {
  const { scope } = parseScope(reply, model, BOX, dossier, { model: "stub" });
  const proposed = { [BOX]: { node: BOX, proposed: scope } };
  const before = nodeIO(model, BOX, undefined, {});
  assert.deepEqual(nodeIO(model, BOX, undefined, proposed).process.map((p) => p.word), before.process.map((p) => p.word));
  const { scopes } = decideScope(proposed, BOX, "ratify");
  const io = nodeIO(model, BOX, undefined, scopes);
  const store = io.process.find((p) => p.word === "store");
  assert.ok(store.scoped && store.inferred);
  assert.ok(io.process.find((p) => p.word === "call").evidence.some((e) => /scoped \(ratified\): lib\/store\.ts:3/.test(e)), "a word the code already showed gains the scope's citation");
  assert.ok(io.out.some((r) => r.node === "cluster:scripts:decider" && r.op === "scoped" && /INFERRED/.test(r.via)));
  assert.equal(decideScope(scopes, BOX, "reject").error, `no scope of ${BOX} is waiting for a decision`);
  const rejected = decideScope(proposed, BOX, "reject");
  assert.deepEqual(rejected.scopes, {}, "rejecting the only (proposed) scope removes it");
});

test("the CLI: scope proposes from a saved reply; ratify is a person's step; architecture.md carries the ratified scope", () => {
  const cli = (args, env = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", ...args], { encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", ...env } });
  const replyFile = join(tmp, "reply.txt");
  writeFileSync(replyFile, reply);
  const r = cli(["scope", BOX, "--reply", replyFile, "--root", root]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /PROPOSED in \.vibegraph\/architecture\.json/);
  assert.match(r.stdout, /refused word teleport/);
  assert.ok(loadArchStore(root).scopes[BOX].proposed);
  const agent = cli(["scope", "ratify", BOX, "--root", root], { CLAUDECODE: "1" });
  assert.notEqual(agent.status, 0);
  assert.match(agent.stdout + agent.stderr, /person's step/);
  assert.equal(cli(["scope", "ratify", BOX, "--root", root]).status, 0);
  assert.ok(loadArchStore(root).scopes[BOX].ratified);
  const e = cli(["export", root]);
  assert.equal(e.status, 0, e.stderr);
  assert.match(readFileSync(join(root, ".vibegraph/knowledge/architecture.md"), "utf-8"), /scoped by stub|scoped by saved reply/);
});


test("staleness: a scope records what it was shown; a changed line under it reads STALE, an older scope is not judged", async () => {
  const { withScopeStaleness } = await import("../src/server/node_scope.ts");
  const { scope } = parseScope(reply, model, BOX, dossier, { model: "stub" });
  assert.equal(scope.basis, dossier.basis);
  const scopes = { [BOX]: { node: BOX, ratified: scope } };
  const same = withScopeStaleness(scopes, model, { readLines: linesReader(FIX) });
  assert.equal(same[BOX].ratified.stale, false);
  const changed = (file) => { const l = linesReader(FIX)(file); return l && file === "lib/store.ts" ? l.map((x, i) => (i === 2 ? x.replace("ledger", "ledger-v2") : x)) : l; };
  const moved = withScopeStaleness(scopes, model, { readLines: changed });
  assert.equal(moved[BOX].ratified.stale, true);
  assert.ok(nodeIO(model, BOX, undefined, moved).process.find((p) => p.word === "store").evidence.some((e) => /STALE/.test(e)));
  const { basis: _b, ...old } = scope;
  assert.equal(withScopeStaleness({ [BOX]: { node: BOX, ratified: old } }, model, { readLines: changed })[BOX].ratified.stale, false, "no basis recorded: not judged");
  // the stale flag is never stored
  assert.equal(loadArchStore(FIX).scopes, undefined);
});
