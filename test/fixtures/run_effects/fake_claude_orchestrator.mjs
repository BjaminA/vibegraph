#!/usr/bin/env node
/**
 * PLAN-v7 Stage 5 — stub `claude -p` for the orchestrator e2e
 * (test/e2e/plan-v7-5-orchestrator.spec.ts). ONE stub, prompt-aware
 * (the prompt is the last argv): it answers the roadmap-draft prompt with a
 * JSON roadmap, and each increment-draft prompt with the fenced changeset
 * matching the capability named in it. Deterministic; never the real CLI
 * (M10R.7). The full floor re-runs on every draft server-side — the stub
 * only replaces the drafting.
 *
 * The "unsafe metrics" capability deliberately drafts an increment whose
 * check does file I/O: the effect-scan floor must refuse to run it silently
 * and the gate must open with the 6b CONSENT affordance (an effectful check
 * is a question for the human, not a floor verdict). The "deliberately
 * broken module" capability drafts a file that does not PARSE: the file
 * floor is red for a non-consentable reason, so the item FAILS with the
 * honest reason and the run pauses (the ratified failure semantics).
 */
// VG_BUILD_SESSION default-on: increment drafts arrive over stream-json
// (one persistent child, one turn per increment); roadmap drafts remain
// one-shot -p json. The prompt→reply mapping below serves both protocols.
import { maybeServeStreamJson } from "./stream_json_stub.mjs";

function replyFor(prompt) {
// ── roadmap draft ──
if (prompt.includes("planning the BUILD ORDER")) {
  return (JSON.stringify({
    items: [
      { id: "note-validation", capability: "a pure validate_title module for notes", needs: [], groundedIn: "a flask API" },
      { id: "note-api", capability: "the flask POST /notes route over a sqlite store", needs: ["note-validation"], groundedIn: "a sqlite note store" },
    ],
  }));
}

// ── increment 1: pure validation ──
if (prompt.includes("a pure validate_title module")) {
  return ([
    "LABEL: note validation",
    "FILE: validation.py",
    "```python",
    "def validate_title(title):",
    "    if not title:",
    "        return None",
    "    return title",
    "```",
    "CHECK: validate_title accepts a real title and declines an empty one",
    "```python",
    "from validation import validate_title",
    "",
    "",
    "def __vg_check__():",
    '    assert validate_title("hello") == "hello"',
    '    assert validate_title("") is None',
    "```",
  ].join("\n"));
}

// ── the consent case: a check that does I/O → floor refuses to run it
// silently; the gate opens with the 6b consent affordance. The check uses
// the `with open(...) as f:` form ON PURPOSE: it was the parser blind-spot
// this stub originally had to avoid (no node for with-items), fixed in 6a —
// the floor provably catches it now, and 6b consents through it.
if (prompt.includes("unsafe metrics")) {
  return ([
    "LABEL: metrics with an effectful check",
    "FILE: metrics.py",
    "```python",
    "def count_notes(notes):",
    "    return len(notes)",
    "```",
    "CHECK: counting writes a scratch file (deliberately impure)",
    "```python",
    "def __vg_check__():",
    '    with open("scratch.txt", "w") as f:',
    '        f.write("1")',
    "```",
  ].join("\n"));
}

// ── the failure case: a module that does not PARSE → the file floor is
// red for a NON-consentable reason → the item fails honestly + run pauses.
if (prompt.includes("deliberately broken module")) {
  return ([
    "LABEL: a module that does not parse",
    "FILE: broken.py",
    "```python",
    "def broken(:",
    "    pass",
    "```",
    "CHECK: never reached — the file floor is red first",
    "```python",
    "def __vg_check__():",
    "    assert True",
    "```",
  ].join("\n"));
}

// ── increment 2: flask route + sqlite store ──
return ([
  "LABEL: the create-note flow",
  "FILE: db.py",
  "```python",
  "import sqlite3",
  "",
  "from validation import validate_title",
  "",
  'DB_PATH = "notes.sqlite"',
  "",
  "",
  "def note_row(title):",
  '    return {"title": title}',
  "",
  "",
  "def insert_note(title):",
  "    if validate_title(title) is None:",
  "        return None",
  "    conn = sqlite3.connect(DB_PATH)",
  '    conn.execute("INSERT INTO notes (title) VALUES (?)", (title,))',
  "    conn.commit()",
  "    conn.close()",
  "    return note_row(title)",
  "```",
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
  "CHECK: note_row maps a title to the stored shape",
  "```python",
  "from db import note_row",
  "",
  "",
  "def __vg_check__():",
  '    assert note_row("hello") == {"title": "hello"}',
  "```",
].join("\n"));
}

if (!maybeServeStreamJson(replyFor)) {
  const prompt = process.argv[process.argv.length - 1] ?? "";
  process.stdout.write(JSON.stringify({ result: replyFor(prompt), is_error: false, session_id: "fake-orch" }));
  process.exit(0);
}
