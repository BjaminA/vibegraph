# Setting VibeGraph up

This gets you from nothing to VibeGraph running on your own codebase, both
ways it can be used:

- **the visualisation** — a local web app you open in a browser
  ([VISUALISATION.md](VISUALISATION.md) walks through it);
- **the node commands** (`vibegraph-knowledge`) — a command-line tool that
  writes what VibeGraph knows about your code into files a plain Claude Code
  session reads before it edits ([CLI.md](CLI.md)).

Both read the same thing: an **IR** (intermediate representation) that
VibeGraph derives from your source. Neither needs the other.

> **Read [SECURITY.md](../../SECURITY.md) first.** The visualisation writes to
> your files, can execute your code (in a throwaway copy, behind a consent
> gate), and its Claude features send your source to Anthropic and cost money
> per turn. Point it at a **git repository with a clean working tree**, so
> anything it does is one `git diff` away from review.

---

## 1. What you need

| | Version | Needed for |
|---|---|---|
| **Node.js** | 20 or newer (24 is what VibeGraph is developed on) | everything |
| **npm** | the one that ships with Node | installing |
| **Python 3** | 3.10 or newer, as `python3` on your PATH | parsing Python, the edit chokepoint, runs |
| **git** | any recent | cloning; commit stamps in exports |
| **Claude Code** (`claude` CLI) | logged in (`claude` works in a terminal) | *optional* — chat, drafting, proposals, agent runs. Everything else works without it. |
| **curl** | any | only the first run, if your Python has no `pip` |

Operating systems: Linux and macOS work as-is. On **Windows, use WSL2**
(Ubuntu) and run every command inside the WSL shell — the parsers and the
launcher are POSIX shell and Python.

You do **not** need an `ANTHROPIC_API_KEY`: VibeGraph shells out to your
already-authenticated `claude` CLI.

Check what you have:

```bash
node --version      # v20 or later
python3 --version   # 3.10 or later
git --version
claude --version    # optional
```

## 2. Get VibeGraph

```bash
git clone https://github.com/BjaminA/vibegraph.git
cd vibegraph
npm install
```

`npm install` fetches the web app's dependencies and the pinned tree-sitter
grammars VibeGraph uses for TypeScript, bash, C++ and Rust.

The Python side needs two packages, `libcst` (the Python parser and
rewriter) and `black` (the formatter every edit is checked through). You do
not install them yourself: the first time you launch the visualisation,
`runVis.sh` installs them into `vibegraph/.pydeps/` — inside the clone, no
`sudo`, nothing added to your system Python. (If your Python has no `pip`,
it fetches `get-pip.py` into the same folder first.)

## 3. Check it works — on an example

Before pointing it at your code, run it on the bundled example:

```bash
./runVis.sh examples/pump-wear
```

The first launch installs the Python packages and builds the web app, which
takes a minute; later launches start in a few seconds. When you see the
server listening, open **<http://localhost:4200>**.

You should see a boot animation, then the **architecture map** of the example.
If you do, the visualisation is working. Stop it with `Ctrl-C`.

To check the node commands too:

```bash
npm run build:cli
node packages/knowledge/dist/cli.mjs export examples/pump-wear
ls examples/pump-wear/.vibegraph/knowledge/        # README.md, threads/, architecture.md, …
```

## 4. Point it at your own codebase

### The visualisation

```bash
./runVis.sh /path/to/your/project        # a whole project (a directory)
./runVis.sh /path/to/one_file.py         # or a single file
```

Then open <http://localhost:4200>. Continue with [VISUALISATION.md](VISUALISATION.md).

### The node commands

Install them once as a real command (until the package is on npm, from a
tarball you build here):

```bash
npm run build:cli                        # packages/knowledge/dist/cli.mjs + the vendored parsers
cd packages/knowledge && npm pack        # → vibegraph-knowledge-0.6.0.tgz
npm install -g ./vibegraph-knowledge-0.6.0.tgz
cd ../..
vibegraph-knowledge --version            # also installed as `vgk`
```

Then, in your project:

```bash
cd /path/to/your/project
vibegraph-knowledge init                 # points CLAUDE.md at the knowledge folder
vibegraph-knowledge export               # writes .vibegraph/knowledge/
```

