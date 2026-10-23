// RULES PROPOSED FROM THE ARCHITECTURE (2026-10-19, PLAN-M-RULES M2,
// src/server/rule_draft.ts + rule_draft_gate.ts + scripts/cli/rule_draft.mjs).
// The one token-spending step for rules. Pinned: what the model is shown
// (deterministic, every fact with an id, the stated rules it must not
// restate, the scope vocabulary in the project's spellings), and the gate —
// on a stub reply built to need it: one good rule (stored agent-stated, an
// invented scope file dropped, its harvested sentence as its cite, its check
// run and passing), one citing only facts it was never shown (refused, listed
// without evidence), one restating c1 by its check (refused), one whose check
// cannot be decided (kept as prose, the check removed and said), one whose
// scope names nothing the project has (refused).
//
//   npm run test:rule-draft
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadConstraints } from "../src/server/constraint_store.ts";
import { buildRuleDossier, buildRuleDraftPrompt } from "../src/server/rule_draft.ts";
import { gateRuleDraft, replyJson } from "../src/server/rule_draft_gate.ts";
import { runRuleDraft, gateContext } from "../scripts/cli/rule_draft.mjs";
delete process.env.CLAUDECODE;

const FLEET = "examples/fleet-telemetry";
const STUB = resolve("test/fixtures/rules/fake_claude_rule_draft.mjs");
let tmp, root, env, stack, dossier;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-draft-"));
  process.env.VG_CACHE_DIR = join(tmp, "cache");
  root = join(tmp, "fleet");
  cpSync(FLEET, root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  stack = buildStackIndex(env, root);
  dossier = buildRuleDossier(root, env, stack);
});
after(() => { rmSync(tmp, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

test("the dossier: facts with ids, the stated rules not to restate, the scope vocabulary", () => {
  const ids = new Set(dossier.items.map((i) => i.id));
  for (const id of ["funnel:telemetry.storage", "funnel:telemetry.http_client", "tool:sqlite3", "tool:requests", "boundary:sqlite3", "harvest:README.md:12", "direction:funnel:sqlite3"]) assert.ok(ids.has(id), `missing ${id}`);
  assert.ok(dossier.items.some((i) => i.kind === "process"), "the architecture's processes");
  assert.ok(dossier.items.some((i) => i.kind === "crossing" && /POST \/ingest/.test(i.text)), "the gateway → service hop");
  assert.deepEqual(dossier.items.find((i) => i.id === "harvest:README.md:12").cite.file, "README.md");
  assert.deepEqual(dossier.stated.map((s) => s.id), ["c1", "c2", "c3", "c4", "c5", "c6"]);
  assert.ok(dossier.vocab.entryPoints.includes("telemetry/app.py:ingest_route"));
  assert.ok(dossier.vocab.folders.includes("telemetry/"));
  assert.ok(dossier.vocab.tools.includes("sqlite3") && dossier.vocab.tools.includes("telemetry.storage"));
  assert.ok(!dossier.vocab.tools.includes("json"), "the standard library that leaves nothing is not scope vocabulary");
  const prompt = buildRuleDraftPrompt(dossier);
  assert.match(prompt, /\[funnel:telemetry\.storage\] telemetry\/storage\.py is the project's own module calling sqlite3\.[^;]*\(sqlite3\)/, "RC4: what the funnel calls, by full name, and the tool");
  assert.match(prompt, /do NOT restate or reword these\n- c1: /);
  assert.match(prompt, /"rule":"import-only"/);
  assert.ok(prompt.length < 40_000, `prompt ${prompt.length} chars`);
  assert.equal(buildRuleDraftPrompt(buildRuleDossier(root, env, stack)), prompt, "deterministic");
});

test("the gate on the stub's mixed reply: one stored, one prose, three refused; every refusal named", () => {
  const before = loadConstraints(root).length;
  const r = runRuleDraft({ root, values: {}, env: { ...process.env, VG_CLAUDE_BIN: STUB } });
  assert.equal(r.exitCode, 0, r.messages.join("\n"));
  const text = r.lines.join("\n");
  const after = loadConstraints(root);
  const added = after.slice(before);
  assert.equal(added.length, 2, text);
  const [good, prose] = added;
  // 1 — stored agent-stated, its scope in the project's spellings, its sentence, its check passing
  assert.equal(good.source, "agent");
  assert.deepEqual(good.scope, { files: ["telemetry/"] });
  assert.deepEqual(good.check, { rule: "import-only", tool: "sqlite3", files: ["telemetry/storage.py"] });
  assert.equal(good.cite.file, "README.md");
  assert.match(good.note, /^proposed from the architecture \(.+\); rests on funnel:telemetry\.storage, direction:funnel:sqlite3, harvest:README\.md:14 — dropped from the scope: telemetry\/nonexistent\.py/);
  assert.match(good.text, /\(why: storage\.py is the funnel/);
  assert.match(text, /import-only.*→ PASS/);
  // 4 — kept as prose, the undecidable check removed and said
  assert.equal(prose.check, undefined);
  assert.match(prose.note, /its check was removed: it cannot be decided on this code/);
  // 2, 3, 5 — refused, each with its reason
  assert.match(text, /"Every gateway route rate-limits[^"]*" — cites nothing it was shown \(ops:runbook:9, slack:2026-01-03\)/);
  assert.match(text, /"The requests library is imported[^"]*" — restates c1/);
  assert.match(text, /"The billing worker never calls[^"]*" — its scope names nothing this project has/);
  assert.match(text, /without evidence[^\n]*\n(  - .*\n)*  - The C\+\+ codec should never allocate/);
});

test("a saved reply instead of a spawn; a reply that is not the JSON asked for is refused whole; dry run spawns nothing", () => {
  const reply = join(tmp, "reply.json");
  writeFileSync(reply, "```json\n" + JSON.stringify({ rules: [{ kind: "perf-lever", text: "Gateway device views are cached for at least fifteen seconds before going upstream again.", why: "the dashboard polls", scope: { files: ["gateway/"] }, cites: ["funnel:gateway.api_client"] }] }) + "\n```\n");
  const r = runRuleDraft({ root, values: { reply } });
  assert.equal(r.exitCode, 0, r.messages.join("\n"));
  assert.ok(loadConstraints(root).some((c) => c.text.startsWith("Gateway device views are cached") && c.note.includes("saved reply")));
  writeFileSync(reply, "I think the project should validate its inputs.");
  const bad = runRuleDraft({ root, values: { reply } });
  assert.equal(bad.exitCode, 3);
  assert.match(bad.messages[0], /not the JSON object the prompt asks for/);
  const dry = runRuleDraft({ root, values: { "dry-run": true }, env: { ...process.env, VG_CLAUDE_BIN: "/nonexistent" } });
  assert.equal(dry.exitCode, 0);
  assert.match(dry.lines.join("\n"), /the model is shown \d+ facts .* ~\d+ tokens\ndry run — nothing spawned, nothing written/);
});

test("key order is not meaning: a reordered copy of a stated check is still a restatement", () => {
  const reply = JSON.stringify({ rules: [{ text: "Notify is called from the alerts module alone and from nowhere else at all.", scope: { files: ["telemetry/"] }, cites: ["boundary:sqlite3"], check: { files: ["telemetry/alerts.py"], target: "notify", rule: "callers-only" } }] });
  const g = gateRuleDraft(reply, dossier, gateContext(env, root, stack, "test"));
  assert.equal(g.accepted.length, 0);
  assert.match(g.refused[0].reason, /restates c3/);
  assert.deepEqual(replyJson('text before {"rules": []} after'), { rules: [] });
});

// M3: the prose writer stated a rule without a check; the architecture writer's restatement
// carried one and was refused, and the check was lost with it
test("a restatement that brings a check the stated rule lacks becomes a proposal ON that rule", async () => {
  const { loadConstraints: load } = await import("../src/server/constraint_store.ts");
  const c5 = load(root).find((c) => c.id === "c5");
  assert.equal(c5.check, undefined, "the fleet's c5 states no check (the case under test)");
  const reply = JSON.stringify({ rules: [{ kind: "perf-lever", text: c5.text, scope: { files: ["telemetry/"] }, cites: ["funnel:telemetry.storage"], check: { rule: "callers-only", target: "insert_readings", files: ["telemetry/ingest.py", "telemetry/backfill.py"] } }] });
  const g = gateRuleDraft(reply, dossier, gateContext(env, root, stack, "test"));
  assert.equal(g.accepted.length, 0);
  assert.match(g.refused[0].reason, /restates c5 — its check is proposed for c5 instead/);
  assert.deepEqual(g.checkProposals.map((p) => [p.id, p.verdict]), [["c5", "pass"]]);
  const { applyRuleDraft } = await import("../src/server/rule_draft_gate.ts");
  const ids = applyRuleDraft(root, g);
  assert.deepEqual(ids, ["c5/p1"]);
  const after = load(root).find((c) => c.id === "c5");
  assert.equal(after.check, undefined, "nothing changes until a person accepts");
  assert.deepEqual(after.proposals[0].patch, { check: { rule: "callers-only", target: "insert_readings", files: ["telemetry/ingest.py", "telemetry/backfill.py"] } });
  assert.equal(after.proposals[0].by, "agent");
});

// the restatement path fired only when a model restated; the re-measurement's model obeyed
// "do not restate" and the check was never offered — so the channel is deliberate
test("`checks` in the reply: a check for a stated rule without one is proposed on it; the rest refused with a reason", () => {
  assert.match(buildRuleDraftPrompt(dossier), /- c2 \(no check yet\): /);
  assert.match(buildRuleDraftPrompt(dossier), /- c1: /, "a checked rule is not marked");
  const reply = JSON.stringify({ rules: [], checks: [
    { for: "c3", check: { rule: "callers-only", target: "notify", files: ["telemetry/alerts.py"] }, cites: ["harvest:README.md:12"] },
    { for: "c2", check: { rule: "callers-only", target: "export_csv", files: ["telemetry/app.py", "telemetry/cli.py"] }, cites: ["crossing:5"] },
    { for: "c99", check: { rule: "import-only", tool: "sqlite3", files: ["telemetry/storage.py"] }, cites: ["funnel:telemetry.storage"] },
    { for: "c4", check: { rule: "calls-through", target: "postIngest", through: "bearerToken" }, cites: ["ops:wiki"] },
  ] });
  const g = gateRuleDraft(reply, dossier, gateContext(env, root, stack, "test"));
  assert.deepEqual(g.checkProposals.map((p) => p.id), ["c2"]);
  assert.deepEqual(g.refused.map((r) => r.reason), ["c3 already has a check", "names no stated rule", "cites nothing it was shown"]);
});

// M3: three presses on one tree left thirty proposals unreviewed — a person's attention runs out first
test("a draft is refused while a press's worth of proposals already waits; a dry run and --force are not", async () => {
  const { addConstraint } = await import("../src/server/constraint_store.ts");
  const busy = join(tmp, "busy");
  cpSync(FLEET, busy, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  for (let i = 0; i < 12; i++) addConstraint(busy, { kind: "invariant", text: `Waiting proposal number ${i} that nobody has reviewed yet.`, scope: { all: true } }, "agent");
  const refused = runRuleDraft({ root: busy, values: {} });
  assert.equal(refused.exitCode, 2);
  assert.match(refused.messages[0], /12 proposals already wait for a person .* \(or pass --force\)/);
  assert.equal(runRuleDraft({ root: busy, values: { "dry-run": true } }).exitCode, 0, "looking is free");
  const reply = join(tmp, "reply-busy.json");
  writeFileSync(reply, JSON.stringify({ rules: [] }));
  assert.equal(runRuleDraft({ root: busy, values: { reply, force: true } }).exitCode, 0, "a person may override");
});

// a live run's payload check arrived with "forbid": [] (the prompt's own example showed both lists) and was refused as malformed
test("an empty list in a model's check means absent; a check aimed at a route path is run and said undecidable", () => {
  const reply = JSON.stringify({ rules: [{ text: "Every reading the gateway posts keeps the four keys under those exact names.", scope: { files: ["gateway/"] }, cites: ["crossing:1"], check: { rule: "payload-keys", target: "/ingest", require: ["device_id", "ts", "metric", "value"], forbid: [] } }] });
  const g = gateRuleDraft(reply, dossier, gateContext(env, root, stack, "test"));
  assert.equal(g.accepted.length, 1);
  assert.doesNotMatch(g.accepted[0].input.note, /grammar's shapes/);
  assert.match(g.accepted[0].input.note, /its check was removed: it cannot be decided on this code \(the IR has no call to `\/ingest`/);
  assert.match(buildRuleDraftPrompt(dossier), /never a URL or a route path\. Leave out a list you would leave empty/);
});
