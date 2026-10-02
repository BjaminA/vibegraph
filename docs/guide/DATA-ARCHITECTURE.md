# The data architecture, read from the code

On a shared data platform (a sync-document store, a message broker, an object
store, a multi-tenant database) the architecture that matters is mostly not in
the calls:

- it is **declared as data**: tables of object literals list the resources,
  who writes and reads them, the state machine's transitions, a decision tree;
- the resource names are **computed**: small functions build them from
  templates, so no literal names the resource;
- it is reached through a **platform SDK** whose method names carry the effect
  (`SaveX`, `WriteX`, `GetX`, `WatchX`), often nested in `check(await client.X(...))`;
- processes are **coupled through data**: one writes a family, another watches it;
- the decision logic receives its I/O **by injection**.

`vibegraph-knowledge export` now reads all of this from the IR, with zero
tokens, and writes it as `data-architecture.md` (`data_topology.json` with
`--with-ir`). Its stores, zones, families, grants and decision structures join
the topology as the lowest-ranked source: a project's own topology generator
(see TOPOLOGY.md) wins wherever both speak, and the Resources and Decisions
lenses show the derived layer when there is no generator. Every item cites
`file:line`; what cannot be reduced is listed under "What could not be
reduced", never guessed.

The field names each rule recognises are taxonomy tables in the code
(`DECISION_FIELDS`, `RESOURCE_FIELDS`, `VERB_EFFECTS`), never a project's own
words.

## 1. Literal tables

A module-level constant whose value is data (an array of object literals, an
object keyed by name, a list of plain literals) keeps its rows on its
assignment node in the IR, as `table`: keys, field names and literal values,
with identifiers kept as references (`{ref: "ALL_ROLES"}`). TypeScript and
Python. Nothing is interpreted at this stage. A table built by a call
(`ROUTES.map(...)`) is computed, not declared, and is not lifted.

## 2. Name patterns

A function whose whole body returns a template literal, an f-string or a `+`
concatenation of its parameters is stamped with the pattern it builds, holes
named by parameter: `topicFor = (env, t) => \`${env}.invoices.${t}\`` →
`{env}.invoices.{t}`. A parameter passed through a method chain
(`b.replace(...).toLowerCase()`) is still its hole, marked transformed. At a
call site the literal arguments fill the holes. A name is also followed:

- through a local bound to a builder's result;
- through a parameter, when every caller passes the same name (callers that
  disagree make a funnel, not an operation on one family);
- through an unreducible function wrapped around a reducible name, which is
  recorded as a router.

Anything else is "computed at file:line".

## 3. SDK effects

A call `recv.Method(...)` is attributed to a tool when its receiver comes from
that tool:

- an import binding;
- a typed parameter (`client: Client`);
- a constructor;
- a factory's declared return type (`connect(): Promise<Client>`);
- a call on another such object (`kafka.producer()`, `boto3.client("s3")`);
- a class field's type and its method's return type.

This includes calls nested in arguments and `await`. The verb names the
effect: `read`, `write`, `admin`, `watch`, or `grant`, where an access or
policy noun, or grant-shaped payload keys, make a write a grant. Payload keys
are kept; values never are. Constructors and listener wiring (`.on(...)`) are
not calls on the tool. A call that looks like an effect, in a file importing an
I/O tool, whose receiver could not be tied to it, is listed as such.

## 4. Injected capabilities

A call through a parameter typed by an interface (a TS `interface`, or a
Python class based on `Protocol` or `ABC`) is linked to every implementation
in the project:

- an object literal a function returns under that return type, including
  members under a conditional spread;
- an object held by a constant typed as it, or declared `satisfies` it;
- a class naming it as a base.

In TypeScript the linker adds the `viaInjection` edges, so a thread walks from
the pure logic into the adapter. Test fakes are counted apart and never
walked, and a member forwarded from elsewhere (`read: o.read`) is recorded,
not linked. An interface nothing implements is said.

## 5. Stores, zones and families

- **Families:** a catalogue (a rows table whose rows name a resource, and who
  writes and reads it) gives one family per row.
- **Zones:** a naming record whose keys are the catalogue's patterns names
  each family's zone. A hole in the key is filled by the row's literal
  (`record_{Type}` → `record_Approval`).
- **Grants:** writers and readers become grants.
- **The store:** the data tool most of the SDK writes and watches go to.

Zone writers are read from the catalogue; a function that rewrites them at run
time is named under "What could not be reduced". Principals that live in local
or ignored files come only from the stated layer or a topology generator.

## 6. Data-coupled flows

A data operation is a call whose verb writes, reads or watches and whose name
reduces to a family's pattern. That holds through the project's own funnel as
much as through the SDK. Two more cases count:

- **Through a port.** The operation is reported again at every call through an
  injected port that reaches it, because that is where the logic does its I/O.
- **A literal zone name.** A call passing a zone's literal name to a function
  that reads or watches is an operation on that zone.

A family written in one process and watched or read in another is a hop. The
processes are the entry points whose threads reach the operation. The hop says
which family joins them; it never claims an order.

## 7. Decision structures

These are recognised by shape:

- **State machine:** a rows table whose rows carry from and to. Its roles and
  guards come from the rows, and its evaluator is the function that looks rows
  up in it.
- **Decision tree:** a record of nodes with yes and no successors. Leaves
  become outcome nodes, and each node's declared evidence is kept.

Each node is linked to its evaluating function when a parallel record maps the
same keys to functions. A tree no record evaluates says so.

## 8. Library vs deployable

A process is an entry point plus what its thread reaches, not a folder. In
`plan check`:

- **Nothing of its own.** A planned process whose own folder is empty, and
  which no entry point runs, is not built, even when the modules it will use
  exist.
- **Runs from elsewhere.** An entry point named like the process outside its
  `at` folder is reported, with the folders its thread reaches.
- **Derived writes.** The derived data operations reach the plan's write
  matrix, so a zone the code writes no longer reads "no write to it yet".

## Also fixed on the way

- **`docs stamp <path>`:** a regeneration that comes out byte-identical left
  git nothing to record, so `docs check` said stale for ever. A stamp records
  the content of the document and of its inputs; while both match, the
  document is fresh.
- **`constraints.json` round-trips:** a rule this version cannot read is
  carried through verbatim, an unknown field stays on its rule, its id is
  never reused, and a file of a version this code does not read is never
  rewritten.
- **TypeScript calls in argument objects:** a call that is a property value of
  an object-literal argument (`send({ topic: topicFor(t) })`) is minted as its
  own node, as Python mints a keyword argument's call.
