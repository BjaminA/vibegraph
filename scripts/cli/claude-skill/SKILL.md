---
name: vibegraph
description: Set up and use VibeGraph (the vibegraph-knowledge npm package) in the current project — install the Claude Code hooks that route each prompt to the code threads it touches and re-check the team's stated rules after every edit, write the knowledge folder, state rules with their reasons, and verify changes before finishing. Use when the user asks to set up VibeGraph, to enforce or state codebase rules/constraints, to understand how the codebase is wired (threads, entry points, what calls what, what leaves the project), or when a VibeGraph hook has blocked an edit.
---

# VibeGraph in a plain Claude Code session

VibeGraph parses the project (Python, TypeScript, bash, C++, Rust) into an IR,
traces a **thread** forward from every entry point (route, CLI, script, test,
page, MCP tool), and checks the team's **stated rules** against that IR. Every
command below is deterministic and spends no tokens unless it says so.

Run it as `vibegraph-knowledge …` if that is on PATH, otherwise
`npx --yes vibegraph-knowledge@latest …`. It needs Node ≥ 20 and Python 3; the
first run installs `libcst` into `~/.cache/vibegraph-knowledge` by itself.

## Set up (once per project)

1. `vibegraph-knowledge init --hooks` in the project root. This writes:
   - four hooks into `.claude/settings.local.json` (per user, never
     committed): each session starts with an orientation (the project, every
     stated rule, the skills), re-sent after a compaction; each prompt gets
     the contracts, rules and approved skills of the threads it names; each
     edit — including edits made through Bash — and
     the end of each turn re-check every stated rule, and a **new** violation
     stops the edit with the rule, its reason and the offending call;
   - a marked block in `CLAUDE.md` pointing at the knowledge folder, and a
     `.gitignore` line for it.
2. `vibegraph-knowledge export` — writes `.vibegraph/knowledge/` (start at its
   `README.md`: architecture, one contract per thread, the rules, flows,
   reachability, configuration).
3. Tell the user: **the hooks take effect in the next Claude Code session**
   (Claude Code reads hook settings when a session starts; they can also
   review them with `/hooks`). Nothing is enforced in the session that
   installed them. In the next session, `vibegraph-knowledge doctor` says
   whether they have fired; `vibegraph-knowledge hook run prompt --prompt
   "<text>"` (or `hook run post-edit --file <path>`) fires one by hand, the
   payload built for you, with the hook's own exit codes.

If this Claude Code runs on **Windows** and the project lives in WSL
(`\wsl.localhost\…`), the hooks must be installed from the WSL shell with
`--windows` (`vibegraph-knowledge init --hooks --windows`, or `hook install
--target wsl` for the hooks alone; CLI installed with
`npm install -g`, not npx): each hook is then a `wsl.exe` command any Windows
shell can run. Without it, hooks installed from WSL hold Linux paths a Windows
session cannot run — run the checks by hand (`check`) instead.

To remove: `vibegraph-knowledge init --remove-hooks` (takes out exactly these
four entries).

## Stating the rules the code cannot show

Ask the user for the two or three rules everyone on the team knows and the
code does not say, **with the reason** — the reason is what lets the next
change handle a case the rule did not foresee. Record each one:

```bash
vibegraph-knowledge constraints add --kind invariant --files telemetry/ \
  --text "Operators are paged only through alerts.notify after should_notify's 5-minute dedup — a flapping sensor once paged forty times a minute." \
  --check '{"rule":"calls-through","target":"notify","through":"should_notify"}'
```

Add a `--check` whenever the rule can be checked, so the hooks can enforce it:
`callers-only`, `import-only`, `calls-through`, `guards`, `not-in-loop`,
`payload-keys` (e.g. `{"rule":"payload-keys","target":"requests.post","require":["json.region"],"forbid":["json.password"]}`),
`handles-failure`, `annotated`, `co-changes`. The `files` of `import-only` /
`callers-only` take folders (`src/db/`) and globs (`packages/*/src/**`), and
`"allowTests": true` lets tests through, so the rule does not go stale as files
are added. A rule without a check is still
delivered to every session that touches its threads, but only a reader
enforces it. `vibegraph-knowledge constraints list` shows what is stated.

## While working

- **A hook blocked your edit:** it names the rule, the reason people gave, and
  the call that breaks it. Fix the code so the rule holds. Do not remove the
  hooks, edit `.vibegraph/`, or route around the check. A block is only for
  what THIS edit introduced; earlier violations are listed once and re-checked
  at the end of the turn. If the rule itself looks wrong or too tight for this
  change, propose the change and ask the user to accept it:
  `vibegraph-knowledge constraint propose <id> --check '<clause>' --why
  "<reason>"` (stored, never applied; `constraint show <id>` shows it).
- **For a plan, a bug, a security review or a code review**, the task skills
  `/vibegraph-plan`, `/vibegraph-debug`, `/vibegraph-security` and
  `/vibegraph-review` say which knowledge file and command to open (installed
  by `init --skill`). `vibegraph-knowledge dataflow` lists where untrusted
  input reaches a shell, SQL text or eval.
- **Designing something new:** `vibegraph-knowledge plan init "<objective>"`
  starts a HYPOTHETICAL plan (`.vibegraph/plan.json`) — processes, stack,
  data boundaries, primary threads, rules — kept apart from the code and
  checked against it with `plan check`. You propose (`vibegraph_plan_edit`);
  the user agrees. `/vibegraph-plan` has the details.
- **Building on a specific tool** (a platform SDK, a database, an API):
  `vibegraph-knowledge software add <tool> --from <its docs url or file>`
  drafts a spec from its documents — every item quoting them — which the user
  ratifies; after that, plans, hooks and checks build with it in mind. To
  change one, use `software edit` / `software rule …` / `software unknown …`
  (quotes re-checked) — never the JSON by hand.
- **Some steps are the user's, not yours:** agreeing, promoting, ratifying,
  setting the objective, removing the hooks. The CLI refuses them when you run
  it; tell the user the command and let them run it.
- **Before finishing:** `vibegraph-knowledge check --uncommitted` — exit 0
  every rule passed; 1 a rule is VIOLATED (the offender is named as
  `file:node`); 2 a rule could not be verified, which is **not** a pass.
  `vibegraph-knowledge affected --uncommitted` lists the discovered tests to
  run for your changes.
- **Never** call code unused, dead, untested or unconfigured because the
  knowledge folder does not mention it. Check first:
  `vibegraph-knowledge coverage <file>…` says whether a file was fully parsed,
  what reaches and tests it, and why any function is on no thread.
- After larger changes, re-run `vibegraph-knowledge export`; the folder goes
  stale as you edit.
- `vibegraph-knowledge lessons list` shows rules sessions broke and put right.
  A rule broken repeatedly is worth a thread skill that carries its reason:
  `skills draft <entry>` reads those lessons (it spends tokens; a person
  ratifies the draft).

## Other commands

- `vibegraph-knowledge view` — the visualisation (architecture map, threads,
  code) at http://localhost:4200.
- `vibegraph-knowledge seed add <file>[:<function>]` — name an entry point
  discovery cannot see (package.json bins/scripts and files that listen, read
  argv or await at the top level are found already).
- `vibegraph-knowledge doctor` — are the hooks installed, runnable from here,
  and firing?
- `vibegraph-knowledge skills draft <entry>` — **spends tokens**: drafts
  per-thread guidance for a person to ratify (`skills ratify`).
- `vibegraph-knowledge --help` — everything else.
