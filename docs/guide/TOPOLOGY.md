# Declared topology

On a shared data platform (a sync database, a message broker, an object store,
a CRDT service) the architecture that matters is **declared as data**. Which
partitions exist, who may write each, which documents live where, which
decision rules read which data: all of it lives in catalogue arrays,
transition tables, decision trees and a principals file. The resource names
are **computed** at run time (`writeDoc(zoneFor(family), …)`), so static call
analysis sees only "calls writeDoc", and the threads and maps show none of it.

VibeGraph reads that declaration through a **generator the project owns**: a
command that reads the project's own data and prints it as JSON. Nothing here
spends tokens, nothing guesses from prose, and every module is opt-in. A
project with no generator registered sees no change.

The complete example is `test/fixtures/topology/topo_demo`: zones,
principals and grants in `catalogue/*.mjs`, a router `zoneFor`, a decider that
walks a verdict tree, and its generator `tools/topology.mjs`.

## 1. The topology command

```bash
vibegraph-knowledge topology add catalogue --generator "node tools/topology.mjs" --inputs catalogue/,tools/topology.mjs
vibegraph-knowledge topology check          # fresh | stale | never-run, per source; exit 1 if any is not fresh
vibegraph-knowledge topology show           # the page; --json for the merged model
```

- **The generator** prints JSON in the published schema,
  [`schemas/topology.schema.json`](../../schemas/topology.schema.json). It
  lists:
  - `stores`;
  - `zones` (`id`, `store`, `holds`: families or patterns);
  - `families`;
  - `principals` (`id`, `kind`, `roles`);
  - `grants` (`who`: a principal or `role:<name>`, `zone`, `access`:
    `read` or `write`);
  - `routers` (the function that maps a document to its zone);
  - `stateMachines` and `decisionTrees` (section 4).

  Any item may carry `cite: "file:line"`.

  ```json
  { "version": "1",
    "stores": [{ "id": "docs" }],
    "zones": [{ "id": "verdicts", "store": "docs", "holds": ["verdict"], "cite": "catalogue/zones.mjs:6" }],
    "principals": [{ "id": "svc-decider", "kind": "service", "roles": ["decider"] }],
    "grants": [{ "who": "role:decider", "zone": "verdicts", "access": "write", "cite": "catalogue/principals.mjs:11" }],
    "routers": [{ "function": "zoneFor", "file": "src/router.ts", "zones": ["verdicts"] }] }
  ```

- **`add` runs the generator once and validates its output.** An output that
  isn't a topology is refused with the reason and nothing is stored. Output
  goes under `.vibegraph/topology/`, one file per source; several sources are
  merged, and two that declare one id differently are listed as a conflict.
- **Staleness** is a content hash of the inputs, so it works with or without
  git. A source whose inputs changed is **stale**: it is still read, and said
  to be stale. **`export` re-runs** a stale source before writing
  `topology.md`, and the **session-start hook** says which sources are not
  fresh. A generator runs only on `add`, `run` or `export`: never from a hook
  and never on parse.

## 2. The Resources lens

In the app's System view the map gains a **Resources** lens once a topology is
registered.
- **Each store** is a box with its zones inside. A zone card names the families
  it holds, who may write it, its router, and the threads that router is on.
- **Each principal** has a write edge (solid) or read edge (dashed) to the
  zones its grants reach. A role is expanded to the principals that hold it,
  and the grant's `file:line` shows on hover.
