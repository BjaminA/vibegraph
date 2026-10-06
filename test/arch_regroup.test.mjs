// GROUPS RE-FORMED FROM FACTS (2026-10-06, direction review M12). Ratified
// groups were a model's sentences and outlived their code: three new runtime
// processes sat in no group while a label still named "3 of 17 identities"
// and a port its members did not use. Fixture test/fixtures/system/
// processes_demo (a copy). Pinned: a listening process carries its port;
// processes group by the identity the code runs them as, the rest by package;
// a label says only what every member shares and is rebuilt from the members
// on every derive (`labelFrom: "facts"`); the regroup is a PENDING replace —
// gated, never over a pending draft, over ratified groups only when they
// drifted (or forced) — and ratifying it replaces the stale groups; the inbox
// offers it when the groups drifted, zero tokens.
//
//   npm run test:arch-regroup
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { regroupFromFacts } from "../src/server/arch_regroup.ts";
import { applyArchStore, emptyStore, loadArchStore, ratifyProposal, saveArchStore } from "../src/server/arch_store.ts";
import { archBaseline } from "../src/server/arch_drift.ts";
import { buildInbox, decideInbox } from "../src/server/inbox.ts";

let tmp, root, derived;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-regroup-"));
  root = join(tmp, "p");
  cpSync("test/fixtures/system/processes_demo", root, { recursive: true });
  const env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  derived = archModelForEnvelope(env, buildStackIndex(env, root), buildCrossingIndex(env), root, undefined, { applyStore: false });
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test("a listening process carries its port; processes group by identity, then package", () => {
  assert.equal(derived.nodes.find((n) => n.id === "cluster:process:.:server").runtime.port, "8080");
  const r = regroupFromFacts(derived, emptyStore());
  assert.deepEqual(r.groups.map((g) => [g.label, g.wraps]), [
    ["runs as $SVC_USER · port 8080", ["cluster:process:.:server"]],
    ["runs as its own identity per run", ["cluster:process:.:runner"]],
    ["package (root)", ["cluster:scripts:."]],
  ]);
  assert.ok(r.groups.every((g) => g.labelFrom === "facts" && g.evidence.length));
  assert.equal(r.store.proposal.mode, "replace");
});

test("the gate: never over a pending draft; over ratified groups only when they drifted or a person forces it", () => {
  const ratified = { ...emptyStore(), groups: [{ id: "old", kind: "host", label: "3 of 17 identities · port 4000", wraps: ["cluster:process:.:server"] }], ratified: { at: "2026-10-01", model: "m" } };
  assert.match(regroupFromFacts(derived, ratified).error, /still match the code/);
  assert.ok(regroupFromFacts(derived, ratified, { drifted: true }).store);
  assert.ok(regroupFromFacts(derived, ratified, { force: true }).store);
  assert.match(regroupFromFacts(derived, regroupFromFacts(derived, emptyStore()).store).error, /already pending/);
});

test("ratifying replaces the stale groups; a fact label is rebuilt on every derive", () => {
  const stale = { ...emptyStore(), groups: [{ id: "old", kind: "host", label: "3 of 17 identities · port 4000", wraps: ["cluster:process:.:server"] }], ratified: { at: "2026-10-01", model: "m" } };
  const done = ratifyProposal(regroupFromFacts(derived, stale, { drifted: true }).store);
  assert.ok(!done.groups.some((g) => g.id === "old"), "the stale group is gone");
  // a stored label that no longer says the facts is not what is drawn
  done.groups[0].label = "whatever was written once";
  const drawn = applyArchStore(derived, done).groups.find((g) => g.id === done.groups[0].id);
  assert.equal(drawn.label, "runs as $SVC_USER · port 8080");
});

test("the inbox offers the regroup when the groups drifted, and agreeing applies it", () => {
  saveArchStore(root, {
    ...emptyStore(),
    groups: [{ id: "old", kind: "host", label: "3 of 17 identities · port 4000", wraps: ["cluster:process:.:server"] }],
    ratified: { at: "2026-10-01T00:00:00.000Z", model: "m" },
    baseline: { at: "2026-10-01T00:00:00.000Z", clusters: ["cluster:process:.:server"], deploy: [] },
  });
  const item = buildInbox(root, { model: derived }).find((i) => i.id === "regroup");
  assert.ok(item?.decidable, "offered");
  assert.match(item.title, /zero tokens/);
  const r = decideInbox(root, "regroup", "agree", { model: derived, archBaseline: (s) => archBaseline(applyArchStore(derived, s), [], null) });
  assert.ok(r.ok, r.detail);
  const after = loadArchStore(root);
  assert.ok(!after.groups.some((g) => g.id === "old"));
  assert.ok(after.groups.every((g) => g.labelFrom === "facts"));
  assert.ok(!buildInbox(root, { model: derived }).some((i) => i.id === "regroup"), "the groups match the code again");
  assert.equal(decideInbox(root, "regroup", "reject", { model: derived }).ok, false);
});
