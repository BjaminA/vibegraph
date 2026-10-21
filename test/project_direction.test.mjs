// PROJECT DIRECTION (2026-10-16, src/server/project_direction.ts): the
// project's own "how we do things here", read from its facts at zero tokens —
// a tool reached through the project's own module, a zone whose every write
// runs behind one check, an agreed plan principle — PROPOSED by the census and
// decided by a person. An agreed rule reaches a hooked session once, with the
// threads it is about; one with a check is checked after edits AS ADVICE.
//
//   npm run test:project-direction
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { census, censusAt, mergeCensus, decideRule, loadDirection, saveDirection, rulesFor, setRuleDelivery, staleRules } from "../src/server/project_direction.ts";
import { addConstraint } from "../src/server/constraint_store.ts";
import { handleProjectDirection } from "../src/server/project_direction_server.ts";
import { ruleDelivery } from "../src/shared/project_direction_wire.ts";
import { runDirection } from "../scripts/cli/direction.mjs";
import { buildInbox, decideInbox } from "../src/server/inbox.ts";
import { personOnlyStep } from "../scripts/cli/actor.mjs";
import { runHook } from "../scripts/cli/hooks.mjs";
import { runProjectDirection } from "../scripts/cli/project_direction_context.mjs";

delete process.env.CLAUDECODE; // the tests act as a person
let base, fleet;
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-pdir-"));
  process.env.VG_CACHE_DIR = join(base, "cache");
  fleet = join(base, "fleet");
  cpSync("examples/fleet-telemetry", fleet, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  const git = (...a) => execFileSync("git", a, { cwd: fleet, stdio: "ignore" });
  git("init", "-q"); git("add", "-A"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

function facts(root) {
  const env = buildPolyglotEnvelope(root).envelope;
  const stack = buildStackIndex(env, root);
  return { stack, model: archModelForEnvelope(env, stack, buildCrossingIndex(env), root, undefined, { applyStore: false }), files: env.files };
}

test("the census reads what the code already does: guarded zones, funnels, and says when it cannot check", () => {
  const ex = census({ ...facts("test/fixtures/brief/exchange_demo"), plan: null });
  const by = Object.fromEntries(ex.map((c) => [c.basis, c]));
  assert.match(by["guard:zone:ledger/partner_status"].text, /Every write to partner_status is decided by verify/);
  assert.match(by["guard:zone:ledger/partner_status"].why, /1 only when it holds, 1 only when it fails/);
  assert.ok(by["guard:zone:ledger/quarantine"], "quarantine: both writes behind verify failing");
  assert.ok(!Object.keys(by).some((b) => b === "guard:zone:ledger/evidence"), "evidence: the gateway writes it unguarded — no rule");
  assert.equal(by["funnel:fetch"].check, undefined, "fetch is a global: an import check would pass on nothing");
  assert.match(by["funnel:fetch"].why, /language global, not imported: not checked/);
  const fl = census({ ...facts(fleet), plan: null });
  const sq = fl.find((c) => c.basis === "funnel:sqlite3");
  assert.deepEqual(sq.check, { rule: "import-only", tool: "sqlite3", files: ["telemetry/storage.py"], allowTests: true });
  assert.match(sq.why, /5 files use sqlite3 through telemetry\/storage\.py; none reach it directly/);
});

test("merging: new rules are proposed; a person's decision stands; moved facts are flagged, never re-worded", () => {
  const c1 = { text: "Reach x through y", why: "3 files", basis: "funnel:x", evidence: ["y.py"], stamp: "a" };
  const c2 = { text: "Writes to z are decided by ok(…)", why: "2 writes", basis: "guard:z", evidence: [], stamp: "b" };
  let d = mergeCensus({ version: "1", rules: [] }, [c1, c2]).direction;
  assert.deepEqual(d.rules.map((r) => [r.id, r.status]), [["d1", "proposed"], ["d2", "proposed"]]);
  assert.equal(decideRule(d, "d1", "agree", "a person"), null);
  assert.equal(decideRule(d, "d2", "drop", "a person"), null);
  const again = mergeCensus(d, [{ ...c1, text: "Reach x through w", stamp: "a2" }, c2]);
  d = again.direction;
  assert.equal(d.rules.find((r) => r.id === "d1").text, "Reach x through y", "the agreed wording stays");
  assert.equal(d.rules.find((r) => r.id === "d1").changed, true);
  assert.equal(d.rules.find((r) => r.id === "d2").status, "dropped", "a dropped rule is never proposed again");
  assert.equal(again.added, 0);
  d = mergeCensus(d, [c2]).direction;
  assert.equal(d.rules.find((r) => r.id === "d1").missing, true, "agreed but no longer found: said, not removed");
  assert.deepEqual(rulesFor({ version: "1", rules: [{ ...d.rules[0], status: "agreed", files: ["telemetry/"] }] }, ["telemetry/ingest.py"]).length, 1);
});

test("a funnel rule's check passes the code as it is; a tool a stated rule already limits is not proposed twice", () => {
  // the live setup run: "Reach drizzle-orm through lib/db/queries.ts" came with a check
  // only queries.ts passed, while schema.ts imports the ORM by design
  const ev = (file) => ({ file, kind: "import", nodeId: `${file}#i` });
  const stack = { tools: [
    { tool: "lib.db.queries", role: "db", origin: "project", home: "lib/db/queries.ts", wraps: ["drizzle-orm"], files: ["lib/db/queries.ts", "a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts", "h.ts"], users: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts", "h.ts"], threads: [], evidence: [] },
    { tool: "drizzle-orm", role: "db", origin: "third-party", files: ["lib/db/queries.ts", "lib/db/schema.ts", "package.json"], threads: [], evidence: [ev("lib/db/queries.ts"), ev("lib/db/schema.ts"), { file: "package.json", kind: "config" }] },
  ] };
  const found = census({ stack, model: { nodes: [], edges: [] }, files: {}, plan: null });
  const c = found.find((x) => x.basis === "funnel:drizzle-orm");
  assert.deepEqual(c.check, { rule: "import-only", tool: "drizzle-orm", files: ["lib/db/queries.ts", "lib/db/schema.ts"], allowTests: true }, "schema.ts reaches it today: allowed; package.json declares it: not a use");
  assert.match(c.why, /^8 files use drizzle-orm through lib\/db\/queries\.ts; 1 reach it directly \(lib\/db\/schema\.ts\), and the check allows those: it catches a new one/);
  const stated = [{ id: "c51", check: { rule: "import-only", tool: "drizzle-orm", files: ["lib/db/queries.ts", "lib/db/schema.ts"] } }];
  assert.equal(census({ stack, model: { nodes: [], edges: [] }, files: {}, plan: null, stated }).find((x) => x.basis === "funnel:drizzle-orm"), undefined, "c51 already says it");
  // and from disk, the way every caller reads it
  const root = mkdtempSync(join(base, "stated-"));
  assert.ok(censusAt(root, { stack, model: { nodes: [], edges: [] }, files: {} }).some((x) => x.basis === "funnel:drizzle-orm"));
  addConstraint(root, { kind: "proxy", text: "Only the db modules import drizzle-orm", scope: { all: true }, check: stated[0].check }, "agent");
  assert.equal(censusAt(root, { stack, model: { nodes: [], edges: [] }, files: {} }).find((x) => x.basis === "funnel:drizzle-orm"), undefined, "a stated rule on disk, even a model's not yet ratified");
});

test("agreeing reads the code as it is now: a proposal whose facts moved or went is refused, with what the code says", () => {
  const c1 = { text: "Reach fetch through lib.utils", why: "52 files use fetch through lib/utils.ts", basis: "funnel:fetch", evidence: ["lib/utils.ts"], stamp: "a" };
  const d = () => mergeCensus({ version: "1", rules: [] }, [c1]).direction;
  const moved = [{ ...c1, why: "4 files use fetch through lib/utils.ts", stamp: "b" }];
  assert.deepEqual([...staleRules(d(), moved)], [["d1", { state: "moved", now: "4 files use fetch through lib/utils.ts" }]]);
  assert.deepEqual([...staleRules(d(), [])], [["d1", { state: "gone" }]]);
  assert.equal(staleRules(d(), [c1]).size, 0);
  assert.match(decideRule(d(), "d1", "agree", "a person", new Date(), moved), /^d1 was read from the code as it was at the census, and its facts have moved \(now: 4 files use fetch/);
  assert.match(decideRule(d(), "d1", "agree", "a person", new Date(), []), /the code no longer shows it/);
  assert.equal(decideRule(d(), "d1", "drop", "a person", new Date(), []), null, "dropping is always allowed");
  assert.equal(decideRule(d(), "d1", "agree", "a person", new Date(), [c1]), null, "the same facts: agreed");
  // the Direction panel's door reads the live census the same way
  const root = mkdtempSync(join(base, "stale-"));
  saveDirection(root, d());
  const r = handleProjectDirection(root, { type: "project-direction-decide", payload: { id: "d1", decision: "agree" } }, { stack: { tools: [] }, model: { nodes: [], edges: [] }, files: {} });
  assert.match(r.error, /the code no longer shows it/);
  assert.equal(loadDirection(root).rules[0].status, "proposed");
});

test("an agreed plan principle is carried with its check; the inbox shows a proposal and a person decides it there", () => {
  const plan = { policies: [{ id: "p1", text: "Ingest never calls the network", why: "it runs offline", status: "agreed", check: { rule: "import-only", tool: "requests", files: ["telemetry/http_client.py"] } }, { id: "p2", text: "maybe", why: "", status: "proposed" }] };
  const found = census({ stack: { tools: [] }, model: { nodes: [], edges: [] }, files: {}, plan });
  assert.deepEqual(found.map((c) => [c.basis, c.check?.rule]), [["plan:policies:p1", "import-only"]], "only an AGREED principle");
  const root = mkdtempSync(join(base, "inbox-"));
  saveDirection(root, mergeCensus({ version: "1", rules: [] }, found).direction);
  const items = buildInbox(root).filter((i) => i.kind === "direction");
  assert.deepEqual(items.map((i) => i.id), ["direction:d1"]);
  assert.equal(decideInbox(root, "direction:d1", "agree", { who: "a person" }).ok, true);
  assert.equal(loadDirection(root).rules[0].status, "agreed");
  assert.equal(personOnlyStep("direction", ["project", "agree", "d1"]), "direction project agree");
  assert.equal(personOnlyStep("direction", ["project", "census"]), null, "reading is anyone's");
});

test("through the hooks: an agreed rule arrives once with its threads; going against it is a note with its why, never a block", () => {
  const r = runProjectDirection(["census", fleet]);
  assert.equal(r.exitCode, 0, r.text);
  const id = loadDirection(fleet).rules.find((x) => x.basis === "funnel:sqlite3").id;
  assert.equal(runProjectDirection(["agree", id, fleet]).exitCode, 0);
  const hook = (event, input) => runHook(event, input, { absRoot: fleet, pipeline: {} });
  const ctx = (x) => x?.json?.hookSpecificOutput?.additionalContext ?? "";
  hook("session-start", { session_id: "pd", source: "startup" });
  const first = ctx(hook("prompt", { session_id: "pd", prompt: "make ingest_batch in telemetry/ingest.py log rejected readings" }));
  assert.match(first, new RegExp(`## This project's direction[^\\n]*\\n- ${id}: Reach sqlite3 through telemetry\\.storage`));
  assert.doesNotMatch(ctx(hook("prompt", { session_id: "pd", prompt: "and telemetry/ingest.py again" })), /This project's direction/, "once per session");
  // an edit that reaches sqlite3 directly, outside the funnel
  const file = join(fleet, "telemetry", "rogue.py");
  writeFileSync(file, "import sqlite3\n\n\ndef peek():\n    return sqlite3.connect('x.db')\n");
  const after = hook("post-edit", { session_id: "pd", tool_name: "Write", tool_input: { file_path: file } });
  assert.equal(after.block, undefined, "direction never blocks");
  assert.match(ctx(after), new RegExp(`goes against the project's agreed direction \\(advice, not a block[^\\n]*\\n- ${id}: Reach sqlite3 through telemetry\\.storage[^\\n]* — why: 5 files use sqlite3`));
  assert.match(ctx(after), /now: .*rogue\.py/);
});

test("2026-10-20: each agreed rule has its own two switches — off up front is silent at the prompt, off when broken is silent after an edit", () => {
  const id = loadDirection(fleet).rules.find((x) => x.basis === "funnel:sqlite3").id;
  const hook = (event, input) => runHook(event, input, { absRoot: fleet, pipeline: {} });
  const ctx = (x) => x?.json?.hookSpecificOutput?.additionalContext ?? "";
  // the GUI's door: a person sets one switch; the reply carries the default for rules with none
  const p = handleProjectDirection(fleet, { type: "project-direction-deliver", payload: { id, upfront: false } }, facts(fleet));
  assert.equal(p.error, undefined, p.error);
  assert.deepEqual(p.defaultDelivery, { upfront: true, onCheck: true });
  assert.deepEqual(loadDirection(fleet).rules.find((x) => x.id === id).delivery, { upfront: false, onCheck: true });
  hook("session-start", { session_id: "sw", source: "startup" });
  assert.doesNotMatch(ctx(hook("prompt", { session_id: "sw", prompt: "make ingest_batch in telemetry/ingest.py log rejected readings" })), /This project's direction/, "not told up front");
  // still explained when broken
  const file = join(fleet, "telemetry", "rogue2.py");
  writeFileSync(file, "import sqlite3\n\n\ndef peek2():\n    return sqlite3.connect('y.db')\n");
  assert.match(ctx(hook("post-edit", { session_id: "sw", tool_name: "Write", tool_input: { file_path: file } })), /goes against the project's agreed direction/);
  // and the CLI's door turns that off too
  assert.equal(runDirection(["set", id, "--when-broken", "off", fleet]).exitCode, 0);
  hook("session-start", { session_id: "sw2", source: "startup" });
  writeFileSync(join(fleet, "telemetry", "rogue3.py"), "import sqlite3\n\n\ndef peek3():\n    return sqlite3.connect('z.db')\n");
  assert.doesNotMatch(ctx(hook("post-edit", { session_id: "sw2", tool_name: "Write", tool_input: { file_path: join(fleet, "telemetry", "rogue3.py") } })), /agreed direction/, "not explained");
  // what cannot be set: a proposed rule, and the why of a rule nothing checks
  const d = { version: "1", rules: [
    { id: "d1", text: "t", why: "w", basis: "b1", evidence: [], status: "proposed", stamp: "s" },
    { id: "d2", text: "t", why: "w", basis: "b2", evidence: [], status: "agreed", stamp: "s" },
  ] };
  assert.match(setRuleDelivery(d, "d1", { upfront: true }, { upfront: true, onCheck: true }), /agree it first/);
  assert.match(setRuleDelivery(d, "d2", { onCheck: true }, { upfront: true, onCheck: false }), /no check/);
  // the e2e found it: a rule nothing checks, with the default (both on), refused
  // every press because the merged value kept "explain when broken" on
  assert.equal(setRuleDelivery(d, "d2", { upfront: false }, { upfront: true, onCheck: true }), null);
  assert.deepEqual(d.rules[1].delivery, { upfront: false, onCheck: false });
  assert.deepEqual(ruleDelivery(d.rules[1], undefined), { upfront: false, onCheck: false });
  assert.deepEqual(ruleDelivery({ ...d.rules[1], delivery: undefined }, "on-violation"), { upfront: false, onCheck: false }, "no check: never explained");
});