- **Reads that say nothing per edge are folded.** A zone every principal may
  read reads "read by all N" on its card instead of drawing N edges, and a
  principal that may read every zone says "reads every zone". If the reads
  left still exceed 150 edges, those are said on the zone cards too ("read by
  N", the names in the inspector). Select a zone or principal to draw its
  reads; no card moves when you do. Writes and drift are always drawn.
- **Each family** has an edge to its zone.

A large map (over 600 cards and connections) is laid out after a paint,
behind a "Laying out…" spinner, instead of freezing the click that opened it.

The same questions from the command line:

```bash
vibegraph-knowledge topology who-writes verdicts      # svc-decider (via role:decider) — catalogue/principals.mjs:11
vibegraph-knowledge topology can-write svc-decider    # verdicts (via role:decider)
vibegraph-knowledge topology touches inspection       # src/decider.ts:module — src/decider.ts:7 hasRecentInspection
```

`touches` reads the IR of every function a thread walks, and counts the family
as touched when its name, or a literal matching its pattern, appears as a
**literal**. A name the code computes is not seen, and every answer says so.

## 3. Rules over the topology

Three verbs of the constraint grammar are checked against the declared grants,
in `check`, the hooks and `plan check`:

```json
{ "rule": "single-writer", "zone": "verdicts", "writer": "role:decider" }
{ "rule": "writer-subset", "zone": "evidence", "roles": ["inspector"] }
{ "rule": "no-write", "principal": "svc-intake", "zone": "verdicts" }
```

- **`single-writer`**: the zone is writable by exactly that principal, or by
  the holders of the role. (The other `single-writer`, with `writes`, checks
  the code; see [PLAN-ARCHITECTURE.md](PLAN-ARCHITECTURE.md).)
- **`writer-subset`**: everyone who may write the zone holds one of the roles.
- **`no-write`**: the principal may never write the zone.

**Unverifiable is never a pass.** These read unverifiable rather than pass:
- no topology is registered;
- the zone or principal isn't declared;
- the topology is **stale**. The verdict then says what it would have answered
  ("on it this would read PASS") and refuses to give it.

A violation names the grant and its `file:line`. Like the other new verbs, they
fail `check` (exit 1) but are advice in the hooks until calibrated.

## 4. Decision structures

State machines and decision trees are accepted through the topology JSON:

```json
"stateMachines": [{ "id": "request", "family": "request", "evaluatedBy": "decide",
  "transitions": [{ "from": "under-review", "to": "approved", "roles": ["role:decider"], "requires": ["inspection"] }] }],
"decisionTrees": [{ "id": "verdict", "root": "has-inspection", "nodes": [
  { "id": "has-inspection", "reads": ["inspection"], "evaluatedBy": "hasRecentInspection", "yes": "readings-ok", "no": "reject" },
  { "id": "readings-ok", "reads": ["reading-*"], "evaluatedBy": "readingsWithinLimits", "yes": "approve", "no": "reject" },
  { "id": "approve", "outcome": "approved" }, { "id": "reject", "outcome": "rejected" }] }]
```

- **The Decisions lens** draws each tree with yes / no edges and each machine
  with its transitions and who may make them. Each node links to the function
  that evaluates it (and that function's threads) and to the families it
  reads. Each family links to its zone, and the zone says who may write it.
- **On the command line**, the same chain:

  ```bash
  vibegraph-knowledge topology explain verdict:readings-ok
  #   reached from the root by: has-inspection:yes
  #   evaluated by readingsWithinLimits
  #   reads reading-* → zone evidence → writable by inspector
  ```

Recognising these structures in the code itself (rather than through the
generator) is not built. The generator is the one place they are read.

## 5. Live inventory diff

```bash
vibegraph-knowledge topology live --command "node tools/live.mjs"
```

- **The command** is yours: it must be **read-only** and print the platform's
  actual resources and grants in the same schema. VibeGraph runs it once,
  saves what it printed as `.vibegraph/topology/live.json`, and writes nothing
  to the platform.
- **The output** lists zones on the platform but not declared, declared zones
  missing there, declared grants the platform lacks, and grants the platform
  has that nobody declared. It exits 1 on any drift.
- **The Resources lens** draws the drift: an undeclared zone card, an extra
  grant in red, a missing one dotted.

## 6. Trace overlay

```bash
vibegraph-knowledge topology trace run.jsonl --save run
```

- **A trace** is one JSON event per line:
  `{"actor": "svc-intake", "action": "write", "zone": "verdicts", "document": "verdict/r1"}`.
  `action` is read / write / watch / decide / transition; `decision` holds
  `tree:node[=answer]` or `machine:from>to`.
- **Each event is checked** against the declaration: a write or read with no
  grant, an undeclared zone, an unknown decision node, or a transition the
  actor may not make. It exits 1 on any flag.
- **`--save`** keeps the trace for the app. In the Resources and Decisions
  lenses a trace bar steps through the run (or plays it, one event per 800 ms,
  stopping at the end; there's no play button under reduced motion). The
  event's actor, zone and decision node are lit, and anything it breaks is
  named.
