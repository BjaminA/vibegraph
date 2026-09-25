# The node commands: `vibegraph-knowledge`

`vibegraph-knowledge` (also installed as `vgk`) writes what VibeGraph derives
from your code, and what you and your team have stated about it, into
`.vibegraph/knowledge/` — plain files a Claude Code session reads before it
edits. It also verifies your stated rules against the code. These commands
need no browser, no server, and — apart from three clearly marked ones — no
model calls. The same package also runs the **visualisation**:
`vibegraph-knowledge view <project>` (see [`view`](#view--the-visualisation)).

Why it exists: in measured head-to-head runs, a plain Claude session that
could read the project's **stated rules** wrote code that kept them, and one
that could not broke them — while scoring the same on the task itself. The
rules are not in the code; this puts them, and the map of the code, where
Claude looks.

Install it (Node 20+ and Python 3.10+ on your PATH):

```bash
npm install -g vibegraph-knowledge       # or: npx vibegraph-knowledge <command>
```

More in [SETUP.md §2](SETUP.md#2-the-node-commands--install-from-npm).

---

## Reference

### Every command

`vibegraph-knowledge <command> [<project>]` — the project defaults to the
current directory. **Tokens** means the command asks a model (your `claude`
CLI) and says so; everything else is deterministic.

| Command | What it does | What it writes | Tokens |
|---|---|---|---|
| `view [<path>] [--port n] [--open]` | Starts the visualisation — the web app at `http://localhost:4200` — until Ctrl-C | `.vibegraph/` state, as you use the app | only the app's Claude features |
| `init [--print]` | Points Claude Code at the knowledge folder | a marked block in `CLAUDE.md`; a line in `.gitignore` | — |
| `export` | Derives everything from the code and writes it for Claude | `.vibegraph/knowledge/` (see the files table) | — |
| `export --task "<text>"` | …plus the task mapped onto the threads that own it, dependencies first | `plan.md`, `plan.json` | — |
| `export --architecture` | …plus the system map as data and as a picture | `architecture.vibegraph.json`, `architecture.html` | — |
| `export --with-ir` | …plus the raw derived forms | `ir/`, `envelope.json`, `stack.json`, `crossings.json`, `architecture.json`, `quality/` | — |
| `export --archify` | …plus the map in Archify's schema | `architecture.archify.json` | — |
| `check [--uncommitted \| --git <range>]` | Verifies every stated rule's checkable half against the code: PASS / VIOLATED (names the call) / UNVERIFIABLE | nothing | — |
| `constraints list [--json]` | Shows the stated rules, who stated them, their scope and checks | nothing | — |
| `constraints add …` | States a rule (human), refusing duplicates and malformed checks | `.vibegraph/constraints.json` | — |
| `constraints remove <id>` / `ratify <id>` | Deletes a rule / makes a model-stated rule human-stated | `.vibegraph/constraints.json` | — |
| `seeds list` | Shows the entry points you named, and whether each resolves | nothing | — |
| `seeds add <file>[:<fn>]` / `remove …` | Names an entry point discovery cannot see (checked before it is saved) | `.vibegraph/manual_seeds.json` | — |
| `skills list` | Every thread and its skill: none / draft / ratified and fresh / stale | nothing | — |
| `skills draft <entry>… \| --missing` | Drafts per-thread guidance through VibeGraph's grounding gates; saved as a draft | `.vibegraph/thread-skills/` | **yes** |
| `skills ratify` / `reaffirm` / `auto-reaffirm` | Approves a draft / re-stamps a still-correct stale skill / keeps one exported across changes | `.vibegraph/thread-skills/` | — |
| `architecture` | Writes the system map | `.vibegraph/architecture-map/` | — |
| `architecture --propose` / `--modify "<text>"` | Asks for deployment / trust groups, names and a start-here path, every item citing what it saw; stored pending | `.vibegraph/architecture.json` (pending) | **yes** |
| `architecture --ratify` / `--reject` | Makes the pending proposal stated / drops it | `.vibegraph/architecture.json` | — |
| `classify [--dry-run \| --apply]` | Asks for the role of tools no table knows; `--apply` stores each as a model-stated policy | `.vibegraph/constraints.json` | **yes** |
| `--version` / `--help` | The version / every command and option | nothing | — |

### Every file VibeGraph makes

All of it lives under `.vibegraph/` in **your** project (plus the `init`
block in `CLAUDE.md`). **Derived** = read from the code, regenerated at will;
**stated** = a person's decision (commit it); **proposed / drafted** = a
model's, until a person ratifies it; **observed** = what a consented run saw.

**For Claude — `.vibegraph/knowledge/`** (`export`; regenerate, don't commit)

| File | Kind | What it holds | Use |
|---|---|---|---|
| `README.md` | derived | the index and reading order; what was skipped or could not be parsed | Claude reads it first |
| `architecture.md` | derived + stated | the whole system on one page: start-here story, the system in a dozen arrows, where each process runs, what each calls and hops to (protocol and why), payloads, trust crossings, subsystems, thread-to-thread links, what the map leaves out | orient before a task that crosses processes |
| `constraints.md` | stated | the rules and their reasons, with who stated each | the requirements the code cannot show |
| `threads/INDEX.md`, `threads/<entry>.md` | derived + stated | one **contract** per thread: data in/out, every external call and the tool it leaves through, round trips in loops, neighbouring threads, rules routed to it | what to keep true when editing that path |
| `flows.md` | derived | end-to-end chains, page → component → call → script, with a reverse index | find everything a change touches downstream |
| `system_spec.md` | derived + stated | the tools the project is built on, by role; the modules that wrap them; policies about them | use the existing tools and wrappers |
| `skills/<entry>.md` | drafted, ratified | per-thread guidance a person approved (drafts and stale ones withheld, named) | how to work on that thread, and why |
| `observations.json` | observed | what consented trace runs saw at each call site | resolve calls static analysis could not |
| `plan.md`, `plan.json` | derived | with `--task`: the task as packets on the threads that own it, dependencies first | order the work |
| `architecture.vibegraph.json`, `architecture.html` | derived + stated | with `--architecture`: the map as data (every lens) and as a picture | tools / people |
| `ir/`, `envelope.json`, `stack.json`, `crossings.json`, `architecture.json`, `quality/` | derived | with `--with-ir`: the raw IR and indexes | tools, audits, your own scripts |

**The system map — `.vibegraph/architecture-map/`** (`architecture`)

| File | What it holds | Use |
|---|---|---|
| `architecture.md` | the map as prose (as above) | read it, or hand it to an agent |
| `architecture.vibegraph.json` | every box, edge and group with its source, each lens (Bird's-eye, Overview, Tools, Flows, Payloads, Trust) as the ids it selects, the hierarchy, subsystems, thread graph — schema `schemas/system_map.schema.json` | query it from scripts or agents |
| `architecture.html` | the map, self-contained, every lens a toggle | open in any browser; share it |
| `architecture.json` | the raw architecture model | tools |
| `architecture.archify.json` | with `--archify`: the model in Archify's schema | Archify |

**State you own — `.vibegraph/`** (commit the first three to share them with your team)

| File | Kind | What it holds | Written by |
|---|---|---|---|
| `constraints.json` | stated | the rules, their reasons, scopes and machine checks; stack policies | `constraints`, `classify --apply`, the app |
| `architecture.json` | stated / proposed | deployment and trust groups, names, the start-here path; a pending proposal | `architecture --propose/--ratify`, the app |
| `manual_seeds.json` | stated | entry points you named | `seeds`, by hand |
| `thread-skills/` | drafted → ratified | per-thread skills with their freshness stamp | `skills`, the app, MCP |
| `observations.json` | observed | trace-run results per call site | the app's Trace / Observe |
| `skills.json` | stated | which generic coding skills are on for this project | the app |
| `models.json` | stated | which model — or local Ollama — runs which kind of work | the app's Models panel |
| `work-run.json`, `work-snapshots/` | runtime | an Agent Manager run's state, and the pre-edit snapshots a reject restores | the app |
| `readmes/`, `VibeReadme.md` | drafted | model-written READMEs per scope | the app |
| `build-plan.json`, `system-plan.json` | proposed → ratified | the plan and roadmap when building a project from scratch | the app |

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

## Every command in detail

Every command takes the project root as a positional argument (it can come
last; the default is the current directory). Exit code 0 is success, 1 means
something was found or refused (the output says what), 2 is bad usage, 3 means
a model could not be run.

### `view` — the visualisation

```bash
vibegraph-knowledge view [<path>] [--port <n>] [--open]
```

Starts the web app on a project (or one file) and serves it at
<http://localhost:4200> until `Ctrl-C`. The same app `./runVis.sh` builds
from a clone, shipped prebuilt in this package. The first run installs
`libcst` and `black` 24+ into `~/.cache/vibegraph-knowledge`; `python3` must be
on your PATH. `--open` opens your browser once it is ready; `--port` (or
`PORT`) moves it. The server binds `127.0.0.1` only. What you can do in it:
[VISUALISATION.md](VISUALISATION.md). Zero tokens until you use a Claude
feature in the app.

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
