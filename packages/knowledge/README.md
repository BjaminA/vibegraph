# vibegraph-knowledge

What [VibeGraph](https://github.com/BjaminA/vibegraph) derives from a
codebase, and what the people who run it have stated about it, written to
disk for a Claude that has no VibeGraph. Zero tokens by default: nothing
`init`, `export`, `check`, `constraints` or `seeds` writes comes from a model.
Three things do spend tokens — `classify`, `architecture --propose/--modify`
and `skills draft` — and each says so in its usage line.

The full guide, with every command and a team workflow, is
[docs/guide/CLI.md](https://github.com/BjaminA/vibegraph/blob/main/docs/guide/CLI.md).

**Install** (Node 20+ and Python 3.10+ on your PATH):

```
npm install -g vibegraph-knowledge
vibegraph-knowledge --version        # also installed as `vgk`
```

The examples below use `npx vibegraph-knowledge`, which runs it without
installing; with the global install, drop the `npx`.

```
npx vibegraph-knowledge init              # one marked block in CLAUDE.md pointing at the folder, + the gitignore line
npx vibegraph-knowledge export            # writes .vibegraph/knowledge/ under the cwd (seconds, no model)
npx vibegraph-knowledge export . --task "add a `region` column to `insert_readings`"
npx vibegraph-knowledge check             # verifies every stated rule's checkable half; exit 1 names the node
npx vibegraph-knowledge classify --dry-run   # the tools no table knows, with the evidence a model would get; spawns nothing
npx vibegraph-knowledge classify --apply     # SPENDS TOKENS: asks a model, stores each answer labelled as a model's
```

Then run Claude as you normally would. It reads CLAUDE.md, which now says
to read the folder's index first. Re-run `export` after you edit; the
folder is a snapshot.

Python 3 and libcst are required for the parse step (Python, Bash,
TypeScript, C++ and Rust are read; Python through libcst, the others through
committed tree-sitter grammars). When libcst is missing the tool installs it
into a directory it owns and tells you where. `init` needs neither.

`init` writes two files you own, both idempotently: the CLAUDE.md block
sits between `<!-- vibegraph-knowledge:begin/end -->` markers and is
replaced on a re-run, never duplicated; `.vibegraph/knowledge/` is added to
`.gitignore` once. `init --print` shows the block and writes nothing. No
hook or setting is ever installed.

## What it writes

Every file names its kind: **derived** (a script read it from the code),
**stated** (a person wrote it, with provenance on each line) or **observed**
(a consented run saw it).

- `README.md` — the index, in reading order.
- `constraints.md` (stated) — the operators' rules with their reasons, from
  `.vibegraph/constraints.json`. They are not in the code; they are the part
  of a task that cannot be inferred.
- `threads/INDEX.md` and `threads/<entry point>.md` (derived) — one contract
  per logic thread: what enters and leaves, every external call with its
  literal call text and the tool it leaves through, round trips inside loops,
  the thread's stack, the hops that leave its language or process, what it
  reaches and what reaches it, and the stated rules routed to that thread.
- `flows.md` (derived) — every hop that leaves a thread's language or
  process, terminal to terminal: the page, the literal it hands the
  platform, the script that runs, what that script leaves through — and a
  reverse index of what runs each target. Read top-down from what the user
  sees to the script that ingests; read the index bottom-up for the reverse.
- `architecture.md` (derived + stated) — the whole system on one page: the
  start-here story, the system in a dozen arrows (Bird's-eye), where each
  process runs (the stated hosts, networks and trust zones, with the
  dispatchers under the process they run in), what each process calls and
  hops to with the protocol and the fact it was read from, what crosses each
  edge, the edges that cross a trust boundary, the subsystems, which threads
  drive which, and what the map leaves out. Anything a person stated is
  marked **stated**; a model's unratified proposal is marked *proposed*.
- `architecture.vibegraph.json` and `architecture.html` (with
  `--architecture`) — the same map as data (format `vibegraph.system-map`,
  schema `schemas/system_map.schema.json`: every record, and each lens —
  Bird's-eye, Overview, Tools, Flows, Payloads, Trust — as the ids it
  selects, plus the hierarchy, subsystems and thread graph) and as a
  self-contained picture with every lens as a toggle. `--archify` also
  writes the model in Archify's schema, for that tool.
- `system_spec.md` (derived + stated) — the tools the project is built on,
  the project funnels that wrap them, and the policies stated about them.
- `skills/<entry point>.md` (model-drafted, then ratified) — the per-thread
  guidance a person, or a model under a recorded human ruling, signed off in
  VibeGraph, with the rules and their reasons. Only a ratified, current skill
  is copied; a stale or draft one is withheld and named with the reason.
  Skills are gitignored in the analysed project, so this folder is how they
  travel.
- `observations.json` (observed, when present) — what consented runs saw at
  each call site, copied verbatim.
- `plan.md` (derived, with `--task`) — the task mapped onto the threads that
  own it, dependencies first. Matching is lexical over the IR: name the
  files, symbols or node ids the task touches, or the plan is empty and says
  so.
- `envelope.json`, `stack.json`, `crossings.json`, `ir/`, `quality/`
  (derived) — the raw forms, only with `--with-ir`. The prose above is what
  a reader used in the measured run; the raw forms go stale on the first
  edit, when the source is the better reference.

## What is a thread, and what crosses between them

A thread starts at an entry point and walks the calls the IR resolves,
inside one language. Entry points are read from evidence, never guessed:
an HTTP route (Express, Fastify, Flask, FastAPI, Next.js App Router files),
a CLI (`main "$@"`, argparse/click, a shebang), a test, a PyTorch model's
forward — and, since M-FLOW:

- **a script whose body is its main** — a shebang script with no `main`
  seeds on its module (the statements that run when the file does);
- **a script another file names** — `"accounts/get_accounts.sh"` handed to a
  platform command, `"${DIR}/lib/rates.mjs"` handed to node: the file that
  path names is run, whatever its own file says (framework `command`, with
  the callers recorded);
- **an MCP tool** — `registerTool("name", …, handler)` makes the handler an
  entry (framework `mcp`), the way a route handler is one.

Rendering is calling: a JSX component element is a call, so a page's thread
walks its component tree down to whatever fetches. And a thread never widens
across a language or a process — what crosses is a **hop**, a weighed claim
over parsed data on both sides: `http` (a URL shape → the route that serves
it), `command` (a script-path literal → the parsed script's entry), `tool`
(a tool name → its registration). A hop is `path` when one target answers,
`ambiguous` when several do (all named, none claimed), `unmatched` when the
literal names nothing this project parses — and every hop says what it could
not establish. Named limits, stated where they bite: a handler declared as a
nested function and passed by name (`onClick={handler}`) is not walked
(inline arrows are); a target KEY (`buildBackendCommand("company", …)`) is
not a path, so a table that maps keys to scripts is not read.

To seed something the rules miss, `.vibegraph/manual_seeds.json` takes
`{ "file": "…", "irNodeId": "<function id>" }` — or `"module"` for a file's
top level — in any language; a seed that does not resolve is named in the
README rather than dropped.

## Tools no table can know: state their role

The stack index classifies a dependency by a table of known packages, with
roles such as HTTP client, database, model API (LLM, embedding and vision
services) and agent protocol (MCP). A private platform SDK is on no public
table, so it reads as `unclassified` and the module wrapping it cannot be
recognised as the project's funnel to it. State it once, and it is:

```json
{
  "id": "c1",
  "kind": "stack-policy",
  "text": "@acme/platform-client is our transport; every call to the platform leaves through lib/platform.ts.",
  "scope": { "stack": ["@acme/platform-client"] },
  "source": "human",
  "createdAt": "2026-09-23T00:00:00.000Z",
  "policy": { "tool": "@acme/platform-client", "role": "platform", "rule": "describe", "reason": "no public table can know a private SDK" }
}
```

`describe` classifies without deciding anything about use; `require`,
`prefer`, `forbid` and `replace-with` carry a role the same way. A stated
role applies only where the table is silent, and it carries the constraint's
id as provenance everywhere the tool appears: the stack index, the system
spec, and every boundary in a thread contract that leaves through it. Roles:
`web-framework`, `frontend`, `http-client`, `model-api`, `agent-protocol`,
`platform` (a backend platform behind one client — identity, policy, data and
commands: a Volt, firebase, supabase), `db`, `cache`, `queue`, `tensor`,
`data`, `cloud`, `infra`, `process`, `remote`, `test`, `build`, `utility` (an
in-process library with no I/O of its own), `runtime`.

The table also carries one-line **definitions** for tools whose role alone
under-describes them (the TDX Volt client packages, for one); the system spec
renders them under "Definitions" so a reader knows what a boundary IS, not
only which bucket it fell in.

## …or let a model classify them: `classify`

Every other command here is derived or stated. `classify` is the fallback for
the tools no table and no person has classified: it gathers what the IR
already says about how the codebase USES each one — the import forms, the
calls through its bindings (one hop of local binding followed, so
`const c = new Client()` → `c.send` counts), the files and threads that reach
it, its manifest version, and the lines of the project's own README /
ARCHITECTURE / CLAUDE.md that name it — asks a model for a role and a
one-sentence definition, validates the reply against what was asked (a role
outside the vocabulary, a tool that was not listed, a duplicate: refused and
named), and with `--apply` stores each answer as an **agent-stated**
`describe` policy in `.vibegraph/constraints.json`.

What that buys, and what it does not claim:

- The role reaches everything a stated role reaches — the funnel rule, the
  spec's sections, the thread contracts — **labelled** "role classified by
  c7 (agent, NOT human-reviewed)" wherever it shows. A human's statement
  about the same tool outranks it whatever the file order.
- Re-running never duplicates and never overrides: a tool any existing
  policy already gives a role is skipped, with the reason. Deleting an entry
  is how you ask again.
- **Ratify** by setting the entry's `"source"` to `"human"` (edit the text
  if it is wrong); the label drops to "role stated by c7". **Reject** by
  deleting it; the tool reads unclassified again.
- The model is told which roles derive an effect (an `http-client`,
  `model-api`, `platform`, `db`, `process` or `remote` call counts as a round
  trip, which drives the N+1 warning) so a library with no I/O of its own is
  not given one, and that the project's own unlinked code goes in `unsure`
  with the reason, never a role.
- `--dry-run` shows the evidence and the prompt and spawns nothing;
  `--dossier-out` / `--from-dossier` / `--reply` move the evidence and the
  reply as files, for a machine that has no model. `VG_CLAUDE_BIN` swaps the
  binary; the spawn denies the write tools and Bash structurally.

Measured on a ~1100-file, four-language production tree: 63 unclassified
third-party tools → 25 once the tables learned the platform class and the
noise was fixed (path aliases and the project's own shell functions had been
listed as dependencies) → **3** after one classify pass, and those three are
the project's own Python modules the linker did not follow, named as such.

**How the tables learn.** Ratified classifications of PUBLIC packages
are table lines waiting to be written: in the VibeGraph repository,
`npm run stack:learn -- <project root>…` reads every ratified `describe`
policy, says whether the table already agrees, disagrees, or lacks the tool,
and prints the lines to paste into `src/shared/stack_taxonomy.ts`. From the
next release the table knows the tool, the stated policy is redundant and
says so, and the next codebase never has to ask. A private SDK is right to
stay a stated policy in its own project.

## The files that shape the export: `constraints`, `seeds`, `skills`

Three files in `.vibegraph/` decide what the export can say beyond the code.
Each has a command, so nothing needs VibeGraph's GUI:

```
npx vibegraph-knowledge constraints list
npx vibegraph-knowledge constraints add --kind invariant --files telemetry/ingest.py \
    --text "Device ids are never logged in plain text: the operator treats them as personal data."
npx vibegraph-knowledge constraints ratify c7      # an agent-stated rule becomes human-stated
npx vibegraph-knowledge seeds add scripts/nightly.sh          # a script run from a cron outside the repo
npx vibegraph-knowledge seeds add telemetry/storage.py:_get_conn
npx vibegraph-knowledge skills list
npx vibegraph-knowledge skills draft telemetry/storage.py:list_devices   # SPENDS TOKENS
npx vibegraph-knowledge skills ratify telemetry/storage.py:list_devices
```

- `constraints` — the stated rules (`.vibegraph/constraints.json`), the
  file the measured runs found load-bearing. `add` stores the rule as
  **human**-stated (whoever runs the command is the human), through the same
  validator VibeGraph's GUI and MCP tool use: a malformed `--check` is
  refused, and a restatement of an existing rule is refused rather than
  stored as a twin. Write the reason into the sentence — it is what a reader
  needs when a case comes up the rule did not foresee. Zero tokens.
- `seeds` — entry points a person names (`.vibegraph/manual_seeds.json`),
  for code the discoverer cannot see. A seed is resolved against the parsed
  project before it is written and refused if it would not become a thread.
  Zero tokens.
- `skills` — per-thread guidance a model drafts and a person ratifies.
  `draft` is the second command that spends tokens: it uses VibeGraph's own
  prompt and gates (at least one real IR node cited and none invented, the
  four sections, the injection budget) and writes a DRAFT, which the export
  withholds. `ratify` makes it ratified; the export copies a ratified skill
  while it is fresh — the thread's code and the rules routed to it unchanged
  — and `reaffirm` re-stamps one that went stale but is still right.
  `--dry-run` shows the prompt; `--reply <file>` uses a saved answer.

## Verifying the stated rules: `check`

```
npx vibegraph-knowledge check                # every constraint's checkable half, against the code as it is now
npx vibegraph-knowledge check --uncommitted  # the working tree's changes are the delta (co-changes needs one)
npx vibegraph-knowledge check --json
```

A constraint may carry a checkable half beside its sentence: `callers-only`
(every caller of a target is in these files), `import-only` (only these
files import a tool), `calls-through` (every function that calls a target
also calls the guard), and the five quality verbs (`guards`, `not-in-loop`,
`handles-failure`, `annotated`, `co-changes`). `check` runs each against the
IR and reports one of three verdicts:

- **pass** — and what it could not follow.
- **VIOLATED** — with every offender as `file:node`, so the fix is
  addressable. Exit 1.
- **UNVERIFIABLE** — an unknown target, a missing guard, or a dynamic call
  that could be the target. Exit 2. This is not a pass; the code did not
  let the checker decide.

The measured reason this exists: in two head-to-heads a model reviewer
agreed with a rule's wording and approved a change that broke it; the
deterministic check is what caught it. Context makes a miss less likely.
A check catches it.

**Running it after every edit.** Claude Code can run a command when a
session stops. This package installs nothing into your settings; if you
want the check on every turn, add a `Stop` hook yourself:

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "npx vibegraph-knowledge check --uncommitted || true" }] }]
  }
}
```

The `|| true` keeps a violation from blocking the session; drop it if you
want exit 1 to stop the turn.

## Where it helps, and where it does not

Measured on a four-language example with six stated rules
(`reviews/h2h3/REPORT.md` in the VibeGraph repository): a plain Claude given
this folder and a pointer to it kept every rule and finished the task in
the same score as VibeGraph's orchestrated run, in about a third of the wall
clock. It read six files: the index, the constraints, the plan and three
thread contracts.

On a small project with a decent README and no stated rules, plain Claude
did as well without it. The value scales with what has been stated, and
with size: a README rule is bound to nothing and drifts as the code moves,
while a constraint scoped to a thread, file or node routes with the code.
That second claim is an argument, not yet a measurement.

## What it does not do

- `init`, `export` and `check` spawn no model; only `classify` does, and
  what it stores is labelled as a model's classification until a person
  ratifies it. Thread skills, READMEs and explanations are drafted and
  ratified in VibeGraph itself.
- It does not route a task semantically. A task that names no code yields
  no plan.
- It does not edit anything. VibeGraph's edit path (a CST patch with
  format-and-diff confinement) stays in VibeGraph.
