#!/usr/bin/env node
/**
 * M-GF3.5 — stub `claude -p` for the modify-gate e2e
 * (test/e2e/m-gf3-modify-gate.spec.ts). Prompt-aware like the orchestrator
 * stub, plus a REVISION branch: when the prompt carries the "REVISION
 * GUIDANCE" marker (the Modify affordances fold the human's instruction in
 * under that heading), the reply is a visibly REVISED draft — so the e2e can
 * assert Modify genuinely re-drafts (affordance-must-match). Deterministic;
 * never the real CLI (M10R.7).
 */
// VG_BUILD_SESSION default-on: increment (and revision) drafts arrive over
// stream-json; the roadmap draft stays -p json. `revising` is computed
// per-prompt so a session turn carrying REVISION GUIDANCE re-drafts too.
import { maybeServeStreamJson } from "./stream_json_stub.mjs";

function replyFor(prompt) {
const revising = prompt.includes("REVISION GUIDANCE");

// ── roadmap draft (5b) ──
if (prompt.includes("planning the BUILD ORDER")) {
  return (JSON.stringify({
    items: [
      {
        id: "note-validation",
        capability: revising
          ? "a pure validate_title module for notes with docstrings on every function"
          : "a pure validate_title module for notes",
        needs: [],
        groundedIn: "a flask API",
      },
    ],
  }));
}

// ── increment draft: the validation capability (base or revised) ──
if (prompt.includes("a pure validate_title module")) {
  return ([
    revising ? "LABEL: note validation (revised)" : "LABEL: note validation",
    "FILE: validation.py",
    "```python",
    "def validate_title(title):",
    ...(revising ? ['    """Validate a note title."""'] : []),
    "    if not title:",
    "        return None",
    revising ? "    return title.strip()" : "    return title",
    "```",
    "CHECK: validate_title accepts a real title and declines an empty one",
    "```python",
    "from validation import validate_title",
    "",
    "",
    "def __vg_check__():",
    revising
      ? '    assert validate_title(" hello ") == "hello"'
      : '    assert validate_title("hello") == "hello"',
    '    assert validate_title("") is None',
    "```",
  ].join("\n"));
}
return "";
}

if (!maybeServeStreamJson(replyFor)) {
  const prompt = process.argv[process.argv.length - 1] ?? "";
  process.stdout.write(JSON.stringify({ result: replyFor(prompt), is_error: false, session_id: "fake-modify" }));
  process.exit(0);
}
