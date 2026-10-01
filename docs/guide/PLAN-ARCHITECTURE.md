# The plan's architecture sections

`.vibegraph/plan.json` holds the hypothetical project: processes, stack,
boundaries, threads, rules (see [CLI.md](CLI.md), `plan`). The sections below
describe the architecture people actually decide about, for a system whose
processes share a store. All of them are **optional**. A plan written before
they existed loads unchanged and is saved byte-for-byte as it was; an empty
section is left out of the file. Everything here is deterministic: `plan
check` spends no tokens.

Each section is changed by `plan edit` ops like the rest of the plan
(`add`, `update`, `drop`, `agree`, `rename`), and an agent's edit lands
**proposed**, for a person to agree.

## Stores — shared resources, not processes

A database, a sync service, an object store or a queue that several processes
share is a **store**. It has no code of its own to find. Modelled as a
process, it read as unanchored or drifted, and every boundary into it became
orphaned once someone dropped it.

```json
"stores": [
  { "id": "docs", "kind": "document-store", "label": "Document store",
    "reachedThrough": ["@acme/store-client", "@acme/store-sdk", "yjs"], "status": "agreed" }
],
"boundaries": [
  { "id": "b1", "from": "requester", "to": "docs", "status": "agreed" }
]
```

- **kind** is one of `database`, `document-store`, `object-store`, `queue`,
  `cache`, `sync`, `kv` or `other`.
- **reachedThrough** lists 1–6 names the code reaches it through. Each name is
  one of:
  - a tool the stack knows (an SDK, a data library);
  - a project funnel that wraps one;
  - a project folder (`packages/store-client/`);
  - a workspace package's name (`@acme/store-client`, read from that folder's
    `package.json`).
- **`plan check`** marks a store **realised** when any of those names is used,
  and **not-built** when none is.
- **A boundary to a store** is **realised** when its process's own files reach
  the store, directly or by importing the client package. It is **unverified**
  when the store is reached only somewhere else, and **not-built** when the
  store isn't reached yet. It is never drifted, and it is never orphaned while
  the store is live.
- **A database kept as a process.** A process of kind `db` or `cache` keeps
  its verdict but gets a hint. An orphaned boundary pointing at a dropped one
  gets the same hint: convert it.

  ```bash
  vibegraph-knowledge plan edit '{"op":"to-store","id":"storedb","reachedThrough":["@acme/store-client"]}'
  ```

  The store keeps the process's id, so boundaries pointing at it now point at
  the store. A dropped one comes back **proposed**. Without `reachedThrough`,
  the op reads it off the tools the process's boundaries name, or off planned
  tools with the same role. If it finds none, it asks.

## Zones — where access is enforced inside a store

Access is often enforced per partition of a store: a database, a schema, a
bucket, a topic, a document space. A **zone** says which document families
live where.

```json
{ "id": "docs", "kind": "document-store", "reachedThrough": ["@acme/store-client"],
  "access": { "write": ["writeDoc"], "watch": ["watchDocs"] },
  "zones": [
    { "id": "requests", "holds": ["request"] },
    { "id": "archive",  "holds": ["archived-*"], "routedBy": "router: archiveZone" }
  ],
  "status": "agreed" }
```

- **access** names the client's own functions that write, read and watch the
  store. A call to one of them is an **access site**, read with its literal
  arguments, for example `writeDoc("requests", "request", id, data)` in
  `submit`.
- **holds** lists document families or key patterns (`*` is a wildcard).
  **writers** and **readers** list principals (see *Principals*).
- **routedBy** is either a literal the code uses for the zone, or `router:
  <function>` when one function decides the zone.
- **A zone is realised** when the routing names it:
  - an access call whose literals include the zone's id, its `routedBy`
    literal, or a family only that zone holds;
  - or the named router function, holding the zone's id as a literal.
- **Other zone verdicts.** If the only accesses compute their zone (a variable,
  a template with `${…}`), the zone is **unverified**, never a pass. With no
  `access` on the store it is **unanchored**. A router function that isn't
  written yet is **not-built**.
- **A boundary may name a zone** (`"zone": "requests"`):
  - **realised** when an access site in its process's files names that zone;
  - **drifted** when that process touches only *other* zones;
  - **unverified** when that process's zone is computed.
- **On the map**, the store is a box with its zones as cards inside it, and a
  boundary that names a zone ends on that zone's card.

## Principals — who may write where

The rules that matter most are usually about identity: "only the decider
service writes verdicts". The plan states them as data.

