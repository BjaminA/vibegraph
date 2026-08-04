// M-RUN SM3 — consent-integrity contract for the side-effect run gate.
//
// The token must be SCOPED (one node + one exact effect set), order-stable,
// and unforgeable-against-tamper. These are the don't-trust-the-client
// properties: a stale, blanket, or altered consent must NOT authorize a run.
//
// Run: npm run test:effect-consent

import { test } from "node:test";
import assert from "node:assert/strict";
import { mintEffectConsent, verifyEffectConsent, canonicalizeEffects } from "../src/server/run/effect_consent.ts";

const NODE = "m/main.fn/x.assign";
const fx = (over = {}) => ({ kind: "effect", effectKind: "fs", target: "open", file: "m.py", line: 3, ...over });
const E1 = [fx(), fx({ effectKind: "http", target: "requests.get", line: 9 })];

test("roundtrip: a token verifies for the exact (node, effects) it was minted for", () => {
  const token = mintEffectConsent(NODE, E1);
  assert.equal(verifyEffectConsent(NODE, E1, token), true);
});

test("order-independent: reordered effect list yields the same consent", () => {
  const token = mintEffectConsent(NODE, E1);
  const reordered = [E1[1], E1[0]];
  assert.equal(verifyEffectConsent(NODE, reordered, token), true);
  assert.equal(mintEffectConsent(NODE, reordered), token);
});

test("scoped to the node: a token for one node does not authorize another", () => {
  const token = mintEffectConsent(NODE, E1);
  assert.equal(verifyEffectConsent("m/other.fn/y.assign", E1, token), false);
});

test("tamper: changing any effect field invalidates the token", () => {
  const token = mintEffectConsent(NODE, E1);
  assert.equal(verifyEffectConsent(NODE, [fx(), fx({ effectKind: "http", target: "requests.get", line: 10 })], token), false); // line
  assert.equal(verifyEffectConsent(NODE, [fx({ effectKind: "db" }), E1[1]], token), false);                                    // effectKind
  assert.equal(verifyEffectConsent(NODE, [fx({ target: "os.remove" }), E1[1]], token), false);                                 // target
});

test("not a blanket: a token for a subset/superset of effects fails", () => {
  const token = mintEffectConsent(NODE, E1);
  assert.equal(verifyEffectConsent(NODE, [E1[0]], token), false);                       // subset
  assert.equal(verifyEffectConsent(NODE, [...E1, fx({ effectKind: "log", line: 99 })], token), false); // superset
});

test("no token / empty token never verifies", () => {
  assert.equal(verifyEffectConsent(NODE, E1, null), false);
  assert.equal(verifyEffectConsent(NODE, E1, undefined), false);
  assert.equal(verifyEffectConsent(NODE, E1, ""), false);
});

test("a forged hex string of the right length does not verify (unforgeable)", () => {
  const token = mintEffectConsent(NODE, E1);
  const forged = "a".repeat(token.length);
  assert.notEqual(forged, token);
  assert.equal(verifyEffectConsent(NODE, E1, forged), false);
});

test("canonicalize is stable and node-prefixed", () => {
  assert.equal(canonicalizeEffects(NODE, E1), canonicalizeEffects(NODE, [E1[1], E1[0]]));
  assert.ok(canonicalizeEffects(NODE, E1).startsWith(NODE + "\n"));
});

// ── PLAN-v7 6b — the changeset consent SCOPE (changesetConsentScope) ──
// The "nodeId" half of the token when consenting an effectful CHANGESET
// check: a content hash of (files + check module), so any edit between
// consent and re-propose changes the scope and the stale token is rejected.
import { changesetConsentScope } from "../src/server/changeset.ts";

const CS = {
  label: "the metrics increment",
  files: [{ path: "metrics.py", content: "def f():\n    return 1\n" }],
  check: { module: "def __vg_check__():\n    assert True\n", description: "f works" },
};

test("changeset scope: deterministic for identical content, label-independent", () => {
  const again = { ...CS, label: "a DIFFERENT label", drafted: true };
  assert.equal(changesetConsentScope(CS), changesetConsentScope(again));
  assert.ok(changesetConsentScope(CS).startsWith("changeset:"));
});

test("changeset scope: any content drift (file, path, check) changes the scope — stale tokens die", () => {
  const scope = changesetConsentScope(CS);
  const fileDrift = { ...CS, files: [{ path: "metrics.py", content: "def f():\n    return 2\n" }] };
  const pathDrift = { ...CS, files: [{ path: "metrics2.py", content: CS.files[0].content }] };
  const checkDrift = { ...CS, check: { ...CS.check, module: "def __vg_check__():\n    assert 1\n" } };
  // 6c: the op is part of the consented ACTION — the same content as an
  // append instead of a create is a different thing to authorize.
  const opDrift = { ...CS, files: [{ ...CS.files[0], op: "append_end" }] };
  for (const drifted of [fileDrift, pathDrift, checkDrift, opDrift]) {
    assert.notEqual(changesetConsentScope(drifted), scope);
  }
  // ...and via the token machinery end-to-end: a token minted for CS's scope
  // does not verify against a drifted changeset's scope.
  const token = mintEffectConsent(scope, E1);
  assert.equal(verifyEffectConsent(changesetConsentScope(fileDrift), E1, token), false);
  assert.equal(verifyEffectConsent(scope, E1, token), true);
});

