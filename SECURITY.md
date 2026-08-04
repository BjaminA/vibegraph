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

## What does NOT protect you

Stated explicitly so you can make your own call:

- **The HTTP and WebSocket endpoints are unauthenticated.** Anything that
  can reach the port can drive the MCP tools — which means editing and
  running code in your project. This is acceptable only because it binds to
  localhost. **Never set `VG_HOST` to a public interface**, and be aware
  that on a shared or multi-user machine, other local users can reach it.
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
