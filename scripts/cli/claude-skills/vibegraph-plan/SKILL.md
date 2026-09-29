---
name: vibegraph-plan
description: Plan a change in a project VibeGraph has analysed (a .vibegraph/ folder, or the vibegraph-knowledge hooks are installed) — which threads own the task, in what order to touch them, which stated rules and tools constrain it, and what closing bar a review will hold it to. Use before a multi-file feature, a refactor, or any change whose blast radius is unclear.
---

# Planning with VibeGraph

The hooks have already given you the contracts, rules and skills of the
threads your prompt named. This skill is for what they do not do: map a task
that is not yet pinned to code. Every command is deterministic, spends no
tokens, and is run as `vibegraph-knowledge …` (or `npx --yes vibegraph-knowledge@latest …`).

1. **Map the task.** `vibegraph-knowledge export --task "<the task, naming the
   files or functions you expect it to touch>"`, then read
   `.vibegraph/knowledge/plan.md`: the owning threads, dependencies first, each
   packet's files, its escalation surface (what lies outside the plan) and its
   closing bar. If it says the task names no code, find the names in
   `threads/INDEX.md` and run it again — do not plan from an empty plan.
2. **Read the owners, not the whole tree.** `vibegraph-knowledge brief <entry
   id>` gives one thread's contract and the verbatim source of its primary
   functions. The contract's "Leaves the project through", "Round trips inside loops" and
   "Cross-thread" lines are the blast radius.
3. **Respect what is stated.** `constraints.md` (rules, with reasons) and
   `system_spec.md` (the stack: build with the tools already there; a stack
   policy says which are forbidden or preferred). Plan around a rule; if the
   task needs one broken, say so to the user before starting.
4. **Place it.** `architecture.md` says which process and deploy group each
   thread runs in; a change that crosses a group crosses a trust or deploy
   boundary — plan both sides. `flows.md` shows hops between languages.
5. **Plan the proof.** `vibegraph-knowledge affected <files>` lists the tests
   that reach the files you will change; the contract's "Tested by" line says
   how directly. A packet no test reaches needs a test in the plan.

Never conclude code is unused or safe to delete from its absence in these
files: `vibegraph-knowledge coverage <file>` first.