// ── M-RUN2.3 — example-data consent (content-hash-bound scope) ─────────────
import { mintDataConsent, verifyDataConsent } from "../src/server/run/effect_consent.ts";

test("data consent round-trips for exactly (node, path, content)", () => {
  const t = mintDataConsent("m/f.fn/x.assign", "data/signals.csv", "a,b\n1,2\n");
  assert.equal(verifyDataConsent("m/f.fn/x.assign", "data/signals.csv", "a,b\n1,2\n", t), true);
});

test("data consent dies on ANY drift: content byte, path, node, token tamper, empty", () => {
  const t = mintDataConsent("n1", "data/x.csv", "a,b\n1,2\n");
  assert.equal(verifyDataConsent("n1", "data/x.csv", "a,b\n1,3\n", t), false, "edited content");
  assert.equal(verifyDataConsent("n1", "data/y.csv", "a,b\n1,2\n", t), false, "swapped path");
  assert.equal(verifyDataConsent("n2", "data/x.csv", "a,b\n1,2\n", t), false, "other node");
  const flipped = t.slice(0, -1) + (t.endsWith("0") ? "1" : "0");
  assert.equal(verifyDataConsent("n1", "data/x.csv", "a,b\n1,2\n", flipped), false, "tampered token");
  assert.equal(verifyDataConsent("n1", "data/x.csv", "a,b\n1,2\n", ""), false, "empty token");
});

test("data consent and effect consent are DISJOINT scopes — tokens never cross", () => {
  const eff = mintEffectConsent("n1", [{ kind: "effect", effectKind: "fs", target: "open", file: "r.py", line: 3 }]);
  assert.equal(verifyDataConsent("n1", "data/x.csv", "a\n", eff), false);
  const dat = mintDataConsent("n1", "data/x.csv", "a\n");
  assert.equal(verifyEffectConsent("n1", [{ kind: "effect", effectKind: "fs", target: "open", file: "r.py", line: 3 }], dat), false);
});

// ── Sitting-2 — session category-trust for unverifiable calls ─────────────
// The grant: server-minted from a shown gate, filters GATING only (never the
// scan), excludes proven effects, dies with the process.
import {
  gatedOffenses, grantUnverifiedTrust, mintUnverifiedTrust, isTrustableOffense,
  hasUnverifiedTrust, _resetUnverifiedTrustForTest,
} from "../src/server/run/effect_consent.ts";

const dyn = (over = {}) => ({ kind: "dynamic", effectKind: null, target: "model.train", file: "t.py", line: 27, ...over });
const MIXED = [
  fx(),                                              // proven fs effect
  dyn(),                                             // dynamic dispatch
  dyn({ kind: "unresolved", target: "PumpWearMLP", line: 31 }),
  dyn({ kind: "external-unprovable", target: "conn.execute", line: 40 }),
];

test("trustable classification: proven effects never, unverifiable kinds yes", () => {
  assert.equal(isTrustableOffense(fx()), false);
  assert.equal(isTrustableOffense(dyn()), true);
  assert.equal(isTrustableOffense(dyn({ kind: "unresolved" })), true);
  assert.equal(isTrustableOffense(dyn({ kind: "external-unprovable" })), true);
});

test("no grant → gatedOffenses passes everything through untouched", () => {
  _resetUnverifiedTrustForTest();
  assert.deepEqual(gatedOffenses(MIXED), MIXED);
});

test("a forged/stale trust token does NOT grant", () => {
  _resetUnverifiedTrustForTest();
  assert.equal(grantUnverifiedTrust(NODE, MIXED, "deadbeef"), false);
  const other = mintUnverifiedTrust("other-node", MIXED);
  assert.equal(grantUnverifiedTrust(NODE, MIXED, other), false);
  assert.equal(hasUnverifiedTrust(), false);
});

test("a valid grant filters unverifiable kinds from gating; proven effects remain", () => {
  _resetUnverifiedTrustForTest();
  const token = mintUnverifiedTrust(NODE, MIXED);
  assert.equal(grantUnverifiedTrust(NODE, MIXED, token), true);
  assert.equal(hasUnverifiedTrust(), true);
  assert.deepEqual(gatedOffenses(MIXED), [fx()]);
  _resetUnverifiedTrustForTest();
});

test("trust and per-run consent are DISJOINT scopes — tokens never cross", () => {
  _resetUnverifiedTrustForTest();
  const consent = mintEffectConsent(NODE, MIXED);
  assert.equal(grantUnverifiedTrust(NODE, MIXED, consent), false);
  const trust = mintUnverifiedTrust(NODE, MIXED);
  assert.equal(verifyEffectConsent(NODE, MIXED, trust), false);
  _resetUnverifiedTrustForTest();
});
