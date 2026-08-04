# VibeGraph

> Codename **CodeCanvas**. A visual Python codebase editor that renders a file as a shape-grammar node graph and lets you edit through direct manipulation or by driving it from a Claude Code session over MCP.

The on-disk file is the single source of truth. The graph is a projection.

> **Before you run this on your own code — read [SECURITY.md](SECURITY.md).**
> VibeGraph spawns the `claude` CLI with `--dangerously-skip-permissions` in
> the project you point it at, writes to your files, executes your code (in a
> sandbox copy), sends your source to Anthropic, and costs money per turn.
> Every edit is confined by a structural CST chokepoint and every proposal
> needs a human accept — but run it on a **git repo with a clean working
> tree** so anything it does is one `git diff` from review.

**Requires an authenticated [Claude Code](https://claude.com/claude-code) CLI
on your `PATH`.** VibeGraph shells out to `claude` for chat, drafting and
README generation; it does not need its own `ANTHROPIC_API_KEY`. Everything
except those LLM features works without it.

## Quick start

```bash
git clone https://github.com/BjaminA/vibegraph.git
cd vibegraph
npm install
./runVis.sh test/fixtures/sample_advanced.py
```

`runVis.sh` bootstraps Python deps into `.pydeps/` (libcst + black, no `sudo` needed), runs `node esbuild.mjs` if `dist/` is stale, and starts the WebSocket server. Open <http://localhost:4200> in a browser.

Pass a directory to load a multi-file project:

```bash
./runVis.sh test/fixtures/threads/aero_demo
./runVis.sh test/fixtures/scale/src   # the 29-file Django-admin benchmark fixture
```

### Drive VibeGraph from Claude Code (M7 wave 1)

The runtime exposes an MCP server at `http://localhost:4200/mcp` so a Claude Code session in your terminal can read the project IR, drive selection in the webview, and run CST rewrites without VibeGraph needing its own `ANTHROPIC_API_KEY`. Register once per project:

```bash
claude mcp add vibegraph --transport http http://localhost:4200/mcp
```

Then in a Claude Code chat: *"show me the IR for `models.py`"*, *"select `calculate_area`"*, *"rename `calculate_area` to `compute_area`"* — Claude calls the relevant `vibegraph_*` tool and the webview reflects the result. The in-webview chat panel (M25 revival) takes exactly the same loop: each message spawns `claude -p` with an inline MCP config pointing back at this server, so chatting in the GUI behaves like a terminal Claude Code session — streaming, tool-use cards, multi-step edits.

## The three views

A persistent toolbar switches between:

- **Diagram** — the pseudo-code shape grammar (functions as capsules, classes as containers, for-loops with a rotational arrow, if-statements with a diamond head, etc.). React-Flow renderer.
- **Code** — read-only Monaco panel with a `vibegraph-dark` theme derived from the same CSS tokens as the diagram view. Selection on either side cross-highlights the other.
- **Thread** — a single logic thread traced statically forward from a seed function (data fetch → processing → library boundary → return), with d3-force layout, dashed edges where the call is conditional, and explicit "stops here — external" terminals at scope boundaries.

LLM-backed features (the chat panel, Analyze, the editor panel's Intent mode, README generation) route through the user's existing Claude Code subscription by spawning `claude -p`. No `ANTHROPIC_API_KEY` is required; if the `claude` CLI isn't on `PATH` the runtime surfaces a banner instead of failing silently.

## Tests

```bash
npm test                # full suite: IR snapshot + thread + CST rewriter + Playwright
npm run test:ir         # parse_cst.py snapshot vs. sample_advanced.ir.json
npm run test:thread     # extract_thread.py snapshot vs. aero_demo.thread.json
npm run test:cst        # CST rewriter ops (replace, insert, delete, rename-in-scope)
npx playwright test     # webview + round-trip + capture specs
```

Scale benchmark (gated separately so `npm test` doesn't pay the cost):

```bash
VG_BENCH=1 VG_FIXTURE=test/fixtures/scale/src \
  npx playwright test test/e2e/m6-scale-benchmark.spec.ts
```

The benchmark prints first-render timings; react-flow held up on a 29-file
Django admin, which is why the renderer was not replaced.

## What it does

| | |
|---|---|
| **Code view** | Monaco, read-only, `vibegraph-dark` |
| **Diagram view** | functions / classes / control flow / DB calls as connected nodes |
| **Thread view** | one logic thread traced statically across files, branch-stacked left-to-right |
| **System view** | subsystems and how they relate |
| **Arch view** | PyTorch model schematics with parameter counts |
| **Edits** | Monaco saves, chat rewrites and drafted inserts all route through a libcst CST patch with format-and-diff confinement — no line splicing, no regex rewrites |
| **Run to here** | executes the real code up to one node and shows the value it produced, naming any synthesized input |
| **MCP** | mounted at `/mcp` on the same process, so a terminal Claude Code session drives the same code path as the built-in chat |

Two worked examples live in [`examples/`](examples/): a finished project to
explore, and the same brief built from an empty folder.

## Design notes

- [`design/COLOURS.md`](design/COLOURS.md) — the palette and its semantics.
- [`design/ICONS.md`](design/ICONS.md) — the icon set and what each construct gets.
- [`schemas/ir.schema.json`](schemas/ir.schema.json) — the IR contract:
  `{nodes, edges, symbolIndex}` with a regex-pinned structural node-ID grammar.
  Node IDs are structural paths (`module/Shape.class/area.fn/return@0`), never
  line numbers, so they survive edits above them.

## Layout

```
server.ts                  WebSocket runtime (single canonical entrypoint)
scripts/
  parse_cst.py             libcst parser, single-file CLI + --batch project mode
  cross_file_link.py       M4a project-wide symbol index + cross-file reference edges
  cst_rewrite.py           structured edit ops with format-diff verification
  extract_thread.py        static forward-trace thread extractor
  synth_scale_fixture.py   M6 scale_50 fixture generator
schemas/ir.schema.json     pinned IR shape
src/
  shared/protocol.ts       server ↔ webview wire protocol
  webview/                 React + React Flow + Monaco frontend
    nodes/                 one component per construct (ForLoopNode.tsx, IfNode.tsx, ...)
    threads/               thread-view d3-force renderer
    styles/tokens.css      canonical design tokens
test/
  fixtures/                sample_advanced.py + aero_demo + big_demo + scale_50
  e2e/                     Playwright specs
```

## Security

VibeGraph runs an LLM agent with unattended write access to your source tree.
See [SECURITY.md](SECURITY.md) for what it does on your machine, what
protects you (the CST edit chokepoint, the effect floor, human ratification
gates, localhost binding), and what does not (the endpoints are
unauthenticated; `Bash` stays available to the agent).

## License

MIT — see [LICENSE](LICENSE).
