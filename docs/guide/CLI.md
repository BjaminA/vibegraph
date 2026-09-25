# The node commands: `vibegraph-knowledge`

`vibegraph-knowledge` (also installed as `vgk`) writes what VibeGraph derives
from your code, and what you and your team have stated about it, into
`.vibegraph/knowledge/` — plain files a Claude Code session reads before it
edits. It also verifies your stated rules against the code. It needs no
browser, no server, and — apart from three clearly marked commands — no
model calls.

Why it exists: in measured head-to-head runs, a plain Claude session that
could read the project's **stated rules** wrote code that kept them, and one
that could not broke them — while scoring the same on the task itself. The
rules are not in the code; this puts them, and the map of the code, where
Claude looks.

Install it first: [SETUP.md §4](SETUP.md#4-point-it-at-your-own-codebase).

---

## Quick start

```bash
cd /path/to/your/project
vibegraph-knowledge init          # one marked block in CLAUDE.md pointing at the folder, + .gitignore line
vibegraph-knowledge export        # parse, derive, write .vibegraph/knowledge/
```

Open a Claude Code session in the project as usual. `CLAUDE.md` now tells it
to read `.vibegraph/knowledge/README.md` first, and the README gives the
reading order.

Then add what only your team knows:

```bash
vibegraph-knowledge constraints add --kind invariant --all \
  --text "Every outbound HTTP call goes through lib/http_client.py: it routes via the egress proxy and attaches the service token."
vibegraph-knowledge export        # re-export whenever the rules or the code change
```

## Every command

Every command takes the project root as a positional argument (it can come
last; the default is the current directory). Exit code 0 is success, 1 means
something was found or refused (the output says what), 2 is bad usage, 3 means
a model could not be run.

### `init` — point Claude at the knowledge

```bash
vibegraph-knowledge init [<root>] [--print]
```

Writes one marked block into the project's `CLAUDE.md` (replaced on re-run,
never duplicated) and adds `.vibegraph/knowledge/` to `.gitignore`.
`--print` shows the block without writing. Zero tokens.

### `export` — write the knowledge folder

```bash
vibegraph-knowledge export [<root>] [--task "<text>"] [--with-ir] [--architecture] [--archify] [--out <dir>]
```

Parses the project and writes `.vibegraph/knowledge/`. Zero tokens. By
default it writes **prose** — what a reader actually opens:

| File | Contents |
|---|---|
| `README.md` | the index and reading order; what was skipped, what could not be parsed |
| `constraints.md` | the stated rules, with their reasons and provenance |
| `architecture.md` | the whole system on one page: the start-here story, the system in a dozen arrows, where each process runs, what each calls and hops to (with the protocol and why), what crosses each edge, trust crossings, subsystems, which threads drive which, what the map leaves out |
| `threads/INDEX.md`, `threads/<entry>.md` | one **contract** per thread: data in and out, every external call with its literal text and the tool it leaves through, round trips inside loops, neighbouring threads, the rules routed to it |
| `flows.md` | end-to-end chains from a page to the script it runs, and a reverse index |
| `system_spec.md` | the tools the project is built on, the modules that wrap them, the policies stated about them |
| `skills/<entry>.md` | ratified, fresh thread skills (drafts and stale ones are withheld and named) |
| `observations.json` | what consented trace runs saw, when there are any |

Options:

- `--task "<text>"` also writes `plan.md` / `plan.json`: the task mapped onto
  the threads that own it, dependencies first, with each packet's files and
  what a review would check. Matching is lexical — **name the code** (files,
  backticked symbols); a task that names none says so.
- `--architecture` also writes `architecture.vibegraph.json` (the map as data:
  every record with its provenance, each lens as the ids it selects, the
  hierarchy, subsystems, thread graph; schema in
  `schemas/system_map.schema.json`) and `architecture.html` (the map for
  people, self-contained, every lens a toggle).