```json
"principals": [
  { "id": "svc-requester", "kind": "service", "status": "agreed" },
  { "id": "svc-decider",   "kind": "service", "status": "agreed" },
  { "id": "auditor",       "kind": "human-role", "status": "agreed" }
],
"processes": [ { "id": "decider", "kind": "backend", "label": "Decider", "serves": "…",
                 "at": "apps/decider", "runsAs": "svc-decider", "status": "agreed" } ],
"zones": [ { "id": "verdicts", "holds": ["verdict"], "writers": ["svc-decider"], "readers": ["svc-requester", "auditor"] } ]
```

- **kind** is `service` (a process's own identity), `human-role` or `owner`.
  `runsAs`, `writers` and `readers` must name planned principals. A `rename`
  of a principal carries all three.
- **The write matrix** (principal × zone) is derived from the code. Every write
  access site is placed in the process whose files hold it, and its principal
  is that process's `runsAs`. The matrix is shown in `plan.md` ("Who writes
  where"), in the Plan panel, and on the map, where a zone card says
  `writers …` and a process card says `runs as …`.
- **Each zone's writers get a verdict:**
  - **pass**: every write the code makes to the zone is by an allowed
    principal;
  - **violated**: a process writes a zone its principal may not, named with
    its file and line;
  - **unverifiable**: a write the check cannot place (in no planned process, in
    a process with no `runsAs`, or a computed zone in a process that may not
    write there). Never a pass.
- **A principal** is realised when a built process runs as it. A `human-role`
  or `owner` is outside the code, so it reads unverified.

## Flows — coordination through the store

Processes that talk only through shared documents have no edge between them
in the code: no call, no HTTP request. For example, A writes a request, B
watches for it and writes a verdict, and A watches for the verdict. The flow
that defines the system is a sequence of steps through the store.

```json
"flows": [
  { "id": "f1", "serves": "a request is decided and its verdict reaches the requester", "status": "agreed",
    "steps": [
      { "process": "requester", "op": "write", "zone": "docs/requests", "family": "request" },
      { "process": "decider",   "op": "watch", "zone": "docs/requests", "family": "request" },
      { "process": "decider",   "op": "write", "zone": "docs/verdicts", "family": "verdict" },
      { "process": "requester", "op": "watch", "zone": "docs/verdicts", "family": "verdict" }
    ] }
]
```

- **Each step** names a planned process, `write`, `read` or `watch`, a
  `store/zone` and optionally a family. `plan check` marks a step found when
  an access site in that process's files matches it (a planned `read` is also
  met by a watch). A flow with every step found is **realised**, some missing
  is **drifted** (the missing steps are named), none found is **not-built**.
- **Indirect hops** are derived whether or not a flow is planned: a write of a
  family (or zone) in one process plus a watch or read of the same one in
  another. On the map they are dashed edges between the two processes,
  labelled `via docs/requests · request`. `plan.md` lists them with both call
  sites.
- **What a hop does not say.** A hop says the documents meet, not that one
  process triggered the other, and the order of a flow's steps is not
  compared. A computed zone or family never makes a hop.

## Modules — library vs deployable

A process used to be anchored to one folder (`at`). A deployable often lives
in one folder and runs logic from another: a runtime host script beside a pure
logic package. The plan then checked the wrong files, and its threads piled up
under "threads the plan gives no process".

```json
"modules": [
  { "id": "rules", "at": "packages/rules", "kind": "library", "status": "agreed" }
],
"processes": [
  { "id": "rules-runner", "kind": "backend", "label": "Rules runner", "serves": "…",
    "entryPoints": ["hosts/rules-runner.ts"], "uses": ["rules"], "status": "agreed" },
  { "id": "api", "kind": "backend", "label": "API", "serves": "…", "at": "apps/api", "uses": ["rules"], "status": "agreed" }
]
```

- **A module** is a code unit, with `at` and a kind of `library`, `app` or
  `tool`. **A process** is a deployable. It starts from `entryPoints` (files or
  entry-point ids) and runs the modules it `uses`; `at` still works.
- **A process's files** are its own `at`, the files of its entry points, and
  the files of its modules. **Who wrote a line** is answered by a process's own
  files first. A library file belongs to a process only when exactly one
  process uses it, so a write inside shared logic is never pinned on
  whichever process came first.
- **A planned thread with no `process`** attaches to the process whose own
  files hold the entry point it starts from. `plan check` reports it as the
  thread finding's `process`, and the map draws it there.
- **Workspace packages imported by name.** An import such as `import {
  classify } from "@acme/rules"` is resolved by the parser into the
  package's source file, using its `package.json` entry mapped from `dist/`
  back to `src/`, probed on disk. It is linked like any project import, and
  it is no longer listed as a third-party dependency. This was a gap on every
  multi-package repository: threads stopped at the package boundary.

