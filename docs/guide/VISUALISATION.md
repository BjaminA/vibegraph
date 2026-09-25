# Using the visualisation on your codebase

Set-up is in [SETUP.md](SETUP.md). This page assumes you can run:

```bash
npm install -g vibegraph-knowledge            # once
vibegraph-knowledge view /path/to/your/project
```

and open <http://localhost:4200>. (From a VibeGraph clone, `./runVis.sh
/path/to/your/project` starts the same app built from source.)

---

## 1. What happens when it starts

`view` makes sure Python can import `libcst` and `black` (installing them into
`~/.cache/vibegraph-knowledge` the first time), then starts one Node process
that:

1. **parses every supported file** (Python, TypeScript, bash, C++, Rust — see
   [SETUP.md §5](SETUP.md#5-what-vibegraph-reads)) into an IR;
2. **links** calls across files (`train.py` → the function in `model.py`);
3. **discovers entry points** — routes, CLIs, scripts, tests, MCP tools, pages,
   model classes — and traces a **thread** forward from each;
4. **derives the stack** (the tools the project is built on, by role), the
   **crossings** between languages and processes, and the **architecture map**;
5. **watches** the files: edit in your own editor and the views re-derive
   within a few hundred milliseconds (the toolbar shows a muted
   "re-linking…" pulse while it works).

The browser shows a boot animation while this runs, then opens on the
**architecture map**. (`VG_START_VIEW=index` opens on the thread list instead.)

The server binds `127.0.0.1` only. It has no authentication — do not expose it.

## 2. The layout

- **Toolbar** (top): the view buttons — **Code**, **Thread**, **System**,
  **Arch** — and panel buttons, each with a tooltip saying what it opens:
  edges and node categories, the node editor, **Models** (which model runs
  which work), **Stack** (what the project is built on), generic **skills**,
  the **Agent Manager**, and "describe an insertion". A badge reading
  *no claude* means the `claude` CLI was not found; the deterministic views all
  still work.
- **Side panel** (left): **Threads | Files**. *Threads* lists every entry point
  grouped by kind (routes, CLIs, pages, tools, manual seeds…), each with its
  summary. *Files* is the project tree.
- **Chat** (bottom-right button): a Claude Code session that sees the project
  through VibeGraph's own tools.

A selection in any view is shared: select a node in one and the others follow.

## 3. Start with the architecture map

**System → Architecture** (the default first view). One page of the whole
system: *processes* (clusters of entry points under one package root),
*dispatchers* (a script others run everything through), and *boundary tools*
(databases, caches, queues, cloud services, HTTP clients, model APIs). Every
edge carries a **protocol read from a fact in the code** — `SQL`, `exec`,
`Volt · WebSocket · command`, `HTTP GET` — never guessed.

The **lens bar** changes what is drawn, never what is true:

| Lens | Shows |
|---|---|
| **Bird's-eye** | the system in about a dozen boxes: who reaches it, the processes on the flow, the most-called tools, one arrow per pair |
| **Overview** | every process and every tool call, tools folded into one box per category |
| **Tools** | every tool, one edge per call relation |
| **Flows** | processes only, and the hops between them (HTTP, command, MCP tool) |
| **Payloads** | each edge labelled with what crosses it — the keys the code spells |
| **Trust** | only the edges that cross a deployment or trust boundary you stated |

Click a box or an edge for the **inspector**: what it is, *why* its protocol
reads as it does, the threads behind it, the call sites, and **Upstream**,
**Downstream** and **Route from here…** traces. **Play start-here path**
walks the primary path as a story once one is stated.

**Groups — hosts, networks, trust zones.** The code cannot tell which machine
a process runs on. **Propose groups** asks Claude (one call, about a minute;
the map shows a working card and the processes pulse while it drafts). Every
group it proposes must cite a line it was shown — a docker-compose service, a
pm2 entry, a doc line — or it is drawn faded as *INFERRED*. Nothing applies
until you **Ratify** (**Modify** re-drafts with your words; **Reject** drops
it). Ratified groups are saved to `.vibegraph/architecture.json` and appear in
every export.

## 4. Threads — one execution path across files

Pick an entry point in **Threads** (or a box on the map) to open the
**Thread** view: that entry point traced forward through every function it
calls, across files and languages, left to right.

How to read it:

- **Steps** are calls into your own code; **external** terminals are where the
  thread leaves your code (a library, a database, the network), coloured by
  what they do.
- **`dynamic`** (amber) means genuine runtime dispatch — no static answer
  exists. **`unresolved`** (grey `?`) means VibeGraph could not find the
  target. The two are never merged.
- **Containers** (`TRY`, `FOR`, `IF`/`ELSE`, comprehensions) enclose the calls
  inside them. Solid joins always run; dashed edges are conditional.
- Different branches of one thread get different line colours.
- A dashed hop into another process (an HTTP call matched to the route that
  serves it, a script run by path) is drawn to the thread it reaches, and can
  be walked from the step's tooltip.

**Hover a step** for its tooltip: the call's arguments, where it is written,
and the actions that apply to it:

- **Run to here** — runs the real code up to this node in a throwaway copy of
  your project and shows the actual value. Side effects are scanned first;
  anything that would touch the network, a database or the filesystem asks for
  your consent. If a required input file is missing, Claude drafts an example,
  shows it in full, and your consent is bound to its content hash.
- **Observe** — on a `dynamic` call: runs the enclosing function and reports
  what the receiver really was.
- **Scope** — on a `dynamic`/`unresolved` call: asks Claude what the target
  most likely is (marked as a model's answer).

The thread view's **trace** button runs the whole entry point once and
annotates every call site it touched with what it really called
(`.vibegraph/observations.json`, beside the IR, never in it). Python traces
run the code; bash traces point `PATH` at a directory that does not exist, so
every external command is recorded and none is executed.

## 5. Files — one file as structure

**Files → a file** opens the **diagram** view of that file: imports in one
column, module state in the next, then functions and classes laid out by
call flow (a callee to the right of its caller), sized to fit.

The **Cards / Code** toggle (top-left of the canvas) switches between
structural cards for every statement and the **actual source**, highlighted as
your editor shows it, in the same grouping — more compact, every line whole.

## 6. Editing

Every edit goes through one **chokepoint**: the change becomes a CST patch,
is formatted, and is diffed against the original. **If the diff touches any
line outside the node you targeted, it is rejected and nothing is written**,
with the reason. Editing is available for Python, TypeScript and bash; C++
and Rust are read-only.

- **Edit** — click a node (or open the node editor from the toolbar), change
  its code in the editor, **Save**. The file on disk changes; the views
  re-derive.
- **Intent** — describe the change in words; Claude drafts it, you see a
  preview, and only **Save** writes it.
- **Describe an insertion** (toolbar) — Claude drafts new code for a place you
  choose; you preview before anything is written.
- **Chat** — ask Claude to change something. It edits through the same
  chokepoint (raw file-write tools are denied to it), so a chat edit is as
  confined as a hand edit.

Work on a clean git tree and review with `git diff`.

## 7. Knowledge that survives: rules, skills, stack

- **Constraints** (Agent Manager → constraints) — rules the code cannot show:
  "every outbound HTTP call leaves through `http_client.py`", "the export's
  first four columns never move". Write the **reason** into the rule. A rule
  can carry a **check** VibeGraph verifies against the code (`callers-only`,
  `import-only`, `calls-through`, `guards`, `not-in-loop`…), which reports
  *pass*, *violated* (naming the offending call) or *unverifiable* — never a
  silent pass. Saved to `.vibegraph/constraints.json`.
- **Thread skills** — on a thread, **draft** a skill: Claude writes guidance
  for that thread, citing real node ids (a draft citing an id that does not
  exist is refused). You read it and **ratify** it; only ratified skills are
  used. When the code or the rules routed to the thread change, the skill is
  marked **stale** and shows what changed; **re-affirm** it if it is still
  right.
- **Stack** (toolbar) — every tool the project uses, by role, with the
  evidence, the project modules that wrap them, and any policy stated about
  them (*prefer*, *forbid*, *replace-with*…).

All of this is what the node commands export for a plain Claude session —
see [CLI.md](CLI.md).

## 8. Agents

The **Agent Manager** (toolbar) turns a task into work on threads:

1. Describe the task, **naming the code it touches** (backticked symbols, file
   names) — the decomposition is lexical and needs names to match.
2. Choose **Gated** (you review every packet) or **Orchestrated** (you confirm
   one objective; an orchestrator writes each worker's task and reviews each
   packet against the constraints).
3. **Plan the run** — the task is mapped onto the threads that own it,
   dependencies first. Nothing runs until you ratify (gated) or confirm the
   objective (orchestrated).
4. Each packet gets one bounded worker: VibeGraph's tools only, edits through
   the chokepoint, confined to its packet's files, told to escalate rather
   than guess. Evidence (diffs, IR changes, checks) is collected by the
   server, not reported by the worker.

**Models** (toolbar) sets which model does which kind of work — including a
local Ollama model for routine work.

## 9. Driving it from your own Claude Code session

The same tools the chat uses are served over MCP:

```bash
claude mcp add vibegraph --transport http http://localhost:4200/mcp
```

Then, in that session: *"trace the thread for `ingest_route`"*, *"what
is the blast radius of changing `normalize`?"*, *"state a constraint that…"*,
*"plan the work to…"*. Edits it makes go through the chokepoint too.

## 10. A good first session on your own code

1. `vibegraph-knowledge view your-project`, open the map, switch to **Bird's-eye**.
2. **Propose groups**, read what it cites, **Ratify** or **Modify**.
3. Open the busiest process's threads; follow one end to end.
4. Hover a few `dynamic` calls; **Observe** or **trace** where it matters.
5. State the two or three rules everyone on the team knows and the code does
   not say — with their reasons.
6. Draft and ratify skills for the threads you work on most.
7. Run `vibegraph-knowledge export` ([CLI.md](CLI.md)) so every Claude
   session in that repo starts from all of it.