- `--archify` also writes `architecture.archify.json` in
  [Archify](https://github.com/tt-a1i/archify)'s schema.
- `--with-ir` also writes the raw forms: per-file IR, the envelope, stack,
  crossings, the quality profile.
- `--out <dir>` writes elsewhere (the directory must be empty or a previous
  export).

### `check` — verify the stated rules against the code

```bash
vibegraph-knowledge check [<root>] [--uncommitted | --git <range>] [--json]
```

Runs the machine-checkable half of every stated rule. Each clause reads
**PASS** (with what it could not follow), **VIOLATED** (naming the file and
the call), or **UNVERIFIABLE** — which is never counted as a pass. Exit 0 all
passed · 1 something violated · 2 nothing violated but something
unverifiable. `--uncommitted` treats your working-tree changes as the delta
(what a pre-commit hook has); `--git <range>` uses a commit range. Zero
tokens. A good pre-commit or CI step.

### `constraints` — the rules the code cannot show

```bash
vibegraph-knowledge constraints list [<root>] [--json]
vibegraph-knowledge constraints add [<root>] --kind <kind> --text "<rule and its reason>" <scope> [--note "…"] [--check '<json>'] [--policy '<json>']
vibegraph-knowledge constraints add [<root>] --json '<whole constraint>'
vibegraph-knowledge constraints remove <id> [<root>]
vibegraph-knowledge constraints ratify <id> [<root>]
```

- **kind**: `payload-schema`, `proxy`, `backend-call`, `perf-lever`,
  `invariant`, `objective`, `stack-policy`.
- **scope** — which threads the rule is routed to: `--all`,
  `--threads <entry ids>`, `--files <paths>`, or `--tools <tool names>`
  (comma-separated).
- **`--check`** makes the rule verifiable, e.g.
  `'{"rule":"import-only","tool":"requests","files":["lib/http_client.py"]}'`
  or `'{"rule":"callers-only","target":"charge","files":["api/checkout.py"]}'`
  (only `api/checkout.py` may call `charge`), or
  `'{"rule":"calls-through","target":"notify","through":"should_notify"}'`
  (every function that calls `notify` also calls `should_notify`). Targets
  are function names.
  Rules: `callers-only`, `import-only`, `calls-through`, `guards`,
  `not-in-loop`, `handles-failure`, `annotated`, `co-changes`.
- **`--policy`** (for `stack-policy`) states a decision about a tool:
  `'{"tool":"requests","rule":"replace-with","with":"lib.http_client"}'`
  — rules `require`, `prefer`, `forbid`, `replace-with`, `describe`.

`add` records the rule as **human-stated** (you ran the command). A rule that
restates an existing one is refused as a duplicate; a malformed check is
refused rather than stored looking enforced. `ratify` turns a rule a model
stated (e.g. by `classify --apply`) into a human-stated one. Zero tokens.

Write the **why** into the text. "Region changes page the on-call once per
device per hour — a flapping sensor once paged forty times in a minute" is
what lets the next reader handle a case the rule did not foresee.

### `seeds` — entry points discovery cannot see

```bash
vibegraph-knowledge seeds list [<root>]
vibegraph-knowledge seeds add <file>[:<function|Class>] [<root>] [--note "<why>"]
vibegraph-knowledge seeds remove <file>[:<function|Class>] [<root>]
```

For code that is really an entry point but is not found as one: a helper a
scheduler calls, a script a cron line outside the repo runs. A bare `<file>`
names the file's top level. The seed is resolved against the parsed project
before it is written, and refused if it would not become a thread. Each seed
becomes a thread — and a contract — on the next export. Zero tokens.

### `skills` — per-thread guidance

```bash
vibegraph-knowledge skills list [<root>]
vibegraph-knowledge skills draft <entry id>... | --missing [<root>] [--dry-run] [--reply <file>] [--model <id>]
vibegraph-knowledge skills ratify <entry id> [<root>]
vibegraph-knowledge skills reaffirm <entry id> [<root>]
vibegraph-knowledge skills auto-reaffirm <entry id> on|off [<root>]
```

A thread skill is a short document for one thread — purpose, architecture,
steps (citing IR node ids), gotchas, and the rules routed to it *with their
reasons*.

- `list` — every thread and its skill: none, draft, ratified and fresh, or
  stale.
- `draft` — **spends tokens**: one model call per skill (plus one retry if it
  cites a node id that does not exist). The draft must cite at least one real
  node and none invented, and have its four sections, or it is not written.
  It is always a **draft**; the export withholds drafts. `--missing` drafts
  every thread without one. `--dry-run` prints the prompt only.
- `ratify` — you have read it; the next export copies it.
- `reaffirm` — the code or its rules changed, but the skill is still right:
  re-stamp it. `auto-reaffirm on` keeps a ratified skill exported across
  changes, with a caveat attached.

### `architecture` — the system map, and the groups the code cannot show

```bash
vibegraph-knowledge architecture [<root>] [--out <dir>] [--archify]
vibegraph-knowledge architecture [<root>] --propose            # spends tokens
vibegraph-knowledge architecture [<root>] --modify "<what should change>"   # spends tokens
vibegraph-knowledge architecture [<root>] --ratify | --reject
```

Without a flag: writes `architecture.md`, `architecture.vibegraph.json`,
`architecture.html` and `architecture.json` into
`.vibegraph/architecture-map/`. Zero tokens.

`--propose` asks a model for deployment and trust **groups** (hosts,
networks, trust zones), names, and a start-here path. It sees the derived
map, your deployment files read line by line (docker-compose, Dockerfile,
Kubernetes, Terraform, pm2, Procfile, systemd, `.env.example` — never `.env`)
and doc lines. Every item must cite something it was shown; a citation it
was not shown is dropped, and an uncited item is kept but marked *INFERRED*.
The proposal is stored **pending**; `--ratify` makes it stated (whoever runs
the command is the human), `--reject` drops it, `--modify` re-drafts with your
words.

### `classify` — tools no table knows

```bash
vibegraph-knowledge classify [<root>] [--apply] [--dry-run] [--model <id>]
```

**Spends tokens.** For every third-party tool whose role VibeGraph's tables do
not know, it builds a dossier from how the code uses it and asks a model for
its role (database, queue, model API, platform…). `--apply` stores each answer
as an **agent-stated** policy, labelled *NOT human-reviewed* wherever it shows;
`constraints ratify <id>` makes one yours. A role you state yourself always
wins.

## A workflow for a team

```bash
# once
vibegraph-knowledge init
vibegraph-knowledge architecture --propose        # review what it cites…
vibegraph-knowledge architecture --ratify         # …then make it stated
vibegraph-knowledge constraints add …             # the rules everyone knows and the code does not say
vibegraph-knowledge seeds add scripts/nightly.sh  # anything run from outside the repo

# per area of work
vibegraph-knowledge skills draft <entry id>       # read it
vibegraph-knowledge skills ratify <entry id>

# every time the code or the rules move (or in a hook)
vibegraph-knowledge export
vibegraph-knowledge check --uncommitted           # before committing
```

Commit `.vibegraph/constraints.json`, `.vibegraph/architecture.json` and
`.vibegraph/manual_seeds.json` so the whole team — and every Claude session —
shares them. Leave `.vibegraph/knowledge/` uncommitted: it is regenerated.

## What costs tokens

Only `classify`, `architecture --propose` / `--modify`, and `skills draft`.
Each says so in `--help`, uses your `claude` CLI (or `VG_CLAUDE_BIN`), runs
with no MCP servers and no write tools, and stores what it produced as a
model's work until you ratify it. Everything else is deterministic.

## Settings

`VG_PYTHON` (the interpreter), `VIBEGRAPH_PYDEPS` (a directory already holding
`libcst`), `VIBEGRAPH_KNOWLEDGE_HOME` (where `libcst` is installed when
missing, default `~/.cache/vibegraph-knowledge`), `VG_CLAUDE_BIN` (the model
command). See [SETUP.md §6](SETUP.md#6-settings).
