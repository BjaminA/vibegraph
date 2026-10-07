# Setting VibeGraph up

This gets you from nothing to VibeGraph running on your own codebase, both
ways it can be used:

- **Claude Code + hooks** — the node commands (`vibegraph-knowledge`) wire
  VibeGraph into your normal Claude Code sessions: each prompt gets the
  contracts and rules of the code it touches, and each edit is re-checked
  against the rules. No server runs ([§4](#4-claude-code--hooks--the-recommended-way),
  [CLI.md](CLI.md));
- **the visualisation** — a local web app you open in a browser
  ([VISUALISATION.md](VISUALISATION.md) walks through it).

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
vibegraph-knowledge --version            # 0.13.0 or later; also installed as `vgk`
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

## 4. Claude Code + hooks — the recommended way

```bash
cd /path/to/your/project
vibegraph-knowledge init --hooks --skill # the hooks, the skills, a CLAUDE.md block, a .gitignore line
vibegraph-knowledge export               # writes .vibegraph/knowledge/
ls .vibegraph/knowledge/                 # README.md, architecture.md, threads/, constraints.md, security.md, …
```

- `--hooks` writes four hooks into `.claude/settings.local.json` — per user,
  never committed. They run from the **next** Claude Code session (`/hooks`
  shows them): an orientation when the session starts; the contracts, rules
  and approved skills of the threads each prompt names; a re-check of every
  stated rule after each edit (Bash edits included) and at the end of each
  turn, where a **new** violation stops the edit with the rule and its reason.
  They spend no tokens and start no server. `--remove-hooks` takes exactly
  them out.
- **Claude Code on Windows, project in WSL** (you open
  `\\wsl.localhost\Ubuntu\…` from a Windows Claude): add `--windows`, run
  from the WSL shell with the CLI installed (`npm install -g`, not `npx`):

  ```bash
  cd ~/path/to/project && vibegraph-knowledge init --hooks --windows --skill
  ```

  Each hook is written as one `wsl.exe -d <distro> -e …` command, which Git
  Bash, PowerShell and cmd all run, and which a Claude inside WSL can still
  run. The hooks translate the Windows paths Claude Code sends
  (`\\wsl.localhost\Ubuntu\…`, `C:\…`). Paths are spelled `//home/…` on
  purpose: Git Bash rewrites `/home/…` before it reaches WSL. A hook costs
  about 0.7 s through `wsl.exe`. `vibegraph-knowledge hook install --target
  wsl` installs the same hooks without the `CLAUDE.md` block.
- **Check they work:** in the next session, `vibegraph-knowledge doctor` says
  whether the hooks are installed, can run from this side, and have fired
  since they were installed. `vibegraph-knowledge hook run post-edit --file
  <path>` (or `hook run prompt --prompt "…"`) fires one by hand with the
  payload built for you, and exits as the hook would (0, or 2 when it blocks).
- `--skill` installs `/vibegraph` (set-up and use) and the task skills
  `/vibegraph-plan`, `-debug`, `-security` and `-review`. `--skills
  plan,security` picks some; `--user` installs them for every project on the
  machine.
- Add the rules your team knows, **with the reason**
  (`vibegraph-knowledge constraints add …`, [CLI.md](CLI.md)); give each a
  `--check` where the rule can be checked, so the hooks enforce it.
- Re-run `export` after larger changes, and `vibegraph-knowledge check
  --uncommitted` before committing.

Without `--hooks`, `init` only points `CLAUDE.md` at the knowledge folder.
Claude may read it, but nothing makes it, and nothing checks the edits.
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
| `VG_THREAD_RANK` | `primary` | how much of a thread is drawn at first: `primary`, `secondary` or `all` (the canvas switch overrides it, and is remembered) |
| `VG_CLAUDE_BIN` | found for you (below) | the Claude Code used for every model call: a path (used whole — spaces are fine), a JSON array `["<path>","--model","opus"]`, or a quoted command line |
| `VG_CLAUDE_ARGS` | — | extra arguments for every Claude call (e.g. `--model sonnet`) |

**How Claude is found** (one resolver, `src/server/find_claude.ts`, for every
call): `VG_CLAUDE_BIN`, then the saved `vibegraph-knowledge config set
claude.bin "<path>"` (per user — no environment to edit), then PATH searched
the way the OS does (on Windows each `PATHEXT` extension; npm's `claude.cmd`
wrapper is followed to the package's own `claude.exe`, never run through
`cmd`), then where Claude Code installs itself: the native installer
(`~/.local/bin`, `%USERPROFILE%\.local\bin`), npm's global package folder,
Homebrew, `~/.claude/local`, and last the VS Code / Cursor extension's bundled
binary. It is always started without a shell, so a prompt reaches it exactly
as written. `vibegraph-knowledge doctor` says which Claude was found and how;
when none is, the message lists every place it looked.
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

**The hooks never seem to run.** `vibegraph-knowledge doctor`. Hooks apply
from the session after they were installed. "Never fired" with a session
since usually means a Windows-side Claude Code against a WSL project with
hooks that hold Linux paths: reinstall from the WSL shell with `hook install
--target wsl`. "does not exist here" means the CLI the hooks name moved
(reinstall them).

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
