# Changelog

`vibegraph-knowledge` and the VibeGraph app. Newest first. Each entry says what
changed and, where an existing user would notice, how behaviour differs.

## 0.25.0 — unreleased

### The System view: the project in its own words, simpler as you zoom out

From a field report on a finished project: the Real map showed the central
store as a five-zone "file store", none of the identities, no outside caller
and no decision structure, even though plan check called them realised; the
Overlay drew 11 zones for 5 families and the store twice; and Bird's-eye,
Overview and detail drew the same boxes in Plan and Overlay.
[docs/guide/VISUALISATION.md](docs/guide/VISUALISATION.md#3-start-with-the-architecture-map).

- **Real says what plan check found.** A process plan check calls realised
  carries the plan's name ("named · plan"; the code's name is in the
  inspector) and badges who it runs as. Each store is one card under its plan
  or declared name with its declared size and writers ("order ledger · 7
  zones · 5 writers"); the zones the code touches sit in its box, labelled by
  the plan, sized by the declaration, badged by who may write them, and a
  zone only one identity writes gets a "written only by …" box. A process that
  serves calls (routes, a `.listen()`) has an **outside caller** in front of
  it: the plan's external process when one has a boundary to it, else
  "Outside callers". Each declared state machine and decision tree is a card
  on the process that evaluates it; the declaration's and the code's reading
  of one structure are one card. The plan's flows are a **Flows** list: pick
  one and its path lights up.
- **Overlay matches by identity, not label.** A zone by its families, a
  process by its entry points or its `at` path, a store by its id or the tool
  it is reached through. A matched plan item adds its name and "planned ✓" to
  the real box and is never drawn again.
- **Every mode zooms semantically.** Bird's-eye: processes, stores, outside
  callers, decision structures and trust boundaries; zones and the store's
  SDKs fold into the store card; everything planned but not built folds into
  one "N planned, not built" chip; unclassified tools are left to Tools.
  Overview adds the zones; Tools / Payloads draw everything. Going from
  detail to Bird's-eye never adds a box, and switching Real / Plan / Overlay
  keeps your zoom.
- **The map shows the zones plan check sees.** A call to a planned store's
  `access` function with a literal zone is drawn as that zone, as plan check
  already counted it.
- **The System view opens on the project.** If Subsystems is remembered on a
  project with no subsystem tier, the map is drawn instead of an empty
  canvas, and a launchpad chosen only because the architecture had not
  arrived yet gives way to the map when it does.
- **Topology freshness on Windows.** A source registered with its inputs as
  one space-separated string (as a Windows shell passed them) matched no file,
  so it read stale for ever after every run. Inputs are now split on spaces
  and commas, `\` becomes `/` and a leading `./` is dropped, in `topology add`
  and for sources already registered; a run whose inputs match nothing says
  so.

## 0.24.0 — 2026-10-05

### The plan's open questions: shown whole, closed on purpose, kept on the record

From a field report (plan revision 205, 9 of 10 questions open): the only
control on a question was "✓ Answered", which read as a status badge, so the
operator could not tell how to close one; a dropped question was deleted and
looked like a broken panel; long questions were clipped to two lines with
the answer in the clipped part; and in "Everything" the questions sat
10,000 px down.
[docs/guide/VISUALISATION.md](docs/guide/VISUALISATION.md#8-planning--a-hypothetical-project-beside-the-real-one).

- **Shown whole.** A question card grows with its text, which wraps; no line
  clamp, no ellipsis, no inner scroll. A question may now be up to 1,200
  characters, room for the answer as it is found.
- **Close and Drop are labelled actions.** "Close — answered" and "Drop — not
  needed", each confirmed, each with an optional note recorded in the plan
  history (`close open q3 — <note>`). "ANSWERED …" at the start of a question
  shows as a passive tag. A person's step: refused from an agent, and from the
  CLI under Claude Code (`plan close|drop|reopen open qN [--note]`).
- **Closed and dropped stay on the record.** A collapsed "Closed and dropped
  (n)" group shows each one's state, revision, who, when and note, with
  Reopen. Only open questions count against the cap of 10. `plan show` lists
  them.
- **Reachable.** A summary near the top of "Everything" ("9 open questions (cap
  10) · 4 look answered") jumps to the questions; at the cap, adding one more
  lists those that look answered with "Close all answered" (one confirm naming
  every id).
- **The panel follows edits made elsewhere.** A plan or architecture store
  changed by the CLI or another session reaches an open panel within a second
  (they are polled by modification time: an atomic save replaces the file, and
  the directory watcher lost it after the first one).

### The map: the plan switch and legend below the lens bar

The Real / Plan / Overlay switch and the legend sat on the lens bar's row and
covered its end on narrower windows. The lens bar now publishes its measured
bottom edge; the proposal bar, the switch with the legend under it, and the
node inspector all start below it.

## 0.23.1 — 2026-10-05

0.23.0's content, published whole. 0.23.0 (like 0.21.1) went to npm with 3
files instead of ~93: the package's build output is never committed, and it
was published straight after a fresh export with nothing built. `npm
publish` now builds the package itself (`prepublish.mjs`, run as
`prepublishOnly`) and refuses to publish if the CLI bundle, the viewer or the
parser scripts are missing. Use 0.23.1, not 0.23.0.

## 0.23.0 — 2026-10-05 (broken publish: 3 files — use 0.23.1)

### Architecture groups that stay true as the project grows

A ratified group used to name exactly the boxes it wrapped, so every cluster
added later fell outside every group without a word, the proposing model
never saw the plan, and a ratified map was never re-checked.
[docs/guide/VISUALISATION.md](docs/guide/VISUALISATION.md#3-start-with-the-architecture-map).

- **Membership by rule.** A group carries `match` rules over facts the map
  already holds (folder, package root, family, framework, tool role or name;
  `src/shared/arch_rules.ts`) beside the boxes it names. Code that fits a rule
  joins the group on the next change, with no model. A named box stays put;
  otherwise the most specific rule wins; `exclude` keeps a box out.
- **The plan in the proposal.** Claude sees the objective and the planned
  processes, modules and stores with their folders, is asked for rules that
  will hold as the plan is built, and may anchor a group to a planned item
  (`planned`, citable as `plan:processes:<id>`) before its code exists. The
  zero-token **Seed groups** gives every planned process a rule on its `at`
  folder; one not built yet waits instead of being refused.
- **Drift since ratification.** Ratifying stores a baseline. On every change
  the map compares against it (`src/server/arch_drift.ts`): new clusters the
  rules placed are counted; clusters no group holds, a new deployment unit, a
  new planned process or an emptied group are *substantial* and the bar offers
  **Update groups** — a model extends the ratified groups (fixed: it may only
  add), a person ratifies. CLI `architecture --drift` (exit 0/1/2) and
  `--update`.

**Behaviour changes:** `--seed-plan` seeds unbuilt planned processes as
waiting groups; the map re-reads `architecture.json` and the plan when they
change on disk, not only on a re-derive.

## 0.22.0 — 2026-10-05

### Rules you can review, one panel frame, one colour per kind of thing

From a field inspection of the viewer: the stated rules were reachable only
half-way down the Agent Manager's legacy run form, with no id, no verdict, no
proposals and no Accept button; every panel was a different shape in the same
grey; a plan's verdicts were walls of italic prose. Six changes,
[docs/guide/VISUALISATION.md](docs/guide/VISUALISATION.md#7-knowledge-that-survives-rules-skills-stack).

- **One colour per kind.** A single table (`src/shared/kinds.ts`) gives each
  kind of code object a hue and an icon — process, function, module, store,
  zone (dashed), path, type, JSON, XML, identity, setting, external service,
  rule, open question (dashed). Every chip and the legend (**Key** in any
  panel) derive from it; adding a kind is one row. A kind comes from a fact
  the analysis holds, never from the words. Clicking a chip goes to the object.
  Verdicts are a different shape (a pill with a dot).
- **A light theme.** The toolbar's theme button: dark (the default, as
  before), light, or follow the system. The code view stays dark.
- **One panel sheet.** Plan, Rules, Stack, Agent Manager, Direction, Models and
  the Board open in the same centred sheet (`min(1100px, 92vw)` ×
  `min(820px, 88vh)`), each with its own faint tint, a tab row to switch
  without closing, a section column, Esc to close, and **Dock** to keep it at
  the side. A pin opens the Board docked, so the graph stays usable.
- **Concise plan items.** A header line and at most three labelled bullets of
  chips, longer lists cut to three and "+N", the verdict prose folded under
  "Why realised · 14 files · 9 entry points", a scorecard that filters.
  `plan check --json` findings carry `facts` (the bullets, typed chips) and
  `numbers` beside `detail`.
- **A Rules panel.** Its own toolbar button, with a badge counting reviews that
  wait for a person (agent-stated rules plus open proposals). Each rule shows
  its id, who stated it and its live verdict from the same function
  `vibegraph-knowledge check` prints (`src/server/constraint_report.ts`, now
  shared). **Awaiting you**: Ratify / Remove an agent's rule; Accept / Reject a
  proposal shown before and after. The thread view gains a **rules** chip
  listing the rules on that thread.
- **History names the person.** Accept, reject, edit and ratify — from the
  panel or the CLI — record `who` (git `user.name`, else the account name);
  a rejection and a ratification are recorded too (they were not).

### Thread view: `if` and `try` boxes no longer cover cards

On a script thread whose functions call the same helper from many `if`
blocks, a box stretched from its own call site to wherever the shared card was
drawn, over every card between (one 276-card thread: 99 cards straddling a box
edge, sibling boxes overlapping, chips on cards). Four causes, all fixed:

- A card several calls reach is drawn once; a box now wraps only the members
  placed by a call written inside it (the call site's structural id starts
  with the box's). A block whose calls are all drawn elsewhere keeps its old
  box only if that covers no other card.
- A box hugs the column of its own calls; a call nested in another call's
  arguments, drawn one column right, no longer widens it over other callees.
- Boxes are sized from the cards' measured size, not a 200×75 guess; rows are
  spaced by their tallest measured card on threads up to 400 cards.
- The row spacing that reserves room for box chrome never saw the boxes in the
  live view (the drawn thread carries none); it is now given them.

**Behaviour changes:** panels no longer open as right-hand drawers (use Dock);
opening one panel closes another; the Stack panel's "state a policy" opens the
Rules panel's form; the brief's light-theme chip lightness (30%) failed its own
4.5:1 test on teal, so light chips use 25%.

## 0.21.1 — 2026-10-05

### A large Resources lens stays responsive

On a topology where every principal may read every zone, the lens drew one
edge per grant. A generated catalogue of ~50 zones and ~24 principals drew
over 1,500 edges, spent ~0.4 s laying them out on every open, panned slowly,
and laid out again whenever the project re-derived.

- **Reads that carry no information per edge are folded onto the cards.** A
  zone every principal may read says "read by all N", and a principal that may
  read every zone says "reads every zone". If the remaining reads still exceed
  150 edges, they are summarised on the zone cards too. Writes and drift are
  always drawn.
- **Select a zone or principal to draw its reads.** The cards stay where the
  folded map put them, so nothing moves when you click.
- **A large map is laid out behind a spinner.** Over 600 cards and connections,
  the layout runs after a paint, so the click returns at once. Over 200 edges,
  only what is in the viewport is rendered.
- **No re-layout when nothing changed.** The app ignores a topology reply
  identical to the last one, and the server reuses the derived topology until
  the next derive pass.

Measured on the 1,260-grant fixture (`test/fixtures/topology/scale_demo`):
60 edges instead of 1,260, layout 31 ms instead of 383 ms. On a real 1,513-grant
project: 200 edges, no long task while panning.

**Behaviour change:** universal read grants no longer appear as edges. Select
the zone or principal, or read the card.

## 0.21.0 — 2026-10-02

### Where data lives, decided at run time ("the location split")

Seven fixes from a field report on a system that builds each resource name at
run time (configuration plus a key looked up in a table), decides who may
write each zone in a function, reaches the store through injected functions,
and chooses each process's identity by configuration. Every piece was already
in the IR; these join them.
[docs/guide/DATA-ARCHITECTURE.md](docs/guide/DATA-ARCHITECTURE.md#where-data-lives-decided-at-run-time).

- **M1 — one pattern type.** Catalogue paths, built names, zone names with
  holes and plan globs are compared as patterns everywhere: `record_{Type}`
  covers `record_X`, and `request_*` covers `request_{Role}__{Person}`.
  Transforms (lowercase, `_` to `-`) apply to literal runs only.
- **M2 — resource names and zones verified by the table.** A builder fed from
  configuration names each zone's resource, typed and with its default:
  `acme-ledger`, from `{BUCKET_PREFIX=acme}-{zone}` and its transform chain.
  `plan check` realises a planned zone when the zones the code declares unify
  with what it holds, instead of looking for a literal in the router.
- **M3 — effective writers.** In the function that builds the writer map from
  the catalogue, later `out.zone = [...]` replaces and `add("zone", [...])`
  extends, with string constants resolved. A key built at run time is listed
  with its line.
- **M4 — the call path behind a write.** A write charged through reach carries
  the path its process's thread takes to it (`decider via main.ts →
  onRequest`), preferring the process's declared entry point.
- **M5 — structural implementations.** A class with every required member of
  an interface implements it without saying so. It is reported as
  `structural` and never walked in threads.
- **M6 — who a process signs in as.** Read from where its entry point builds
  its client: a literal config, an env variable's default, a settings field,
  or a documented launch line or `package.json` script that sets the
  variable. A write's own client is followed back to its identity. A
  process's `runsAs` is proposed, never applied. A script that signs in once
  per person acts as many, and says so.
- **M7 — one topology model.** The derived topology joins every reader: the
  rule checks (`single-writer` on a derived zone is now checkable), the
  `topology` commands, `plan check`, the lenses and the export. A role no
  declared principal holds is still an answer to `who-writes`.

## 0.20.1 — 2026-10-02

Three findings from running 0.20.0 on a real plan, each fixed generally.

- **A store write is charged to the processes that reach its function, not
  its file.** The write matrix placed a write by the folder its file lives in,
  so a file holding one process's write closure and another process's
  read-only helper charged the write to both. It is now placed through the
  threads that reach the enclosing function. An entry point maps to a planned
  process by the plan's `entryPoints`, else by the process that owns the entry
  file. A write reached only from entry points in no planned process reads
  unverifiable, saying why. File ownership is the fallback only for code no
  thread reaches.
- **A planned tool is realised through its software spec and its store.**
  A planned database tool read "drifted: the code uses <another db library>"
  while the store of the same name was realised through the platform SDK. A planned tool now also matches
  the packages its ratified software spec names as its identity, and the tools
  a same-named planned store is reached through. The finding says which.
- **The system map draws the store's zones.** Each zone the code writes, reads
  or watches is a box, grouped the way the plan's store groups families when a
  plan is open. Every process doing so is an edge labelled write, read or
  watch. A zone no operation reaches is not drawn.

## 0.20.0 — 2026-10-02

### The data architecture, read from the code (eight modules)

Systems on a shared data platform keep their architecture in data tables,
computed resource names, SDK verbs, injected I/O and documents two processes
share. `export` now derives all of it from the IR, with zero tokens, as
`data-architecture.md` (`data_topology.json` with `--with-ir`); its topology
joins the declared one as the lowest-ranked source, so the Resources and
Decisions lenses work without a generator.
[docs/guide/DATA-ARCHITECTURE.md](docs/guide/DATA-ARCHITECTURE.md).

Measured against a reference architecture a project's own team wrote for a
sync-document platform (178 facts, scored section by section by
`scripts/dev/score_reference.mjs`): **14 → 157** found. Each module was built
against two codebases unlike the reference first (`test/fixtures/declared/`: a
TypeScript billing service on a broker, a Python object-store pipeline). The
21 not found are stated: principals (in a local, ignored file), the link from
records to the fields a fold reads, two SDK calls whose receiver is an untyped
callback parameter or an array element, and three flow steps that need a zone
list computed at run time.

- **Literal tables:** a module-level constant holding data keeps its rows in
  the IR (`table`), in TypeScript and Python.
- **Name patterns:** a small pure builder is stamped with the pattern it
  returns (`returnsPattern`). Call sites fill its holes from literal
  arguments, through locals, agreeing callers and router functions;
  everything else is "computed at file:line".
- **SDK effects:** a receiver is tied to its tool through imports, typed
  parameters, constructors, factory return types and class fields. The verb
  names the effect (read / write / admin / watch / grant), payload keys are
  kept, and an untied effect-looking call is listed.
- **Injected capabilities:** a call through an interface-typed parameter
  links to every implementation (a returned object literal, a typed constant,
  a subclass). The TypeScript linker adds `viaInjection` edges, so threads walk
  into the adapter; test fakes are counted, never walked.
- **Stores, zones, families:** these come from a catalogue table and a naming
  record, with writers and readers as grants.
- **Data-coupled flows:** a family written in one process and watched or read
  in another, including writes made through a port or a project funnel. The
  order is never claimed.
- **Decision structures:** state machines and decision trees are recognised
  by shape, linked to their evaluating functions and declared evidence.
- **Library vs deployable** (`plan check`): a process with nothing of its own
  is not built (it read "realised (0 files)"). An entry point named like the
  process outside its folder is reported. Derived writes reach the write
  matrix, which used to pass zones the code writes as "no write to it yet".
- **TypeScript calls in argument objects** (`send({ topic: topicFor(t) })`)
  are minted as nodes, as Python mints keyword arguments' calls.
- **`docs stamp <path>`:** a byte-identical regeneration no longer stays stale
  for ever.
- **`constraints.json` round-trips:** unreadable rules and unknown fields are
  carried through, their ids are never reused, and a file of an unknown
  version is never rewritten.

## 0.19.0 — 2026-10-02

### Fixes from field use

- **Thread view: long block headers wrap; nothing overlaps.** A container
  chip such as `FOR [label, sid, doc] of [[ …a long literal… ]]` ran far off
  its box to the right. A chip is now never wider than its own box, wraps
  onto at most two lines, and ends in "…" past that (the whole label is its
  hover title). The layout leaves room for the wrapped chip and for the
  nested boxes' headers between rows, and an inner box paints above its
  outer one, so a FINALLY chip is no longer buried under the box above.
  Pinned in both orientations by `test:e2e-chip-long`.
- **No more mojibake from Python on Windows.** `→` read as `â†'` because
  Python decoded and encoded the pipe in the Windows locale (cp1252). Every
  script now reads and writes UTF-8, and the app and the CLI set
  `PYTHONUTF8=1` for the interpreters they start.
- **`software plan` adds what fits, instead of refusing the lot.** A spec
  with 25 rules was refused whole ("policies: 25 items, over the cap of
  10") and nothing entered the plan. The rules now go in core first, as many
  as the plan has room for. The ones that did not fit are named in the
  reply, and `--rules s1,s4` chooses which. Updates to rules already in the
  plan take no room. The Plan panel's button behaves the same way.
  `test:software-plan-cap`.

### Declared topology (topology brief, Modules 1–6)

On a shared data platform the architecture that matters is declared as data
and its resource names are computed at run time, so static analysis showed
none of it. A project now hands it over through a generator it owns. Zero
tokens, opt-in, and a project with no generator sees no change.
[docs/guide/TOPOLOGY.md](docs/guide/TOPOLOGY.md).

- **`topology add|remove|list|run|show|check`**: register a generator
  (command + inputs). Its JSON output is validated against
  `schemas/topology.schema.json`: stores, zones, families, principals, grants,
  routers, state machines, decision trees, each item optionally citing
  `file:line`. Output is stored under `.vibegraph/topology/`, stale when the
  inputs' content changes, re-run by `export` (which writes `topology.md`) and
  flagged by the session-start hook.
- **Resources lens** and **`topology who-writes | can-write | touches`**:
  stores as boxes of zones, principals with read / write edges (roles
  expanded, grants cited), each zone with its router's threads. `touches`
  reads the IR of the functions a thread walks.
- **Rules over the topology**: `single-writer` (declared form: `zone`,
  `writer`), `writer-subset`, `no-write`. A missing, undeclared or STALE
  topology reads unverifiable, never a pass.
- **Decision structures**: state machines and decision trees in the JSON. The
  **Decisions lens** links each node to its evaluating function, the families
  it reads, their zones and who may write them; `topology explain
  <tree>:<node>` prints the same chain.
- **`topology live --command`**: a read-only inventory command's output is
  diffed against the declaration (undeclared zones, missing and extra
  grants), saved, and drawn on the Resources lens. Nothing is written to the
  platform.
- **`topology trace <log.jsonl> [--save]`**: each event is checked against
  the grants and decision structures, and the app's trace bar steps through a
  saved run on either lens.

Also: the map's layout gained `keepAll`, so an edge-less card (a zone nobody
may touch) is drawn in these lenses.

Tests: test:topology (7), test:topology-rules (5, a pass / fail /
unverifiable case per kind), test:e2e-topology (3). Fixture
`test/fixtures/topology/topo_demo`.

## 0.18.1 — never published on its own; shipped in 0.19.0

### The viewer on Windows (two bugs reported against 0.17 and 0.18)

- **A missing file in the package.** `discover_project.mjs` imports
  `package_entries.mjs` (new in 0.17), and the build never vendored it, so every
  `view` logged "project-level entry-point discovery failed" and lost the
  package.json and program entry points. The build now follows every vendored
  script's relative imports, copies what is missing, and refuses to finish when
  an import still does not resolve.
- **Windows paths.** Under a native Windows Node the viewer keyed files with
  backslashes (`packages\rules\src\index.ts`), so every manual seed, rule
  scope, plan folder and Python module identity keyed with `/` missed ("manual
  seed … not used: no such file"). Project-relative keys are now always `/`.
  And a Linux-side CLI given a Windows-form path (`\\wsl.localhost\…`,
  `//wsl.localhost/…`, `C:\…`) translates it; on Windows it is left as is.

Tests: test:windows-paths (4). Checked by hand on Windows (Node 24, project on
C:, a manual seed) and on WSL with a `\\wsl.localhost` path.

## 0.18.0 — 2026-10-01

### The proposal backlog (plan-architecture brief, Module 11)

- **`plan review`** puts every pending proposal on one page: a new item in
  full, a change to an agreed item as a field diff against the version a
  person agreed to (kept as `agreedAs` when an agent edits it), the evidence
  for each, the command that decides it, and the rule changes agents proposed
  to `constraints.json`.
- **`plan review --agree … --reject …`** decides several at once (a person
  only). A new `reject` op restores the agreed version of a change, or drops
  a new item.
- The **session-start hook** gives the backlog count. The Plan panel shows the
  count, an agent's change and a **Reject change** button.

Tests: test:plan-review (4).

**Migration (Modules 1–11).** Nothing to migrate: every new plan section and
field is optional, a plan without them saves byte-for-byte as before, and
`version` stays "1". See the migration note in
[docs/guide/PLAN-ARCHITECTURE.md](docs/guide/PLAN-ARCHITECTURE.md#migration-note).

### Generated documents go stale visibly (plan-architecture brief, Module 10)

- **`docs add|remove|list|check`** registers a project's generated documents
  (path, generator command, inputs) in `.vibegraph/docs.json`. `check` reports
  each as fresh, **stale since <commit>** (the first later commit that changed
  an input, or the working tree) or unknown, and exits 1 when any is stale.
- The **session-start hook** lists stale documents with the command that
  regenerates them.

Tests: test:docs-registry (5).

### Rename safety and change impact (plan-architecture brief, Module 9)

- **`plan affected [--uncommitted] [<file>…]`** lists the plan items whose
  named steps, routers, access functions, rule targets or entry points the
  change touches, and any name now **gone** (defined in a changed file at
  HEAD, nowhere now).
- The **post-edit hook** says when an edit removed a function the plan names,
  once per name per session, with the op that fixes it.
- **`rename-symbol`** (a `plan edit` op) renames a function in every place the
  plan names it.

Tests: test:plan-affected (4).

### Assumptions and evidence (plan-architecture brief, Module 8)

- Any plan item may list **`assumes`** (open-question ids), and a question or
  an item may carry **`evidence`**: command, expected result, date and, once
  run, the result. The latest run decides whether an assumption is confirmed,
  refuted or unverified. VibeGraph never runs the command.
- `plan check` adds "realised in code, assumption UNVERIFIED / REFUTED" to an
  item's finding without changing its verdict. A refuted assumption is its own
  violated finding that flags every item resting on it. Shown in `plan.md`, the
  hook's plan and the Plan panel.
- A question something rests on can't be dropped, only answered with
  evidence.

Tests: test:plan-assumptions (4), test:e2e-plan-stores.

### Access and authority rules that are checked (plan-architecture brief, Module 7)

- Three new verbs in the constraint grammar:
  - **`single-writer`**: only these functions or files write a zone or
    document family, through the store's write functions;
  - **`always-with`**: every path through function X also calls Y;
  - **`id-scheme`**: ids of a family come only from its producer functions.
- Each says what it checked and what it could not. A computed zone, an id from
  a parameter or an absent function is **unverifiable**, never a pass.
- In the plan they take the plan's own names (`zone: "store/zone"`, process
  ids), expanded on promotion.
- Like `layer`, they fail `check` and are advice in the hooks until calibrated.

Tests: test:plan-authority (5, fixture `test/fixtures/plan/authority_demo`: a
passing and a failing case of each).

### Layering rules that are checked (plan-architecture brief, Module 6)

- A new verb in the constraint grammar, **`layer`**: `{rule: "layer", files,
  mayImport, allowStdlib?}`. It says the files of a layer may import only what
  `mayImport` names (project folders, globs, package names, `@acme/*` scopes;
  the standard library unless `allowStdlib: false`). It is checked against the
  project import graph, and a violation names each import with file and line.
  A layer with no parsed file is unverifiable, never a pass.
- In the plan, a layer rule may name **planned module ids**. `plan check`
  expands them, and `plan promote` writes folders into `constraints.json`.
- **`plan layers [--apply]`** proposes each module's rule from today's import
  graph.
- Like `payload-keys` before calibration, a `layer` violation fails `check`
  (exit 1) but is advice in the hooks.

Tests: test:plan-layers (5).

### Library vs deployable (plan-architecture brief, Module 5)

- A plan may hold **`modules`** (code units: `at`, kind `library` | `app` |
  `tool`), and a process may say what it starts from (**`entryPoints`**) and
  what it runs (**`uses`**). A process's files are its own plus its modules'.
  A library two processes use belongs to neither when placing a write.
- A planned thread with no `process` attaches to the process its entry point
  lives in, so the "threads the plan gives no process" card no longer fills up.
- **Workspace packages imported by name are project code.** `import … from
  "@acme/rules"` in a multi-package repository is resolved by the parser
  (`scripts/frontends/jsts/workspace.mjs`) into the package's source and
  linked, so threads cross the package boundary. **Behaviour change:** such
  packages are no longer listed as third-party tools in the stack, and threads
  that stopped at them now continue into them.

Tests: test:plan-modules (4, fixture `test/fixtures/plan/deploy_demo`).

### Coordination through the store (plan-architecture brief, Module 4)

- A plan may hold **`flows`**: ordered steps across processes, each "process
  writes / reads / watches store/zone (family)". `plan check` reports each step
  found or missing, and the flow as realised, drifted or not built.
- **Indirect hops** are derived from the code: a write of a family in one
  process and a watch or read of it in another. The map joins the two
  processes with a dashed edge labelled by the family, so request → decision →
  verdict reads as A → B → A. A computed zone never makes a hop.

Tests: test:plan-flows (5), test:e2e-plan-stores (3).

### Principals and who may write (plan-architecture brief, Module 3)

- A plan may hold **`principals`** (`service`, `human-role`, `owner`). A
  process says what it **`runsAs`**, and a zone's **`writers`** / **`readers`**
  name principals, so "only P writes zone Z" is data. Every name is validated,
  and a rename carries it everywhere.
- `plan check` derives the **write matrix** (principal × zone) from the code's
  access sites and checks each zone's writers: **pass**, **violated** (a
  process writes a zone its principal may not, with file and line) or
  **unverifiable** (a write it cannot place). It is shown in `plan.md`, the Plan
  panel and on the map's zone and process cards.

Tests: test:plan-principals (4), test:e2e-plan-stores (2).

### Zones inside a store (plan-architecture brief, Module 2)

- A store may list **`zones`** (`holds` document families or key patterns,
  `writers`, `readers`, `routedBy`) and its **`access`** functions (the
  client's own `write` / `read` / `watch` API). A call to an access function is
  an access site, read with its literal arguments.
- `plan check` marks a zone **realised** where the code's routing names it:
  an access call's literal, or the router function the plan names. A zone the
  code only reaches with a computed argument is **unverified**, never a pass.
- A boundary may name the **`zone`** it writes. It is realised at its own
  process's access to that zone, and **drifted** when that process touches
  only other zones.
- The map draws the store as a box with its zones inside it, and a boundary
  with a zone ends on that zone.

Tests: test:plan-zones (5), test:e2e-plan-stores (1).

### Stores are resources, not processes (plan-architecture brief, Module 1)

- A plan may hold **`stores`**: a database, sync service, object store or queue
  the processes share, with what the code reaches it through (tools, a project
  funnel, a folder or a workspace package name). `plan check` marks a store
  realised when any of those is used. A boundary may target a store, and is
  then realised or unverified, never drifted or orphaned while the store lives.
- **`to-store`** (a `plan edit` op) converts a database or cache that was
  modelled as a process into a store under the same id. A db/cache process,
  and an orphaned boundary into a dropped one, now say so.
- The map draws a store as its own card (or marks the real tool box that
  realises it), and `plan.md` and the hook's plan list stores.
- Found on the way: a planned tool whose role no table knows (`unknown`) read
  as **drifted**. Silence is not a contradiction, so it now reads realised,
  with a note.

**Behaviour change.** Plans that don't use `stores` load and save exactly as
before. The only verdict that moves on an existing plan is a stack tool the
tables don't know, which goes from drifted to realised.

Tests: test:plan-stores (5, fixture `test/fixtures/plan/store_demo`).
Docs: [docs/guide/PLAN-ARCHITECTURE.md](docs/guide/PLAN-ARCHITECTURE.md).

## 0.17.0 — 2026-10-01

### The planned architecture on the map (brief Module 1)

- **Planned threads on their process.** A planned process card on the
  architecture map carries an **N threads** chip; it opens the threads that
  name the process (`process` on a plan thread) as dashed step chains,
  coloured by their plan-check verdict, with a step plan check did not find
  struck through. Plan check now reports a drifted thread's missing steps as
  data (`missing`) and a realised process's entry points (`entryPoints`).
- **Rules and open questions where they belong.** Plan rules and open
  questions take an optional `about` (a planned process, thread, boundary or
  tool id, validated); they show as **N rules** / **N open** chips on that
  item. A rule without `about` lands on the one process whose files it names;
  anything else is listed under the Real / Plan / Overlay switch.
- **Boundary keys.** A planned boundary's edge reads `protocol · N keys`, the
  keys on hover.
- **Trust zones.** A planned boundary whose ends sit in two different stated
  (or proposed) trust / zone groups is drawn in the warning colour, the
  crossing named on hover.
- **Seed groups from the plan.** `architecture --seed-plan [--force]` and the
  **Seed groups** button propose `.vibegraph/architecture.json` groups read off
  the plan — a process group per realised planned process, and project /
  outside trust zones — with no model and no tokens. Pending until ratified,
  gated like a model's proposal.

**Behaviour change for existing users.** In the **Overlay**, a planned item the
code has realised used to be hidden on the assumption that its real box stood
for it — but nothing marked which box, and an item the real map draws no box
for (a web framework, a library with no entry point) was drawn nowhere, along
with its threads and rules. Now a realised item marks its real box with a
**planned ✓** chip and moves its threads and rules there; one with no real box
is its own card, chipped the same. The Overlay can therefore show one more card
than before (the plan_demo fixture: 3 → 4, the realised `flask`). Plans that
use none of the new fields (`about`) are read exactly as before; a plan whose
`about` names nothing is refused with the reason, like any other invalid plan.

Tests: test:plan-map (6, fixture `test/fixtures/plan/map_demo`),
test:e2e-plan-map (2), test:e2e-plan (updated: the Overlay's fourth card).

### Hooks and rules on a multi-package TypeScript repo (hooks-feedback brief)

What an agent hit building a TypeScript monorepo with the hooks, fixed
generally. `check`, every hook and `plan check` keep their exit codes: 0 pass,
1 violated, 2 unverifiable (a hook: 0, or 2 to block).

- **A rule can change without being deleted.** `constraint show <id>` (history
  and open proposals), `constraint edit <id> --check '<json>' --text …` (a
  person; applied and recorded field by field), `constraint propose <id> …
  --why "<reason>"` (an agent, or an edit run from inside Claude Code: stored,
  never applied), `constraint accept|reject <id> <pN>` (a person). Every change
  is validated as the whole rule. `constraint` is an alias of `constraints`.
- **A hook blames only what this edit introduced.** A violation an earlier edit
  introduced is one summary line, not a block (the end-of-turn check still holds
  the turn to it). Offenders are de-duplicated and capped per check, the reason
  given once, and a block names the `constraint propose` command for a rule
  that is now scoped too tightly. **Behaviour change:** an edit to a file that
  was already in violation no longer blocks unless it adds a violation.
- **Allow-lists that do not go stale.** `import-only` / `callers-only` `files`
  take an exact path, a folder (`src/db/`) or a glob (`packages/*/src/**`), and
  `allowTests: true` adds every test file. Exact lists behave as before. `plan
  promote` warns when a rule's only allowed file is one test file.
- **Programs found without manual seeds.** A `package.json` `bin` (mapped from
  `dist/` back to the parsed source) or a script whose runner (node, tsx,
  ts-node, bun, deno, vite-node — through npx / pnpm / yarn) names a file makes
  that file an entry point; so does a JS/TS file that awaits at the top level,
  calls `.listen()` or reads `process.argv`. `seed` is an alias of `seeds`.
  **Behaviour change:** projects like this gain entry points, and threads, they
  did not have; `package.json` now invalidates the envelope cache.
- **Planned threads with human names.** A plan thread may set `entryPoint` (an
  entry id, or a file with one entry) and is matched on it first; an unmatched
  thread lists the nearest entry points (a word-match guess, said as one); a
  drifted thread says why each step is missing. A `plan edit` op
  `{"op":"rename","section":…,"from":…,"to":…}` renames an item and every
  reference to it.
- **Plan state that goes stale is said.** Removing a constraint demotes the
  planned rule promoted into it back to agreed; a boundary whose end is a
  dropped process is **orphaned**; a stack tool may name the client libraries
  it is reached `via`; a cap refusal lists items to drop and pairs to merge.
- **Greenfield prompts.** A prompt about a planned thread the code does not
  have yet gets that thread's plan (what it serves, where it will live, its
  steps and the boundaries they cross) instead of a keyword guess at existing
  code.
- **Hooks across OS boundaries.** `hook install [--target posix|wsl]` installs
  the hooks alone (`wsl` = the form a Windows-side Claude Code can run against a
  WSL project); `hook run <event> --file <path>` (or `--command`, `--prompt`)
  builds the Claude Code payload itself and keeps the hook's exit codes;
  `doctor` says whether the hooks are installed, can run from this side, and
  have fired since they were installed (every hook now leaves a one-line record
  under `~/.cache`, never in the project).

Tests: test:constraint-amend (4), test:hooks (17), test:allow-lists (5),
test:program-entries (5), test:plan-thread-match (5), test:plan-stale (5),
test:plan-prompt (2), test:hook-tools (4).

## 0.16.0 — 2026-10-01

- `init --hooks --windows`: hooks a Windows-side Claude Code runs against a
  WSL project. `handles-failure` reads TypeScript / JavaScript. `this.field.method()`
  links when the class names the field's type. Plan check matches a step
  written `Class.method`. A `files`-scoped check reads the files its rule
  names. Sibling container chips no longer overlap.
