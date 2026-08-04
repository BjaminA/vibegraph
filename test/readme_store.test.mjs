// Dynamic-README store tests (M20.1, PLAN-v5 §2). Foundation only —
// hashing, on-disk frontmatter round-trip, and the staleness rule
// (stored sourceHash vs the current IR hash). Generation + UI are M20.2.
//
// Imports the .ts store directly (Node strips types — see the npm flag).
//
// Run: npm run test:readme

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalKey, parseKey, stableStringify, sourceHashOf,
  readmePath, writeReadme, readStored, getReadme,
} from "../src/server/readme_store.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SYSTEM_PROJECT = JSON.parse(readFileSync(
  join(ROOT, "test", "fixtures", "system", "system_demo", "system_demo.project.json"), "utf-8"));

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), "vg-readme-"));
}

test("M20.1: canonicalKey / parseKey round-trip, id may contain colons", () => {
  const id = "app.py:get_user_route";
  const key = canonicalKey("thread", id);
  assert.equal(key, "thread:app.py:get_user_route");
  assert.deepEqual(parseKey(key), { scope: "thread", id });
});

test("M20.1: sourceHashOf is stable across key ordering, sensitive to content", () => {
  const a = { x: 1, y: [1, 2], z: { b: 2, a: 1 } };
  const b = { z: { a: 1, b: 2 }, y: [1, 2], x: 1 }; // same data, different order
  assert.equal(sourceHashOf(a), sourceHashOf(b), "hash must be order-invariant");
  assert.notEqual(sourceHashOf(a), sourceHashOf({ ...a, x: 2 }), "hash must change with content");
  assert.match(sourceHashOf(a), /^sha256:[0-9a-f]{64}$/);
  // stableStringify sorts keys.
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("M20.1: readmePath segregates threads vs files and slugs the id", () => {
  const r = "/proj";
  assert.equal(readmePath(r, "thread", "app.py:get_user_route"),
    join(r, ".vibegraph", "readmes", "threads", "app.py_get_user_route.md"));
  assert.equal(readmePath(r, "file", "web/src/api.jsx"),
    join(r, ".vibegraph", "readmes", "files", "web_src_api.jsx.md"));
});

test("M20.1: write → read round-trips the frontmatter + body", () => {
  const root = tmpRoot();
  const body = "This thread lists users.\n\n- reaches the db.";
  const p = writeReadme(root, "thread", "app.py:list_users_route", body, "sha256:abc", "2026-06-08T00:00:00Z");
  assert.ok(existsSync(p));
  const stored = readStored(root, "thread", "app.py:list_users_route");
  assert.equal(stored.scope, "thread");
  assert.equal(stored.id, "app.py:list_users_route");
  assert.equal(stored.sourceHash, "sha256:abc");
  assert.equal(stored.generatedAt, "2026-06-08T00:00:00Z");
  assert.equal(stored.body.trim(), body.trim());
});

test("M20.1: getReadme — hash match → fresh, mismatch → stale", () => {
  const root = tmpRoot();
  writeReadme(root, "file", "store.py", "DB access layer.", "sha256:H1", "t");

  const fresh = getReadme(root, "file", "store.py", "sha256:H1");
  assert.equal(fresh.exists, true);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.body, "DB access layer.");

  const stale = getReadme(root, "file", "store.py", "sha256:H2-different");
  assert.equal(stale.exists, true);
  assert.equal(stale.stale, true, "a diverged current hash must read stale");
});

test("M20.1: getReadme — absent README is a well-formed not-generated result", () => {
  const root = tmpRoot();
  const r = getReadme(root, "thread", "never.py:written", "sha256:whatever");
  assert.equal(r.exists, false);
  assert.equal(r.scope, "thread");
  assert.equal(r.id, "never.py:written");
  assert.equal(r.key, "thread:never.py:written");
});

test("M20.1: a thread's filesReached change auto-stales its README (system_demo)", () => {
  const root = tmpRoot();
  const thread = SYSTEM_PROJECT.threads.find((t) => t.entryPointId === "app.py:get_user_route");
  assert.ok(thread, "missing get_user_route thread");

  // Generate against the current thread IR → reads fresh.
  const h0 = sourceHashOf(thread);
  writeReadme(root, "thread", "app.py:get_user_route", "Fetches a user, cache-first.", h0, "t");
  assert.equal(getReadme(root, "thread", "app.py:get_user_route", h0).stale, false);

  // Simulate M8.3 re-extraction widening the reach set → hash diverges
  // → the same README now reads stale (no rewrite needed).
  const reached = { ...thread, filesReached: [...thread.filesReached, "newly_reached.py"] };
  const h1 = sourceHashOf(reached);
  assert.notEqual(h1, h0);
  assert.equal(getReadme(root, "thread", "app.py:get_user_route", h1).stale, true);
});
