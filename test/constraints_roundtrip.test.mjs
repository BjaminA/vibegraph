// Refuse to write what you cannot round-trip (2026-10-02, a trap from the
// field): an older CLI rewrote constraints.json and DROPPED every rule it did
// not understand. A save now carries an unreadable rule through verbatim, keeps
// an unknown field on its rule, never reuses an id an unreadable rule holds,
// and refuses a file whose version it does not read.
//
//   node --experimental-strip-types --no-warnings --test test/constraints_roundtrip.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addConstraint, loadConstraints, removeConstraint, ConstraintsNotRoundTrippable } from "../src/server/constraint_store.ts";

function project(body) {
  const root = mkdtempSync(join(tmpdir(), "vg-rt-"));
  mkdirSync(join(root, ".vibegraph"));
  writeFileSync(join(root, ".vibegraph/constraints.json"), JSON.stringify(body, null, 2));
  return root;
}
const onDisk = (root) => JSON.parse(readFileSync(join(root, ".vibegraph/constraints.json"), "utf8"));
const known = { id: "c1", kind: "invariant", text: "Only the ledger writes payments", scope: { all: true }, source: "human", createdAt: "2026-10-01T00:00:00Z", futureField: { kept: true } };
const fromTheFuture = { id: "c2", kind: "invariant", text: "Writes are idempotent", scope: { all: true }, source: "human", createdAt: "2026-10-01T00:00:00Z", check: { rule: "idempotent-writes", target: "save" } };

test("a rule this version cannot read survives an add and a remove, verbatim; an unknown field stays on its rule", () => {
  const root = project({ version: "1", constraints: [known, fromTheFuture] });
  try {
    assert.deepEqual(loadConstraints(root).map((c) => c.id), ["c1"], "this version reads only c1");
    const added = addConstraint(root, { kind: "invariant", text: "Audit lines are append-only", scope: { all: true } }, "human");
    assert.equal(added.id, "c3", "c2 is taken, even though this version cannot read it");
    let disk = onDisk(root);
    assert.deepEqual(disk.constraints.map((c) => c.id).sort(), ["c1", "c2", "c3"]);
    assert.deepEqual(disk.constraints.find((c) => c.id === "c2"), fromTheFuture, "carried through verbatim");
    assert.deepEqual(disk.constraints.find((c) => c.id === "c1").futureField, { kept: true });
    assert.equal(removeConstraint(root, "c1"), true);
    disk = onDisk(root);
    assert.deepEqual(disk.constraints.map((c) => c.id).sort(), ["c2", "c3"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a file of a version this code does not read is never rewritten", () => {
  const body = { version: "2", constraints: [known] };
  const root = project(body);
  try {
    assert.throws(() => addConstraint(root, { kind: "invariant", text: "Anything at all, said twice", scope: { all: true } }, "human"), ConstraintsNotRoundTrippable);
    assert.deepEqual(onDisk(root), body, "untouched");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
