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
| **git** | any recent | commit stamps in exports; cloning, only to work on VibeGraph itself |
| **Claude Code** (`claude` CLI) | logged in (`claude` works in a terminal) | *optional* — chat, drafting, proposals, agent runs. Everything else works without it. |
| **pip** | the one with your Python | the first run installs `libcst` and `black` with it |

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

## 2. Install — one npm package

```bash
npm install -g vibegraph-knowledge
vibegraph-knowledge --version            # 0.8.0 or later; also installed as `vgk`
```

(Or run any command without installing: `npx vibegraph-knowledge <command>`.)

That one package holds both halves: the visualisation (`view`) and the
knowledge commands (`init`, `export`, `check`, …). It carries its own parsers
and the prebuilt app. The one thing it needs from your system is `python3`
(3.10+): the first run installs `libcst` (the parser) — and, for `view`,
`black` (the formatter every edit goes through) — into
`~/.cache/vibegraph-knowledge`. No `sudo`, nothing added to your system Python.
Point it elsewhere with `VIBEGRAPH_KNOWLEDGE_HOME`, or at an environment that
already has them with `VIBEGRAPH_PYDEPS`. If your Python has no `pip`, install
it first (`python3 -m ensurepip --user`, or your system's `python3-pip`).

## 3. The visualisation — `view`

```bash
vibegraph-knowledge view /path/to/your/project    # a whole project (a directory)
vibegraph-knowledge view /path/to/one_file.py     # or a single file
vibegraph-knowledge view . --open --port 4300     # open the browser for you, on another port
```

The first run provisions Python (about a minute); later starts take a few
seconds. When it prints **VibeGraph is running!**, open
**<http://localhost:4200>**. You should see a boot animation, then the
**architecture map** of your project. `Ctrl-C` stops it.

The code editor (Monaco) loads from a CDN, so viewing and editing code needs an
internet connection; everything else works offline.

Continue with [VISUALISATION.md](VISUALISATION.md).

## 4. The knowledge commands — hand it all to Claude

```bash
cd /path/to/your/project
vibegraph-knowledge init                 # one marked block in CLAUDE.md, + .gitignore line
vibegraph-knowledge export               # writes .vibegraph/knowledge/
ls .vibegraph/knowledge/                 # README.md, architecture.md, threads/, constraints.md, …
```

Now open Claude Code in the project as you normally would: `CLAUDE.md` tells
it to read `.vibegraph/knowledge/README.md` first. Add the rules your team
knows (`vibegraph-knowledge constraints add …`), re-run `export` when the code
or the rules change, and run `vibegraph-knowledge check` before committing.
Everything else is in [CLI.md](CLI.md).

Both halves read and write the same `.vibegraph/` folder in your project, so
rules you state in the browser are what `export` hands to Claude, and rules
you add with the commands appear in the browser.

### From a clone (to work on VibeGraph itself)

```bash
git clone https://github.com/BjaminA/vibegraph.git
cd vibegraph
npm install
./runVis.sh examples/pump-wear           # the same app, built from source; installs into vibegraph/.pydeps/
npm run build:cli                        # the package, from source: packages/knowledge/
```

## 5. What VibeGraph reads

Languages, by file extension:

| Language | Files | Read | Edit | Run a node / trace |
|---|---|---|---|---|
| Python | `.py` | yes | yes | yes / yes |
| TypeScript / JavaScript modules | `.ts` `.tsx` `.mjs` `.cjs` | yes | yes | — |
| Bash | `.sh`, and extensionless scripts with a `#!` line | yes | yes | — / yes (with a fake `PATH`, nothing external runs) |
| C++ | `.cpp` `.cc` `.cxx` `.hpp` `.hh` `.hxx` `.h` | yes | yes | — |
| Rust | `.rs` (Cargo layout) | yes | yes | — |

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
| `VG_PYTHON` | `python3` | the interpreter the knowledge commands use (`view` always runs `python3`) |
| `VIBEGRAPH_PYDEPS` | — | a directory that already holds `libcst` (and `black`, for `view`) |
| `VIBEGRAPH_KNOWLEDGE_HOME` | `~/.cache/vibegraph-knowledge` | where the package installs `libcst` and `black` when missing |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | a local Ollama server, if you route a model tier to it |

Example: `VG_START_VIEW=index vibegraph-knowledge view ~/code/my-app --port 4300`.

## 7. Troubleshooting

**"Chat, Analyze & Intent are disabled: the claude CLI is not on PATH".**
Everything deterministic still works. Install Claude Code, run `claude` once
to log in, and restart `view` from a shell where `claude --version` works.

**`libcst` or `black` install fails.** Check `python3 -m pip --version` (no
pip: `python3 -m ensurepip --user`, or install your system's `python3-pip`).
Behind a proxy, set `HTTPS_PROXY` before the first run. To use an environment
that already has them, point `VIBEGRAPH_PYDEPS` at it. Without `black`, `view`
still starts — it says so — and refuses edits until `black` 24+ is importable.

**`view` says python3 is not on your PATH.** The app runs its parser, edits
and runs through `python3` by that name; install Python 3.10+ so `python3
--version` works.

**Port 4200 is taken.** `vibegraph-knowledge view . --port 4300`.

**The code panels stay empty.** The code editor loads from a CDN
(jsdelivr); check the browser can reach it.

**A file you expected is missing.** Check its extension against the table in
section 5, and whether it sits under a skipped directory — the export's
README lists every skipped directory with its file count.

**From a clone: the page is blank or old after pulling.** `runVis.sh`
rebuilds when the source is newer than the build; to force it: `npm run build`.
On WSL, a script edited through `\\wsl.localhost` can lose its executable bit;
`chmod +x runVis.sh` restores it.
