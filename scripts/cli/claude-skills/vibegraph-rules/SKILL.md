---
name: vibegraph-rules
description: Turn the operators' rules that live in a project's prose — CLAUDE.md, AGENTS.md, READMEs, docs, module headers ("why this exists"), docstrings — into stated VibeGraph constraints a person ratifies, so the hooks deliver them per thread and `check` verifies the checkable ones. Use when a project VibeGraph has analysed has few or no stated rules, or when its documentation states rules its `.vibegraph/constraints.json` does not.
---

# Rules from the prose, with VibeGraph

Commands are deterministic and spend no tokens: `vibegraph-knowledge …` (or
`npx --yes vibegraph-knowledge@latest …`). You read; a person decides.

1. **List the candidates.** `vibegraph-knowledge constraints harvest`: rule-shaped
   sentences (must, never, only, "the one", "leaves through" …) that name a file,
   function, tool, route or environment variable the IR knows, ranked, each with
   its `file:line`. It is a place to read, not a rule. `--min 3` widens it,
   `--all` lists every match.
2. **Read each in its context** (open the file at the line). Keep only what the
   code cannot reveal and someone decided: a path every call must take, a column
   order a downstream reader depends on, a thing that must never be sent or
   stored, a deploy fact. Drop descriptions of behaviour ("returns null when
   unseen"), history ("was fixed in"), and anything already stated
   (`vibegraph-knowledge constraints list`).
3. **State each real one, citing its sentence:**
   `vibegraph-knowledge constraints add --as agent --kind <invariant|proxy|payload-schema|backend-call|perf-lever|objective> --text "<the rule, one line, with its reason>" --files <paths the anchors name> --cite <file>:<line> --quote "<the whole sentence, verbatim>"`
   - `--as agent` always: you are a model stating a rule; it lands **agent-stated** and waits in the
     Rules panel / Inbox for a person to ratify or remove (never state as a person);
   - the quote must be in that file near that line or the add is refused; quote the whole sentence;
   - scope from what the sentence names (`--files`, `--tools`, `--threads`), `--all` only for a project-wide rule;
   - `stack-policy` needs `--policy '{"tool":…,"rule":"forbid|require|prefer|replace-with"}'`; otherwise use `invariant`;
   - a check only when the grammar fits (`--check '{"rule":"import-only","tool":…,"files":[…]}'`,
     `callers-only`, `calls-through`, `payload-keys`): `--dry-run` first — UNVERIFIABLE is refused, which is right.
4. **Report** what you stated (ids), what you dropped and why, and sentences that
   looked like rules but name nothing the IR knows — those are for a person.
