# Security

VibeGraph runs an LLM agent with **unattended write access to your source
tree**. That is the point of the tool, and it is also the main thing you
need to understand before running it. This document states plainly what it
does, what protects you, and what does not.

Read the first two sections before you run `./runVis.sh` on a codebase you
care about.

## What VibeGraph does on your machine

- **It spawns the `claude` CLI with `--dangerously-skip-permissions`**, with
  the working directory set to **the project you pointed it at**. Every
  drafting path does this: the chat panel, the greenfield builder,
  architecture/roadmap drafts, dynamic READMEs, and synthetic-input
  generation. The flag means Claude is not asked to confirm individual tool
  calls.
- **It writes to your files.** Chat edits, editor saves, Intent-mode
  proposals and builder increments all land on disk in the analyzed project.
- **It executes your code** when you use "run to this node". Execution
  happens in a throwaway copy of the project (`makeRunSandbox`), not in your
  working tree — but the code that runs is yours, and it runs on your
  machine with your privileges.
- **It costs money.** Every chat turn and every draft is a billed Claude
  API/CLI call. A single greenfield build can be several dollars.
- **It sends your code to Anthropic.** Source, IR and prompts leave your
  machine via the `claude` CLI. Do not point it at code you are not
  permitted to send to a third-party model provider.

**Recommended practice: run VibeGraph on a git repository with a clean
working tree, so any edit it makes is one `git diff` away from review and
one `git checkout` away from being undone.** Do not run it on a directory
that is not under version control.

## What actually protects you

These are real, enforced mechanisms — not intentions:

- **A single edit chokepoint.** Every write goes through
  `scripts/cst_rewrite.py`: parse → apply a structural operation → verify
  the resulting diff is confined to the node that was targeted → write.
  There is no line splicing and no regex rewriting anywhere in the edit
  path. An edit that would change code outside the targeted node is
  refused, and the file is left untouched.
- **The chat cannot bypass it.** The chat child is spawned with
  `Edit`, `Write`, `MultiEdit` and `NotebookEdit` disallowed, so file
  writes can only reach disk through the verified path.
  **Caveat: `Bash` remains available** (the agent uses it to verify its
  own changes), so a determined model could still write via a shell
  command. This is a deliberate trade, not an oversight — treat it as a
  strong guardrail, not a sandbox.
- **An effect floor on execution.** `scripts/scan_effects.py` walks the
  interprocedural call path before anything runs and refuses when it
  cannot prove the path is free of side effects. Effects that are found
  are surfaced for explicit consent rather than assumed benign; consent
  tokens are bound to content hashes and their secret resets on reboot.
- **Human ratification gates.** LLM-proposed edits are never auto-applied.
  Architecture, roadmaps, changesets and thread skills all require an
  explicit human accept.
- **Localhost by default.** The server binds `127.0.0.1`. `VG_HOST` opts
  out and prints a warning when it does.
- **Only this app's own page may drive it** (`src/server/local_guard.ts`).
  Binding to localhost keeps other machines out but not a web page open in
  your browser, and a WebSocket is not covered by CORS. So every request's
  `Host` must be the server's own loopback name (a DNS-rebinding site is
  refused with 403); a browser's WebSocket and `/mcp` requests must come from
  the app's own origin; `POST /mcp` must be `application/json` (so a page
  cannot send it as a preflight-free "simple" request); and static files are
  served only from the bundle directory. Non-browser clients (a Claude Code
  session, `curl`) send no `Origin` and are allowed — they are local
  processes that already have your file access.
- **Copies stay out of git.** Anything VibeGraph stores that holds copies of
  your code or runtime data — the Agent Manager's snapshots, a run's diffs,
  trace observations, the knowledge export — is listed in a
  `.vibegraph/.gitignore` it writes itself, whatever your own `.gitignore`
  says.
- **No telemetry.** VibeGraph itself sends nothing anywhere. The only
  outbound traffic is the `claude` CLI (below), the one-time download of
  libcst from PyPI (or npm, when run with `npx`), and a local Ollama
  endpoint if you route a model tier to one.

## Dependencies (audited 2026-09-29)

- **The npm package** installs one dependency, `web-tree-sitter`, with no
  install scripts in it or in the package itself (`npm audit`: 0). The app
  it ships (`vendor/`) is prebuilt; its bundled dependencies are audited from
  the lockfile it was built from (`npm audit`: 0 — `ws`, the MCP SDK's
  transitive `hono` / `qs` / `fast-uri` / `ip-address`, and the editor's
  `dompurify` were updated; the unused `puppeteer` was removed).
- **Python**: the command line installs `libcst` (1.x) — and, for editing in
  the app, `black` (24–26) — into a directory it owns, from **prebuilt wheels
  only** (`pip --only-binary=:all:`), so no package's build script runs at
  install time; each is bounded to its tested major version. `pip-audit`: no
  known vulnerabilities.
- Re-run the audit before a release: `npm audit` in the repository and in a
  fresh install of the packed tarball, and `pip-audit -r
  packages/knowledge/requirements.txt`.

## What does NOT protect you

Stated explicitly so you can make your own call:

- **The HTTP and WebSocket endpoints are unauthenticated.** Any local
  process that can reach the port can drive the MCP tools — which means
  editing and running code in your project (web pages are refused, above).
  This is acceptable only because it binds to localhost. **Never set
  `VG_HOST` to a public interface** (it also relaxes the Host check), and be
  aware that on a shared or multi-user machine, other local users can reach
  it.
- **Which features send code to Anthropic.** Browsing, the diagrams, the
  threads, the checks, the hooks' own work, `export` and `check` are all
  local and spend no tokens. Anything that starts a Claude session sends
  what that session reads: the chat, the Agent Manager (hooked or
  orchestrated), skill drafting, README generation, Scope, architecture
  proposals, `classify`, drafted example inputs. A Claude Code session you
  run yourself with the hooks sends what it reads, as it would without them.
  Route a tier to a local Ollama model to keep that work on your machine.
- **The Agent Manager's Claude Code run is not sandboxed.** It runs
  `claude -p --dangerously-skip-permissions` in your project: Claude can
  read, write and run commands there without asking. The snapshot and your
  Accept / Reject undo its file changes; they cannot undo a command's side
  effects outside the project.
- **The chokepoint confines *structure*, not *intent*.** It guarantees an
  edit changed only the node it claimed to. It cannot tell you the change
  was a good idea, or correct. Review the diff.
- **`--dangerously-skip-permissions` is not sandboxed.** Within the analyzed
  project, the agent acts without per-call confirmation.
- **No secrets scanning.** If your source contains credentials, they are
  part of what gets sent to the model.

## Reporting a vulnerability

Please report security issues privately by email to the maintainer rather
than opening a public issue. Include reproduction steps and the commit you
tested. There is no bug bounty; this is a personal project.

Especially wanted: any path that writes to disk **without** passing through
`scripts/cst_rewrite.py`'s confinement check, or any way to make that check
pass on an edit that changes code outside the targeted node. Those are the
load-bearing guarantees — a break in either is the highest-severity class of
bug in this codebase.
