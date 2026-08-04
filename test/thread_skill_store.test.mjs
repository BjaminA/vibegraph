/**
 * C1 (PLAN-v6) — thread_skill_store pure-function unit.
 *
 * Pins the ratification + staleness semantics: generation writes draft; a human
 * flips status to ratified; staleness is a hash compare at read; only a
 * ratified + fresh skill is authoritative (the injection gate). An unknown
 * status value fails safe to draft.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/thread_skill_store.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  writeThreadSkill, getThreadSkill, isAuthoritative, threadSkillPath, threadSkillKey,
} from "../src/server/thread_skill_store.ts";

const EP = "app.py:create_user_route";
const HASH = "sha256:abc";

function root() {
  return mkdtempSync(join(tmpdir(), "vg-skill-"));
}

test("write defaults to draft; read tags it not-stale at the same hash", () => {
  const r = root();
  writeThreadSkill(r, EP, "## Purpose\nDoes a thing.", HASH, "2026-06-29T00:00:00Z");
  const got = getThreadSkill(r, EP, HASH);
  assert.equal(got.exists, true);
  assert.equal(got.status, "draft");
  assert.equal(got.stale, false);
  assert.equal(got.key, threadSkillKey(EP));
  assert.match(got.body, /Does a thing/);
});

test("a draft is NOT authoritative even when fresh", () => {
  const r = root();
  writeThreadSkill(r, EP, "body", HASH, "t");
  assert.equal(isAuthoritative(getThreadSkill(r, EP, HASH)), false);
});

test("a human-ratified, fresh skill IS authoritative", () => {
  const r = root();
  // Simulate the human ratifying: write the file with status ratified.
  writeThreadSkill(r, EP, "body", HASH, "t", "ratified");
  const got = getThreadSkill(r, EP, HASH);
  assert.equal(got.status, "ratified");
  assert.equal(got.stale, false);
  assert.equal(isAuthoritative(got), true);
});

test("a ratified skill goes STALE when the thread hash changes, and stops being authoritative — but stays ratified", () => {
  const r = root();
  writeThreadSkill(r, EP, "body", HASH, "t", "ratified");
  const got = getThreadSkill(r, EP, "sha256:DIFFERENT");
  assert.equal(got.status, "ratified", "stays ratified — the human review is preserved");
  assert.equal(got.stale, true);
  assert.equal(isAuthoritative(got), false, "stale ratified is not auto-trusted");
});

test("regeneration resets a ratified skill back to draft", () => {
  const r = root();
  writeThreadSkill(r, EP, "v1", HASH, "t", "ratified");
  writeThreadSkill(r, EP, "v2", "sha256:new", "t2"); // regen → default draft
  const got = getThreadSkill(r, EP, "sha256:new");
  assert.equal(got.status, "draft");
  assert.match(got.body, /v2/);
});

test("an unknown status value fails safe to draft", () => {
  const r = root();
  const p = threadSkillPath(r, EP);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `---\nkey: thread:${EP}\nentryPointId: ${EP}\nstatus: bogus\nsourceHash: ${HASH}\ngeneratedAt: t\n---\nbody\n`);
  assert.equal(getThreadSkill(r, EP, HASH).status, "draft");
});

test("not generated → exists:false", () => {
  assert.equal(getThreadSkill(root(), "never:made", HASH).exists, false);
});

// ── M-SKILL.3 — ratifyThreadSkill: the only sanctioned status writer ──

import { ratifyThreadSkill } from "../src/server/thread_skill_store.ts";

test("ratify flips status ONLY — body, sourceHash, generatedAt untouched", () => {
  const r = root();
  writeThreadSkill(r, EP, "the reviewed body", HASH, "t0"); // draft
  const rec = ratifyThreadSkill(r, EP);
  assert.equal(rec.status, "ratified");
  assert.equal(rec.body, "the reviewed body");
  assert.equal(rec.sourceHash, HASH);
  assert.equal(rec.generatedAt, "t0");
  // and the change is durable + authoritative when fresh
  const got = getThreadSkill(r, EP, HASH);
  assert.equal(got.status, "ratified");
  assert.equal(isAuthoritative(got), true);
});

test("ratifying a draft made against an OLDER thread yields ratified+stale — honestly", () => {
  const r = root();
  writeThreadSkill(r, EP, "old-thread body", "sha256:OLD", "t0");
  ratifyThreadSkill(r, EP);
  const got = getThreadSkill(r, EP, "sha256:CURRENT");
  assert.equal(got.status, "ratified");
  assert.equal(got.stale, true);
  assert.equal(isAuthoritative(got), false, "stale ratified must not auto-inject");
});

test("ratifying a skill that does not exist returns null, writes nothing", () => {
  const r = root();
  assert.equal(ratifyThreadSkill(r, "never:made"), null);
  assert.equal(getThreadSkill(r, "never:made", HASH).exists, false);
});

// ── M-SKILL.7 — re-affirm + diff + auto-reaffirm ──────────────────────

import {
  makeThreadSnapshot, threadSkillDiff, reaffirmThreadSkill,
  setThreadSkillAutoReaffirm, injectableSkillText, AUTO_REAFFIRM_CAVEAT,
} from "../src/server/thread_skill_store.ts";

const SNAP1 = [
  { id: "db:query", kind: "seed", label: "query", file: "db.py" },
  { id: "db:_get_conn", kind: "step", label: "_get_conn", file: "db.py" },
];

test("makeThreadSnapshot keeps seed/step/external-family nodes, drops containers", () => {
  const snap = makeThreadSnapshot({ nodes: [
    { id: "a", kind: "seed", label: "main", file: "m.py" },
    { id: "c", kind: "container", label: "try", file: null },
    { id: "b", kind: "external", label: "open", file: null },
  ]});
  assert.deepEqual(snap.map((s) => s.id), ["a", "b"]);
});

test("threadSkillDiff reports added / removed / relabeled by id", () => {
  const now = [
    { id: "db:query", kind: "seed", label: "query_rows", file: "db.py" }, // relabeled
    { id: "db:audit", kind: "step", label: "audit", file: "db.py" },      // added
  ];
  const d = threadSkillDiff(SNAP1, now);
  assert.deepEqual(d.added.map((s) => s.id), ["db:audit"]);
  assert.deepEqual(d.removed.map((s) => s.id), ["db:_get_conn"]);
  assert.deepEqual(d.relabeled, [{ id: "db:query", from: "query", to: "query_rows" }]);
});

test("snapshot + autoReaffirm round-trip through serialize/parse; mangled snapshot fails safe", () => {
  const r = root();
  writeThreadSkill(r, EP, "body", HASH, "t", "ratified", SNAP1);
  setThreadSkillAutoReaffirm(r, EP, true);
  const got = getThreadSkill(r, EP, HASH);
  assert.deepEqual(got.snapshot, SNAP1);
  assert.equal(got.autoReaffirm, true);
  // mangle the snapshot line — reads as absent, never throws
  const p = threadSkillPath(r, EP);
  writeFileSync(p, readFileSync(p, "utf-8").replace(/^snapshot: .*$/m, "snapshot: {not json"));
  assert.equal(getThreadSkill(r, EP, HASH).snapshot, undefined);
});

test("reaffirm re-stamps hash+snapshot on STALE ratified only; body untouched", () => {
  const r = root();
  writeThreadSkill(r, EP, "the body", "sha256:OLD", "t", "ratified", SNAP1);
  const newSnap = [{ id: "x", kind: "seed", label: "x", file: "x.py" }];
  const rec = reaffirmThreadSkill(r, EP, "sha256:NOW", newSnap);
  assert.equal(rec.sourceHash, "sha256:NOW");
  assert.deepEqual(rec.snapshot, newSnap);
  assert.equal(rec.body, "the body");
  assert.equal(isAuthoritative(getThreadSkill(r, EP, "sha256:NOW")), true, "re-affirmed = authoritative again");
  // fresh (nothing to re-affirm) and draft both refuse
  assert.equal(reaffirmThreadSkill(r, EP, "sha256:NOW", newSnap), null, "already fresh");
  writeThreadSkill(r, EP, "d", "sha256:OLD", "t"); // draft
  assert.equal(reaffirmThreadSkill(r, EP, "sha256:NOW", newSnap), null, "draft refuses");
});

test("auto-reaffirm applies to ratified only; regeneration DROPS it", () => {
  const r = root();
  writeThreadSkill(r, EP, "b", HASH, "t"); // draft
  assert.equal(setThreadSkillAutoReaffirm(r, EP, true), null, "draft refuses");
  writeThreadSkill(r, EP, "b", HASH, "t", "ratified");
  assert.equal(setThreadSkillAutoReaffirm(r, EP, true).autoReaffirm, true);
  writeThreadSkill(r, EP, "b2", "sha256:new", "t2"); // regen → fresh trust decision
  assert.equal(getThreadSkill(r, EP, "sha256:new").autoReaffirm, undefined);
});

test("injectableSkillText: fresh=body; stale+auto=body+caveat (never silent); stale/draft=null", () => {
  const r = root();
  writeThreadSkill(r, EP, "guidance", HASH, "t", "ratified");
  assert.equal(injectableSkillText(getThreadSkill(r, EP, HASH)), "guidance");
  // stale, no opt-in → dark
  assert.equal(injectableSkillText(getThreadSkill(r, EP, "sha256:CHANGED")), null);
  // stale + human opt-in → body WITH the caveat
  setThreadSkillAutoReaffirm(r, EP, true);
  const text = injectableSkillText(getThreadSkill(r, EP, "sha256:CHANGED"));
  assert.ok(text.startsWith("guidance"));
  assert.ok(text.includes(AUTO_REAFFIRM_CAVEAT), "caveat must ride the injection");
  // drafts never inject regardless
  writeThreadSkill(r, EP, "d", HASH, "t");
  assert.equal(injectableSkillText(getThreadSkill(r, EP, HASH)), null);
});