## Layering rules that are checked

Decisions such as "the decision logic must not import the transport" can be
planned rules with a `layer` check. A layer check names the files of a layer
and what they may import.

```json
{ "id": "p1", "text": "The decision logic imports nothing: no transport, no store",
  "why": "decisions must be testable and replayable without the store",
  "check": { "rule": "layer", "files": ["decisions"], "mayImport": [] },
  "about": "decisions", "status": "agreed" }
```

- **files** and **mayImport** take planned module ids as shorthand, or
  folders (`packages/decisions/`), globs, files and package names (`zod`, a
  scope as `@acme/*`). Standard-library imports are allowed unless
  `"allowStdlib": false`.
- **It is checked against the project import graph**, with workspace packages
  imported by name resolved. A violation names each offending import with
  file and line:
  `packages/decisions/src/index.ts:1 imports @acme/store-client (packages/store-client/src/index.ts)`.
- **The other verdicts.** A layer with no parsed file is unverifiable. A layer
  that imports nothing outside itself passes.
- **`plan promote`** turns the module ids into folders, because
  `constraints.json` knows no plan. `check` then runs the rule and exits 1 on
  a violation. The hooks report a violation as advice and don't block until
  the verb is calibrated (the `payload-keys` precedent).
- **`vibegraph-knowledge plan layers`** offers the import graph as it is today
  as each module's starting rule (`store-client imports only @acme/store-sdk,
  yjs`). `--apply` adds them as proposed planned rules, to tighten and agree.

## Access and authority rules that are checked

The rules that matter most in a shared store, such as a single writer, an
audit event on every decision, or ids that encode their family, are three
more verbs of the constraint grammar. Each one says what it checked and what
it could not. When it cannot see enough, the verdict is unverifiable, never a
pass.

```json
{ "rule": "single-writer", "zone": "docs/verdicts", "by": ["decider"] }
{ "rule": "always-with",   "target": "recordVerdict", "with": "appendAudit" }
{ "rule": "id-scheme",     "family": "verdict", "producers": ["verdictId"] }
```

- **single-writer**: only these functions (`by`) or files / folders
  (`files`) call the store's write functions (`writes`) with a literal naming
  the zone or one of its `families`.
  - **violated** names each other writer by file and line;
  - **unverifiable** when a write outside them has *no* literal argument at
    all (its zone and family are computed).
  - In the plan, `zone: "docs/verdicts"` takes the store's write functions and
    the zone's families, and a process id in `by` means that process's own
    files.
- **always-with**: every path through function `target` also calls `with`.
  The call must sit outside any branch or loop, with no `return` before it.
  Both arms of an if count as every path.
  - **violated** for a call made only inside a branch, or an early return
    before it.
  - **unverifiable** when the function is not defined.
  - An exception thrown before the call is not followed, and the verdict says
    so.
- **id-scheme**: ids of family `family` come only from `producers`. Each write
  of the family must pass a producer's result, directly or through a name the
  producer bound in the same function.
  - **violated** for an id built inline from the family's name
    (`"verdict:" + id`);
  - **unverifiable** for an id that comes from a parameter, or when no
    producer is defined.
  - In the plan, `writes` defaults to the planned stores' write functions.

`test/fixtures/plan/authority_demo` holds a passing and a failing case of each.
All three are advice in the hooks until calibrated, and `check` exits 1 on a
violation.

## Assumptions and evidence

A plan rests on things nobody has checked yet: "the store refuses a write
its writers don't list", "a watch sees a write within a second". Any plan
item may say which open questions it **assumes**. A question, or an item,
carries the **evidence** someone ran: the command, what it should show,
when, and what it did show.

```json
"open": [
  { "id": "q1", "text": "Does the store refuse a write to a zone by a principal its writers do not list?",
    "evidence": [ { "command": "store-cli put verdicts/v1 --as svc-requester", "expect": "403 Forbidden",
                    "at": "2026-09-30", "result": "refuted", "note": "it returned 200" } ] }
],
"boundaries": [ { "id": "b2", "from": "decider", "to": "docs", "zone": "verdicts", "assumes": ["q1"], "status": "agreed" } ]
```

- **An assumption's state** is its latest evidence with a `result`
  (`confirmed` or `refuted`). With none, it is **unverified**. VibeGraph never
  runs the command: a person runs it and records the result, with a `plan
  edit` update of the question's `evidence`.
- **`plan check` says it next to the code's own verdict**, which it never
  changes: `realised … — realised in code, assumption q1 REFUTED`. The
  question gets its own finding:
  - **refuted** reads violated, and **FLAGS** every item resting on it;
  - **confirmed** reads pass;
  - **unverified** lists what rests on it.
- **Where it shows.** The hook's plan names refuted assumptions, `plan.md`
  lists each question's evidence, and the Plan panel shows each question's
  state.
- **A question something rests on can't be dropped.** It is answered with
  evidence, or first taken out of the items' `assumes`.

## Rename safety and change impact

The plan names code: a thread's steps, a process's entry points, a zone's
router, a store's access functions, a rule's targets. Rename `score` and the
plan silently stops matching; until now the agent only found out from a
"drifted" verdict after the edit.

```bash
vibegraph-knowledge plan affected --uncommitted          # or: plan affected <file>…
vibegraph-knowledge plan edit '{"op":"rename-symbol","from":"score","to":"rate"}'
```

- **`plan affected`** lists the plan items that name something the change
  touches: a named function defined in a changed file, or a changed entry
  file. Above them it lists anything **GONE**: a name a changed file
  defined at HEAD that nothing defines now, renamed or removed. HEAD is read
  as text (`git show`), and the output says so.
- **The post-edit hook** says it in the same turn: "The plan names `score`
  (threads classify batch step 2), which this edit removed from …", with the
  op that fixes it. It says it once per name per session, and never blocks.
- **`rename-symbol`** renames a function everywhere the plan names it:
  thread steps (`b1:score` keeps its boundary), routers, access functions and
  rule targets. It reports how many references changed. From Claude Code it
  is recorded as a proposal, like every agent edit.

## Generated documents that go stale visibly

A project often keeps documents a command derives (an architecture page, an
API reference, a schema dump), and nothing said when they stopped describing
the code. Register each one with the command that generates it and the
inputs it is derived from.

```bash
vibegraph-knowledge docs add docs/RULES.md --generator "node scripts/gen-rules-doc.mjs" --inputs packages/rules/
vibegraph-knowledge docs check        # STALE  docs/RULES.md — stale since 3f2a1c9: packages/rules/src/index.ts changed …
```

- **The registry** is `.vibegraph/docs.json`. Inputs are files, folders
  (trailing `/`) or globs.
- **Staleness is read from git.** A document's last generation is its last
  commit. It is **stale since** the first later commit that changed an input,
  or stale from the working tree when an input changed uncommitted and the
  document didn't. A document git doesn't track, or a folder outside git, is
  **unknown**, never fresh.
- **`docs check` exits 1** when anything is stale, and every stale line names
  the generator to run. VibeGraph never runs it.
- **The session-start hook** lists the stale documents, so a session doesn't
  take them as current.

## The proposal backlog

Agents propose and a person agrees, so proposals pile up. `plan review` puts
every pending one on one page.

```bash
vibegraph-knowledge plan review                                     # the page
vibegraph-knowledge plan review --agree stack:zod --reject processes:decider
```

- **A new item** is shown in full. **A change to an agreed item** is shown as
  a field-by-field diff against the version a person agreed to. When an agent
  edits an agreed item, that version is kept as `agreedAs`.
- **Each proposal comes with its evidence** (the plan-vs-code finding, the
  quote it came from, its evidence runs, the agent's changelog line) and the
  command that decides it. A proposed new objective and the rule changes
  agents proposed to `constraints.json` are listed beside them.
- **`--agree` / `--reject`** decide several at once. Rejecting a *change*
  restores the agreed version; rejecting a *new* item drops it. Only a person
  decides: the command is refused when Claude Code runs it.
- **The session-start hook** gives the backlog count. The Plan panel says how
  many proposals await review, shows an agent's change against the agreed
  version, and has a **Reject change** button.

## Migration note

Nothing to migrate. Every section on this page is **optional and additive**:
- **Existing plans.** A `plan.json` written before these sections loads
  unchanged and saves byte-for-byte as it was. Empty sections are never
  written, and the plan's `version` stays `"1"`.
- **`about`, the constraint grammar and the export** only gained values and
  verbs. Every verb that existed reads exactly as before.

Things you may notice, and what to do:
- **A database or cache you modelled as a process** now carries a hint, and so
  do orphaned boundaries pointing at a dropped one. Convert it with the
  `to-store` op.
- **Workspace packages imported by name** (`@acme/x`) are now project code.
  Threads cross them, and they are no longer listed as third-party tools in
  the stack. `plan check` may therefore realise threads that used to read
  drifted.
- **A planned tool whose role no table knows** now reads realised with a note,
  where it used to read drifted.
- **The new verbs** (`layer`, `single-writer`, `always-with`, `id-scheme`) fail
  `check` (exit 1) on a violation but are advice in the hooks until
  calibrated. A stated rule that uses them won't block an edit yet.