Continue with [CLI.md](CLI.md). (You can skip the global install and call
`node /path/to/vibegraph/packages/knowledge/dist/cli.mjs …` directly.)

## 5. What VibeGraph reads

Languages, by file extension:

| Language | Files | Read | Edit | Run a node / trace |
|---|---|---|---|---|
| Python | `.py` | yes | yes | yes / yes |
| TypeScript / JavaScript modules | `.ts` `.tsx` `.mjs` `.cjs` | yes | yes | — |
| Bash | `.sh`, and extensionless scripts with a `#!` line | yes | yes | — / yes (with a fake `PATH`, nothing external runs) |
| C++ | `.cpp` `.cc` `.cxx` `.hpp` `.hh` `.hxx` `.h` | yes | — | — |
| Rust | `.rs` (Cargo layout) | yes | — | — |

Plain `.js`/`.jsx` files are deliberately not parsed yet.

Skipped: `node_modules`, virtual environments, `.git`, and compiled output
(`dist/`, `build/`, `.next/`, `.d.ts` files…). Anything skipped is **counted and
reported**, never dropped silently — the export's README names it.

What VibeGraph writes into **your** project, all under `.vibegraph/`:

| File | What it is | Who writes it |
|---|---|---|
| `knowledge/` | everything the node commands export for Claude | `vibegraph-knowledge export` |
| `constraints.json` | the rules you state (with their reasons) | you — GUI, MCP, or `vibegraph-knowledge constraints` |
| `architecture.json` | deployment / trust groups and names you state or ratify | you — GUI or `vibegraph-knowledge architecture` |
| `manual_seeds.json` | entry points you name that discovery cannot see | you — `vibegraph-knowledge seeds` |
| `thread-skills/` | per-thread guidance, model-drafted, human-ratified | GUI, MCP, or `vibegraph-knowledge skills` |
| `observations.json` | what consented trace runs saw | the visualisation's Trace / Observe |
| `models.json` | which model (or local Ollama) runs which work | the visualisation's Models panel |
| `work-run.json` | an Agent Manager run's state | the visualisation |

Add `.vibegraph/knowledge/` and `.vibegraph/observations.json` to your
`.gitignore` (`vibegraph-knowledge init` adds the first). Commit
`constraints.json`, `architecture.json` and `manual_seeds.json` if your team
should share them.

## 6. Settings

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `4200` | the visualisation's port |
| `VG_HOST` | `127.0.0.1` | the address it binds. Anything else exposes an **unauthenticated** server beyond your machine — the server says so loudly. |
| `VG_START_VIEW` | architecture map | set to `index` to open on the thread list instead |
| `VG_CLAUDE_BIN` | `claude` on your PATH | the command used for every model call (e.g. `claude --model …`) |
| `VG_PYTHON` | `python3` | the interpreter the node commands use |
| `VIBEGRAPH_PYDEPS` | — | a directory that already holds `libcst`, for the node commands |
| `VIBEGRAPH_KNOWLEDGE_HOME` | `~/.cache/vibegraph-knowledge` | where the node commands install `libcst` when it is missing |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | a local Ollama server, if you route a model tier to it |

Example: `PORT=4300 VG_START_VIEW=index ./runVis.sh ~/code/my-app`.

## 7. Troubleshooting

**"Chat, Analyze & Intent are disabled: the claude CLI is not on PATH".**
Everything deterministic still works. Install Claude Code, run `claude` once
to log in, and restart `runVis.sh` from a shell where `claude --version`
works.

**`libcst` install fails.** Check `python3 -m pip --version`. Behind a proxy,
set `HTTPS_PROXY` before the first launch. To use an existing environment,
install `libcst` and `black` into it and put it on `PYTHONPATH`.

**The page is blank or old after pulling.** `runVis.sh` rebuilds when the
source is newer than the build; to force it: `npm run build`.

**Port 4200 is taken.** `PORT=4300 ./runVis.sh …`.

**A file you expected is missing.** Check its extension against the table in
section 5, and whether it sits under a skipped directory — the export's
README lists every skipped directory with its file count.

**WSL: editing through `\\wsl.localhost`.** Scripts edited from Windows can
lose their executable bit; `chmod +x runVis.sh` restores it.

**The node commands say Python is missing.** They need `python3` for the
Python parser; set `VG_PYTHON=/path/to/python3` if it is not on your PATH.
