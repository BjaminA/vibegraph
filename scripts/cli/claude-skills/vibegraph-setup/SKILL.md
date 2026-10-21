---
name: vibegraph-setup
description: Set a project up with VibeGraph end to end, one step at a time — software specs for the bespoke tools it builds on, the architecture groups and the Brief, the rules, the hooks, then a plan for what comes next — with a person taking every decision. Use when someone asks to initialise, set up or onboard a project with VibeGraph, or to give Claude a working map of the codebase.
---

# Setting a project up, with VibeGraph

You propose and run; a person decides.

1. **Read where it stands.** `vibegraph-knowledge setup`: the steps in order, which
   are done, and the exact commands for the next one, printed as they should be run.
   `you:` is a person's step, `Claude may:` is yours, `(spends tokens)` costs a model
   call. If it opens with a note that skills are out of date, run the refresh it
   names first, then read this skill again.
2. **Run what costs nothing.** Zero-token commands (`constraints harvest`,
   `direction project census`, `brief codebase --estimate`, `software show`) need no
   permission, including the ones `setup` lists under a later step: a proposal it
   says is stale is re-read before anyone is asked to decide it.
3. **Ask once before spending.** Before the first step that spends tokens, list every
   such step still ahead — `classify --apply`, `software add` per tool, `brief codebase`
   (twice: groups, then the Brief), `constraints draft` or `/vibegraph-rules` — and
   wait for a yes. A model step takes minutes: run each in the FOREGROUND with the
   longest timeout (600000 ms), one at a time, and wait for it. Never send one to the
   background and never end your turn while one runs — a headless session ends there
   and the work is lost.
4. **Never take a person's step.** Ratify, agree, adopt, promote, `init --hooks`: give
   the person the command or the panel (Rules, Direction, the Brief card on the map),
   say what you recommend, and stop. The CLI refuses them from Claude Code anyway.
5. **Docs for a spec.** The suggested `--from` is a start. An official docs page you know
   (the overview, plus the page for the API this project calls) is better; two `--from`
   are fine. A package used in an ordinary way: `vibegraph-knowledge setup skip software
   <name> --why "…"`.
6. **Loop.** After each step run `vibegraph-knowledge setup` again. When every step is
   done, say so, and suggest `vibegraph-knowledge hook log` after the next session.
7. **Then the plan, only when there is something to build next.** Offer it once,
   after the setup; do not push it. Starting it is the person's step (`plan observe`, `plan init`, or the Plan panel), and `plan draft
   --direction` spends tokens and needs its own yes. Keep it concrete: the objective is
   one line (what it does, for whom, built on what), and a principle must be able to be
   wrong: it names a module, a tool, a spec's rule or a data shape, with a check when
   one fits. Push back on "state of the art".
