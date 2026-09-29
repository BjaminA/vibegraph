---
name: vibegraph-review
description: Review a change (uncommitted work, a branch or a PR) in a project VibeGraph has analysed (a .vibegraph/ folder, or the vibegraph-knowledge hooks are installed) — which threads it touches, whether every stated rule still holds, which tests reach it, and whether it added a new boundary, dependency or unguarded input. Use before committing, when asked to review a diff, or at the end of a task.
---

# Reviewing a change with VibeGraph

Commands are deterministic and spend no tokens: `vibegraph-knowledge …` (or
`npx --yes vibegraph-knowledge@latest …`). `--uncommitted` means the working
tree against HEAD; pass file paths for a branch diff (`git diff --name-only main...`).

1. **Rules.** `vibegraph-knowledge check --uncommitted`. Exit 0 = every rule
   passed; 1 = a rule is VIOLATED, offender named as `file:node`; 2 = a rule
   could not be verified. Report a 2 as unverified, never as passing.
2. **Tests.** `vibegraph-knowledge affected --uncommitted` lists the tests
   that reach the changed files. Run them. A changed file no test reaches is a
   finding; `coverage <file>` says what reaches it and whether it parsed fully.
3. **What the change reaches.** For each touched thread,
   `vibegraph-knowledge brief <entry id>`: did the change add a boundary
   ("Leaves the project through"), a round trip inside a loop, or a new
   dependency? `system_spec.md` says which tools the project already uses and
   which a stack policy forbids.
4. **Input safety.** `vibegraph-knowledge dataflow` — a new UNGUARDED finding
   in a touched file is a blocker to raise.
5. **Refresh.** Re-run `vibegraph-knowledge export` after a large change so the
   knowledge folder matches the code.

Judge the code, not the self-report: the checks above are facts, a worker's
summary is not. Do not call anything dead or unused from silence — check
`coverage` first.
