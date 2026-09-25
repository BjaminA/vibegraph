# VibeGraph

**See, run and edit a codebase as the structure it really has — and hand that
structure, and the rules your team knows, to Claude before it edits.**

VibeGraph parses your code (Python, TypeScript, bash, C++, Rust) into an IR,
traces every entry point forward as a *thread* across files and languages,
and draws the whole system as an architecture map whose every edge names the
protocol it was read from. Click a node and you are editing the file on disk,
through a chokepoint that rejects any change reaching beyond that node. The
same knowledge is exported as plain files a Claude Code session reads first.

> **Read [SECURITY.md](SECURITY.md) before pointing this at your own work.**
> The visualisation spawns the `claude` CLI with `--dangerously-skip-permissions`
> in the project you give it, writes to your files, executes your code (in a
> sandbox copy, behind a consent gate), sends your source to Anthropic and
> costs money per turn. Run it on a **git repo with a clean working tree**, so
> anything it does is one `git diff` from review.

![The launchpad — entry points grouped by what they are](docs/screenshots/01-launchpad.png)

---

## Get started

| | |
|---|---|
| **[docs/guide/SETUP.md](docs/guide/SETUP.md)** | Install, check it works on an example, point it at your code, settings, troubleshooting. |
| **[docs/guide/VISUALISATION.md](docs/guide/VISUALISATION.md)** | Using the web app on your codebase: the architecture map and its lenses, threads, running code, editing, rules, skills, agents, MCP. |
| **[docs/guide/CLI.md](docs/guide/CLI.md)** | The node commands (`vibegraph-knowledge`): every command, what it writes, what costs tokens, a team workflow. |

### Install — one npm package, no clone

```bash
npm install -g vibegraph-knowledge          # also installed as `vgk`
```

You need **Node 20+** and **Python 3.10+** (`python3` on your PATH). The first
run installs the Python parser and formatter (`libcst`, `black`) into
`~/.cache/vibegraph-knowledge` by itself. **Claude Code** (`claude`, logged in)
is optional: chat, drafting and proposals need it; everything deterministic
works without it. On Windows, use WSL2.

### See it — the visualisation

```bash
vibegraph-knowledge view /path/to/your/project     # then open http://localhost:4200
vibegraph-knowledge view . --open                  # or open the browser for you
```

Ctrl-C stops it. The architecture map, threads across files, running code to
a node, editing through the chokepoint, rules, skills and agents — walked
through in [docs/guide/VISUALISATION.md](docs/guide/VISUALISATION.md).

### Hand it to Claude — the knowledge commands

```bash
cd /path/to/your/project
vibegraph-knowledge init                     # point CLAUDE.md at .vibegraph/knowledge/
vibegraph-knowledge export                   # the architecture map, one contract per thread, the rules
vibegraph-knowledge constraints add --kind invariant --all \
  --text "Every outbound HTTP call goes through lib/http_client.py: it routes via the egress proxy."
vibegraph-knowledge check                    # verify the stated rules against the code
```

Then open Claude Code in the project as usual: `CLAUDE.md` now tells it to
read the knowledge first. Both halves share `.vibegraph/` in your project, so a
rule stated in the browser is what `export` hands to Claude. Every command, and
which three spend tokens: [docs/guide/CLI.md](docs/guide/CLI.md).

### From a clone (to work on VibeGraph itself)

```bash
git clone https://github.com/BjaminA/vibegraph.git
cd vibegraph && npm install
./runVis.sh /path/to/your/project            # the same app, built from source
```

## Commands and files

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

## What it is

Most code visualisers generate a picture that goes stale the moment you edit,
and you cannot edit *through* it. In VibeGraph **the file on disk is the
single source of truth and every view is a live projection of it.** Edit in
the graph and a CST patch changes the file; edit the file in your own editor
and a watcher re-derives the views within a few hundred milliseconds.

```
source files ──parse──▶ IR {nodes, edges, symbolIndex} ──▶ threads · architecture map · views · exports
     ▲                                                                   │
     └────────────── CST patch (format-and-diff confined) ◀──────────────┘
```

- **Node ids are structural paths**, never line numbers
  (`module/Shape.class/area.fn/return@0`), so a selection, a skill or a rule
  survives an edit.
- **Every edit routes through one chokepoint.** A save, a chat rewrite, an
  agent's change — each becomes a CST patch, is formatted, and is diffed
  against the original. **If the diff touches a line outside the node being
  edited, it is rejected and nothing is written.**
- **Uncertainty is typed, not flattened.** A call that is genuine runtime
  dispatch reads `dynamic`; one VibeGraph could not resolve reads
  `unresolved`; the two are never merged. A value from made-up inputs says so.
  **You should never have to guess whether what you are looking at is true.**
- **The model is a guest, not the engine.** Parsing, linking, threads, the
  map, layout and the chokepoint are deterministic. Claude drafts and
  converses; everything it proposes lands behind a human gate.

## What you can do with it

- **Understand an unfamiliar system**: the architecture map shows processes,
  dispatchers and the tools they call, each edge with its protocol and the
  fact behind it; six lenses from a dozen-box bird's-eye view to the payloads
  on every edge.
