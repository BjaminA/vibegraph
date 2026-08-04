// M-FS4 (full-scope review 2026-07, P2) — generic verbs don't invent a DB.
//
// `self.levels.get(sku, 0)` — a plain dict access — was classified
// "DB READ" and surfaced in the external-effects panel as a database
// the project doesn't have. Generic English verbs (get/read/list/add/
// close/…) now classify DB only when the RECEIVER pledges it
// (conn/cursor/session/db/…); cursor/ORM vocabulary (fetchall, query,
// scalars, execute) still classifies on its own.
//
// Run: npm run test:colour-db

import { test } from "node:test";
import assert from "node:assert/strict";
import { accentForThreadNode } from "../src/webview/threads/colour_for_node.ts";

function externalNode(label) {
  return { id: `external:${label}`, kind: "external", label, file: null, irNodeId: null };
}

const classify = (label) => accentForThreadNode(externalNode(label), null, null);

test("M-FS4: dict/list generic verbs on ordinary receivers are NOT db", () => {
  for (const label of [
    "self.levels.get", "movements.list", "flagged.add", "rows.count",
    "fh.close", "settings.read", "items.filter", "cache_map.first",
  ]) {
    const { kindLabel } = classify(label);
    assert.ok(
      !kindLabel.startsWith("DB"),
      `${label} must not classify as DB (got ${kindLabel})`,
    );
  }
});

test("M-FS4: the same generic verbs ON a db-pledging receiver stay db", () => {
  assert.equal(classify("conn.get").kindLabel, "DB READ");
  assert.equal(classify("session.filter").kindLabel, "DB READ");
  assert.equal(classify("db.all").kindLabel, "DB READ");
  assert.equal(classify("conn.close").kindLabel, "DB");
  assert.equal(classify("session.add").kindLabel, "DB");
});

test("M-FS4: cursor/ORM vocabulary classifies db without a receiver pledge", () => {
  assert.equal(classify("cur.fetchall").kindLabel, "DB READ");
  assert.equal(classify("result.scalars").kindLabel, "DB READ");
  assert.equal(classify("stmt.execute").kindLabel, "DB");
  assert.equal(classify("sqlite3.Connection.execute").kindLabel, "DB");
  assert.equal(classify("conn.commit").kindLabel, "DB WRITE");
});
