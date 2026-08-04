#!/usr/bin/env node
/**
 * PLAN-v7 Stage 4b — stub `claude -p --output-format json` for the builder
 * (test/e2e/plan-v7-4b-builder.spec.ts). Emits a fixed create-note increment
 * as the model reply inside the real CLI's `.result` envelope (never the
 * real `claude` in automation — M10R.7).
 *
 * The increment mirrors 4a's proven shapes (flask route → backend subsystem;
 * sqlite → db subsystem; PURE validate_title targeted by the check so the
 * effect-scan floor lets the check RUN). The full 4a floor re-runs on this
 * draft server-side — the stub only replaces the drafting, never the floor.
 *
 * FENCE-FIRST reply (the M18.5 lesson): LABEL:/FILE:/CHECK: lines with one
 * ```python fence per module — never multi-line code inside JSON strings.
 *
 * VG_BUILD_SESSION default-on: the builder now arrives over stream-json
 * (one persistent child, one turn per increment) — served by the shared
 * shim; the classic -p json path remains for the arch/roadmap spawns.
 */
import { maybeServeStreamJson } from "./stream_json_stub.mjs";

const reply = [
  "LABEL: the create-note flow",
  "FILE: app.py",
  "```python",
  "from flask import Flask, jsonify",
  "",
  "from db import insert_note",
  "",
  "app = Flask(__name__)",
  "",
  "",
  '@app.route("/notes", methods=["POST"])',
  "def create_note_route():",
  '    note = insert_note("hello")',
  "    return jsonify(note)",
  "```",
  "FILE: db.py",
  "```python",
  "import sqlite3",
  "",
  'DB_PATH = "notes.sqlite"',
  "",
  "",
  "def validate_title(title):",
  "    if not title:",
  "        return None",
  "    return title",
  "",
  "",
  "def insert_note(title):",
  "    conn = sqlite3.connect(DB_PATH)",
  '    conn.execute("INSERT INTO notes (title) VALUES (?)", (title,))',
  "    conn.commit()",
  "    conn.close()",
  '    return {"title": title}',
  "```",
  "CHECK: validate_title accepts a real title and declines an empty one",
  "```python",
  "from db import validate_title",
  "",
  "",
  "def __vg_check__():",
  '    assert validate_title("hello") == "hello"',
  '    assert validate_title("") is None',
  "```",
].join("\n");
if (!maybeServeStreamJson(() => reply)) {
  process.stdout.write(JSON.stringify({ result: reply, is_error: false, session_id: "fake-builder" }));
  process.exit(0);
}
