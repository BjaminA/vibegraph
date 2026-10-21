---
name: vibegraph-rules
description: Turn the operators' rules that live in a project's prose — CLAUDE.md, AGENTS.md, READMEs, docs, module headers, docstrings — into stated VibeGraph constraints a person ratifies, so the hooks deliver them per thread and `check` verifies the checkable ones. Use when a project VibeGraph has analysed has few or no stated rules, or its documentation states rules its `.vibegraph/constraints.json` does not.
---

# Rules from the prose, with VibeGraph

Commands are deterministic and spend no tokens: `vibegraph-knowledge …` (or
`npx --yes vibegraph-knowledge@latest …`). You read; a person decides.

1. **List the candidates.** `vibegraph-knowledge constraints harvest`: rule-shaped
   sentences that name code the IR knows, ranked, each with its `file:line`, a
   suggested `scope:` and sometimes `try: --check …`. A place to read, not a
   rule. `--min 3` widens it, `--all` lists every match.
2. **Read each in its context** (open the file at the line). Keep what the code
   cannot reveal and someone decided: a path every call must take, a column order
   a reader depends on, a thing never sent or stored, a deploy fact. Drop
   behaviour ("returns null when unseen"), history ("was fixed in"), and what is
   already stated (`vibegraph-knowledge constraints list`).
3. **State each real one, citing its sentence:**
   `vibegraph-knowledge constraints add --as agent --kind <invariant|proxy|payload-schema|backend-call|perf-lever|objective> --text "<the rule, one line, with its reason>" <scope> --cite <file>:<line> --quote "<the whole sentence, verbatim>"`
   - `--as agent` always: you are a model; it waits for a person to ratify;
   - the quote must be in that file near that line, or the add is refused;
   - `<scope>`: the candidate's `scope:` line (`--files` / `--tools` / `--threads`)
     — what the rule GOVERNS, not where the sentence sits; change it only from
     what you read;
   - the reason in `--text` when the source gives one, else "reason not stated in <file>";
   - add the candidate's `try: --check …` with `--dry-run` first (UNVERIFIABLE is refused).
4. **Report** what you stated (ids), what you dropped and why, and sentences that
   looked like rules but name nothing the IR knows — those are for a person.