- **Follow one execution path** across files and languages, instead of
  chasing definitions.
- **Answer "what does this actually return?"** — run the real code to one
  node in a throwaway copy and see the value.
- **Refactor with a structural safety net** — the chokepoint rejects an edit
  that reaches beyond the node you targeted.
- **Write down what the code cannot say** — rules with their reasons, some of
  them machine-checked against the code; deployment and trust boundaries;
  per-thread skills a person ratifies.
- **Give every Claude session all of it** — `vibegraph-knowledge export`
  writes the map, one contract per thread and the rules into
  `.vibegraph/knowledge/`, and `check` verifies the rules in a hook or CI.
- **Run agents on the structure** — a task mapped onto the threads that own
  it, one bounded worker per packet, edits confined to its files, evidence
  collected by the server, human gates where you want them.
- **Drive it from your terminal** — the same tools are served over MCP.

## The views

| View | What it shows |
|---|---|
| **System → Architecture** | The whole system: processes, dispatchers, tools, protocols on every edge; lenses *Bird's-eye*, *Overview*, *Tools*, *Flows*, *Payloads*, *Trust*; groups you state or ratify. |
| **System → Subsystems / Threads** | Subsystems and how threads touch them; which thread calls or hops into which. |
| **Thread** | One entry point traced forward across files and languages, branches in their own colours, `dynamic` and `unresolved` marked, run / observe / trace from any step. |
| **Diagram** | One file as structure — or, with the *Code* toggle, as its highlighted source in the same layout. |
| **Code** | Monaco, with a focused editor for the node you click. |
| **Arch** | PyTorch models as layer schematics with per-layer parameter counts. |

![Architecture map, Bird's-eye lens — the fleet example's processes, the hops between them and the tools they reach, each edge labelled with its protocol](docs/screenshots/05-architecture.png)

![Thread view — one execution path traced across files](docs/screenshots/02-thread.png)

![Arch view — the layer stack with parameter counts](docs/screenshots/03-arch.png)

![Diagram view — one file as structure](docs/screenshots/04-fileview.png)

## Languages

| Language | Read | Edit | Run a node / trace |
|---|---|---|---|
| Python | yes | yes | yes / yes |
| TypeScript (`.ts` `.tsx` `.mjs` `.cjs`) | yes | yes | — |
| Bash (`.sh`, `#!` scripts) | yes | yes | — / yes, with nothing external executed |
| C++ | yes | — | — |
| Rust | yes | — | — |

Plain `.js`/`.jsx` are not parsed yet. Anything skipped is counted and
reported, never dropped silently.

## Try it — worked examples

| | |
|---|---|
| [**examples/pump-wear**](examples/pump-wear/README.md) | A finished PyTorch project: threads, the schematic, three run-to-here drills, chat edits, skills, agents. |
| [**examples/pump-from-scratch**](examples/pump-from-scratch/README.md) | The same project built from an empty folder through ratified plans and gated increments. |
| [**examples/pump-polyglot**](examples/pump-polyglot/README.md) | pump-wear plus a Flask API, a TypeScript dashboard, a bash pipeline and a C++ tool. |
| [**examples/fleet-telemetry**](examples/fleet-telemetry/README.md) | Four languages and rules the code does not reveal — the example the measured agent runs used. |

## Development

```bash
npm run build                 # web app + server bundle
npm run build:cli             # the vibegraph-knowledge bundle + vendored parsers
npm test                      # the full suite (unit + Playwright)
npm run test:ir               # the Python parser snapshot
npm run test:thread           # the thread extractor snapshot
npm run test:cst              # the rewriter's ops and their confinement
npm run test:cli-files        # the node commands, end to end
npm run audit:arch            # the architecture map on every example
```

```
server.ts                    WebSocket runtime + MCP server (one process)
scripts/                     the Python parser and rewriter, the thread extractor,
                             the effect floor, tree-sitter frontends, the CLI (scripts/cli/)
src/server/                  stack, crossings, contracts, constraints, architecture, agents
src/webview/                 React + React Flow + Monaco
schemas/                     the IR, project and system-map contracts
packages/knowledge/          the vibegraph-knowledge package
examples/                    worked examples
test/                        fixtures, snapshots, Playwright specs
```

## Limits worth knowing

- **Static tracing has honest gaps.** Runtime dispatch, an unannotated
  receiver, or a call through a value is marked `dynamic` or `unresolved`
  rather than guessed. Trace runs fill some of them with what really ran.
- **A green check proves self-consistency, not correctness.** A builder given
  a vague data format invents one and checks against its own invention.
  Specify formats, not just field names.
- **C++ and Rust are read-only**, and C++ linking follows header conventions
  (no build graph).
- **The server has no authentication.** It binds to `127.0.0.1`; keep it
  there.

## Security

VibeGraph runs an LLM agent with write access to your source tree. See
[SECURITY.md](SECURITY.md) for what it does on your machine, what protects
you (the edit chokepoint, the effect floor, human gates, localhost binding)
and what does not.

## License

MIT — see [LICENSE](LICENSE).
