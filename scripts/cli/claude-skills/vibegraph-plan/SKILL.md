---
name: vibegraph-plan
description: Plan work in a project VibeGraph knows (a .vibegraph/ folder, or its hooks are installed) — map a change onto the threads that own it, or design a new project or feature as a HYPOTHETICAL plan (objective, processes, stack, data boundaries, primary threads, rules) kept apart from the code and checked against it as it is built. Use before a multi-file change, a new feature, or a greenfield design.
---

# Planning with VibeGraph

Deterministic, no tokens: `vibegraph-knowledge …` (or `npx --yes vibegraph-knowledge@latest …`).

## A change to existing code

1. `vibegraph-knowledge export --task "<task, naming files or functions>"`,
   then read `.vibegraph/knowledge/plan.md`: the owning threads, dependencies
   first, each packet's files and closing bar. If it says the task names no
   code, find names in `threads/INDEX.md` and run it again.
2. `vibegraph-knowledge brief <entry id>` per owner. Its "Leaves the project
   through", "Round trips inside loops" and "Cross-thread" lines are the
   blast radius.
3. Keep `constraints.md` and `system_spec.md` true; `architecture.md` says
   which deploy group each thread runs in. `vibegraph-knowledge affected
   <files>` names the tests to run.

## A design: the hypothetical plan

A plan (`.vibegraph/plan.json`) is NOT the code: small on purpose (capped),
every item PROPOSED until a person agrees.

- Read it: `vibegraph-knowledge plan show` (the hooks also send it).
- Propose with the `vibegraph_plan_edit` MCP tool, or
  `vibegraph-knowledge plan edit --as agent '<op>'`. Sections: processes
  (`at` = where the code will live), stack, boundaries (`carries` = key
  names), threads (PRIMARY steps only), policies (text + why + optional
  check), open (questions). Each process and thread says which part of the
  objective it `serves`; if nothing does, it does not belong.
- Never agree, promote or close: the person does (`plan agree`, `plan
  promote`, the Plan panel).
- Building on a specific tool? Its ratified spec (`vibegraph-knowledge
  software show <tool>`) holds its operations, states and rules, each quoted
  from its docs; `software plan <tool>` puts its rules into the plan. With no
  spec, ask the user to run `software add <tool> --from <docs>`.
- While building, `vibegraph-knowledge plan check` shows each item realised,
  drifted or not built. Report drift; propose a plan change rather than
  quietly building something else. A planned rule is advice until promoted.

Never conclude code is unused from silence: `vibegraph-knowledge coverage <file>`.
