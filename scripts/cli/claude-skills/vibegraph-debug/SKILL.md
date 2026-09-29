---
name: vibegraph-debug
description: Debug a failure in a project VibeGraph has analysed (a .vibegraph/ folder, or the vibegraph-knowledge hooks are installed) — find the entry point a symptom starts from, walk its thread across files and languages to where it leaves the project, see which tests reach the suspect code, and where static knowledge ends. Use when a route, script, page or test misbehaves and the cause is not in the file you are looking at.
---

# Debugging with VibeGraph

A thread is everything one entry point (route, CLI, script, page, MCP tool,
test) calls, traced statically across files. Commands are deterministic and
spend no tokens: `vibegraph-knowledge …` (or `npx --yes vibegraph-knowledge@latest …`).

1. **Find where the symptom starts.** `.vibegraph/knowledge/threads/INDEX.md`
   lists every entry point; `flows.md` follows a request from the page that
   sends it through the route, script or tool that serves it (a hop between
   languages is a crossing — its reverse index answers "who calls this
   script?").
2. **Walk it.** `vibegraph-knowledge brief <entry id>`: the contract plus the
   source of the primary path, in call order. Read "Leaves the project
   through" (every DB, HTTP, file and subprocess call, with its literal text)
   and "Round trips inside loops" first — most runtime failures live there.
3. **Know where the map stops.** The contract's "Where static knowledge ends"
   counts `dynamic` (runtime dispatch — the target is decided while running)
   and `unresolved` (a gap in resolution). A bug past one of these is not in
   the thread; do not assume the thread is complete. `Configured by` names the
   environment variables the path reads — a missing one is a common cause.
4. **Reproduce with the right tests.** `vibegraph-knowledge affected <file>`
   lists the tests that reach the suspect file; `coverage <file>` says whether
   it parsed fully and what reaches it. A partly parsed file has a partial map.
5. **After the fix**, `vibegraph-knowledge check --uncommitted` (exit 2 means
   a rule could not be verified — that is not a pass).

If the fix breaks a stated rule, the post-edit hook blocks with the rule and
its reason: fix the code, never the check.
