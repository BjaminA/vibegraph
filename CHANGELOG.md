# Changelog

`vibegraph-knowledge` and the VibeGraph app. Newest first. Each entry says what
changed and, where an existing user would notice, how behaviour differs.

## 0.41.0 (2026-10-23): rules checked against the code, what was not read, services from evidence

### Every written rule accounted for, and ratified rules that survive a re-init

Rules a person wrote down were dropped by ranking, caps and filters, and
nobody was told: a "Rules" section of CLAUDE.md weighed what a docstring
weighed, a draft round always showed the same top 25 sentences, re-running
the setup forgot ratified rules, and `loadConstraints` dropped an entry it
could not read in silence.

- **Tiers** (`src/server/rule_sources.ts`): a rule section of CLAUDE.md or
  AGENTS.md is read first and never cut by the score threshold; then the rest
  of the prose; then module headers and docstrings.
- **The rule-coverage ledger** (`src/server/rule_ledger.ts`,
  `constraints ledger`): every rule sentence of a tier-one section gets an
  outcome: ratified as cN, proposed as cN, merged into cM, shown to the next
  draft, queued behind a round's cap, or out of reach (it names nothing
  parsed; such sentences were dropped before anyone saw them). A sentence a
  docstring repeats is named once, with where else it is written. The setup's
  rules step says it in one line.
- **Caps queue instead of discarding**: a draft round is shown the 25
  sentences no rule covers yet, so the next round reaches the next ones.
- **Folders and packages qualify**: a dotted package (`app.net`) is its folder,
  and a folder is an allow-list in a suggested check ("only `lib/db/` imports
  `sqlite3`" gets `import-only` on that folder); the dossier now shows the
  model the check a harvested sentence fits.
- **Re-initialisation**: each save keeps the ratified rules in the project's
  cache folder (`src/server/rule_backup.ts`; a hand-kept copy beside
  constraints.json is read too), and `constraints restore` offers back the
  ones constraints.json no longer holds (`--all` / `--take` to put them back;
  a person's step). With no rules and some to restore, the setup asks for that
  first.
- **What could not be read is named**: `droppedConstraints` lists each entry
  this version could not read, with why; `check`, the ledger and the setup
  say so (the file keeps them, as before).

Tests: test:rule-ledger (6, `test/fixtures/rules/written_demo` in Python and
TypeScript: five written rules, one folder-level, one naming nothing parsed,
one repeating a docstring).

### One place for everything kept outside the project, and hooks that carry it

The envelope cache, the server's cache and the Python dependencies each had
their own precedence, and the Claude version check wrote to a hard-coded
`~/.cache`; hooks pinned only the Python, so keeping the cache inside a
project meant editing every hook command by hand, and re-running the setup
undid the edits. One resolver now (`resolvePaths` in `scripts/cache_dir.mjs`),
with one precedence: the project's `.vibegraph/config.json` `cacheDir`, then
`VG_CACHE_DIR`, then `$XDG_CACHE_HOME/vibegraph-knowledge`, then
`~/.cache/vibegraph-knowledge`. It returns the envelopes, the server cache,
the Python dependencies (`VIBEGRAPH_KNOWLEDGE_HOME` still wins) and the Claude
version file, and every caller uses it. A directory `VG_CACHE_DIR` names keeps
the layout it always had, so no cache, hook record or lesson moves. Installed
hooks pin every one of these variables that is set, and a re-install keeps
what an earlier one pinned; `doctor` prints the effective paths and where the
cache root came from. Tests: test:resolve-paths (4: with `VG_CACHE_DIR` set,
setup, hook install and the Claude check write nothing under `~/.cache`, and a
re-install from a shell without it keeps it in every hook).

### A failed model call says why, and what fixes it

An expired Claude login made several setup steps fail one after another with
"the model returned nothing — claude exited 1: Failed to authenticate…", and
the fix was offered on some paths only. One table
(`src/shared/model_failure.ts`) classifies a failure from what the CLI said,
on stderr or in its JSON `is_error` result, into a kind with its remedy:
**auth** (log in again with `/login`, or set `CLAUDE_CODE_OAUTH_TOKEN`),
**not-installed**, **rate-limit**, **timeout**, **bad-output** and **exit**.
The server's runner records it once (`src/server/model_failure_state.ts`),
and every caller that reported "the model returned nothing" (classify, the
software spec, the groups, the Brief, rules, node scope) now says the kind
and the fix; the command line's spawn uses the same table. Before a setup run
that spends, one short model call checks the model works: if it fails, the
steps that need the model are held back and listed once with the reason,
instead of each failing, and the steps that need none (the direction census)
still run. Tests: test:model-failure (5, with a stub `claude` whose login has
expired).

### Variables a platform sets are not undeclared configuration

The environment census listed `GITHUB_ACTIONS`, set by GitHub's runner,
beside genuinely undeclared project variables, so a rule that every variable
read is declared could never pass. A data table of platform-provided names
(`src/shared/platform_env.ts`: GitHub Actions, any CI runner's `CI`, GitLab,
CircleCI, Travis, Buildkite, Cloudflare Pages, Vercel, Netlify, Fly.io,
Render, Railway, Cloud Run, Kubernetes, Claude Code; each row from the
platform's own list, and it can grow) marks a variable "provided by
<platform>" and keeps it out of `undeclared` everywhere the census is read:
`configuration.md`, each contract's "Configured by" line, the GUI's insight
chips and the Configuration lens. A credential (`_TOKEN`, `_KEY`, `_SECRET`,
`_PASSWORD`) is never platform-provided, whatever its prefix. Tests:
test:platform-env (3, `test/fixtures/env/platform_demo` in Python and
TypeScript: only `MY_API_KEY` is undeclared).

### A funnel rule is checked by what the funnel calls

A funnel's `wraps` listed every wrappable tool its file imported, cut to the
top-level package, so a module importing `http` for a cookie jar and making
its requests with `urllib.request.urlopen` read "wrapping http, urllib", and a
model checking "all HTTP goes through the funnel" could pick `import-only
http`: a check that passes whatever bypasses the funnel.

- **What the funnel calls** (`src/server/funnel_calls.ts`): `wraps` now holds
  the tools the funnel makes calls through that leave the project (a call the
  parser stamps with an effect; constructing an object is not one), and a new
  `calls` field holds each by full dotted name, read through the file's
  imports (`src/shared/call_names.ts`: `urlopen` after `from urllib.request
  import urlopen` is `urllib.request.urlopen`). A funnel whose calls no rule
  reads keeps what it imports, as before.
- **The default check, derived** (`src/server/funnel_checks.ts`): for a
  standard-library namespace, `callers-only` on each function that leaves
  (`urllib.parse` elsewhere is not a bypass); for any other package,
  `import-only` (a funnel often constructs a client and calls the instance, so
  importing the package anywhere else is the bypass). The funnel and any
  stated exception are allowed. The drafting gate gives a rule resting on a
  funnel this check when it has none, and replaces a trivial one; the prose
  harvest suggests it.
- **A trivial check is said**: a check on a tool the funnel imports but makes
  no call through is flagged on every `check` (`trivial` on the row) and on
  the rule's card, "Checked, but this check cannot catch a bypass", never
  counted as enforcement.
- External call facts carry the full name, so `callers-only` on
  `urllib.request.urlopen` matches however the import was spelled.

Tests: test:funnel-checks (6, `test/fixtures/funnel/funnel_demo` in Python and
TypeScript: each funnel imports two libraries and calls one function of one;
the derived check passes, then fails once a second module calls it);
test:rule-draft's dossier line now names what the funnel calls.

### Services behind programs, constants and deploy files, and names they must support

The boundary model ended at the first library call: `subprocess.run([binary,
…])` left through `subprocess`, a URL held in a constant was "unknown", and
deploy configs were not read, so the service behind a command-line client
vanished and a model filled the gap from the docs, sometimes on the wrong box.

- **The program a launch runs** (`src/server/process_launches.ts`, followed by
  `src/server/launch_args.ts`): a Python or TypeScript launch's first argument
  resolved from a literal, a constant, an env default
  (`os.environ.get("X", "gh")`, `process.env.X ?? "gh"`), a `which()` lookup,
  a parameter to the calls that fill it (`def sh(args)` called as
  `sh(["gh", …])`), an attribute to the construction that sets it
  (`self.binary`), or a factory to what it returns; three hops at most, and
  anything else is listed as unresolved with its text. The stack index records
  the program at the launching call (evidence `exec`) and the boundary leaves
  through it, not through `subprocess`; a helper whose callers run different
  programs decides nothing at its own launch, and each caller carries its
  program. An unknown program is still a program ("runs pagemaker"). `git`,
  `gh` and the platform CLIs gained roles in the shell's table.
- **Deploy files and workflows read as facts** (`infra_manifests.ts`): wrangler,
  Vercel, Netlify, Fly (and what each names), every workflow step, `run: |`
  blocks included. The architecture proposal can cite them. The manifest walk
  now honours `.vibegraphignore` (an archived copy's deploy files were read as
  current), and the inventory reads each deploy file and workflow whole, so
  the prompt's 400-fact cap can no longer drop a platform.
- **The service inventory** (`src/server/service_inventory.ts`, data in
  `src/shared/service_tables.ts`): every service with its evidence and what it
  is reached through, from programs, hosts a request names (directly or
  through a constant or env default), credentials a vendor's SDK reads, and
  deploy files and workflows. A host no table knows is listed as the host.
  `vibegraph-knowledge services`; the export writes `services.md`.
- **A name must be supported** (`arch_propose.ts`): the proposal prompt lists
  the services and what each is reached through, and a display name that
  names a service or program its node has no evidence for is refused with the
  reason ("names GitHub, which no evidence reaches through urllib").

Tests: test:service-inventory (6, `test/fixtures/services/svc_demo` in Python,
TypeScript and bash).

### VibeGraph says what it did not read, and reads JavaScript the evidence names

A file type outside the language table disappeared without a word: a page
whose whole app is one inline script, or the Worker that serves a site, was
never parsed while the output still read as complete. Three changes:

- **One walk** (`src/server/source_walk.ts`) for the server, the CLI and the
  envelope cache, which each had their own. It returns the files to parse and
  a **coverage ledger** (`src/shared/coverage_ledger.ts`) of every file it
  saw: read (with why, for a `.js` or a page), read and failed, not read with
  why, code no frontend reads (SQL, notebooks, Dockerfiles, workflows, other
  languages), folders skipped, and documents, data and assets.
- **`.js`/`.jsx` read on evidence** (`src/server/source_admission.ts`), never
  by extension alone: named by a run or deploy config (wrangler, Procfile,
  Vercel, Netlify, Fly, pm2, a workflow `run:`), by `package.json`
  (main, module, browser, bin, exports, scripts), imported by a parsed file
  or loaded by a page, a Worker (`export default { fetch }`), or a `#!` node
  script. Minified, bundled, vendored and compiled-from-`.ts` files stay out
  whatever names them. A web frontend nothing names (the system tier's
  text-scanned case) stays out too.
- **A page's inline scripts are parsed** (`scripts/frontends/inline_scripts.mjs`)
  as one module, everything else blanked with line breaks kept, so every
  node's line is its line in the page; the IR carries `embedded` (schema'd,
  field-additive). A page is read, never edited. A Worker's handlers
  (`defaultExportMember`, field-additive) and a page are entry points.

Where it shows: `vibegraph-knowledge coverage` with no files prints the
ledger; the export writes `coverage.md` and puts "Not analysed: N files, M
lines" on the README and `architecture.md`; the map legend says it; the setup
gains an optional first step, "What VibeGraph did not read". A project with
no admissible `.js` and no page sees the same IR as before. Also:
`test:lang-audit` had been red since two genuinely Python-only rules arrived
(Python module resolution, Python package manifests); they are now
allowlisted with their reason. Tests: test:coverage-ledger (8, a synthetic
Python and JavaScript site in `test/fixtures/coverage/site_demo`);
test:languages updated (`languageForPath` names the frontend that reads an
admitted `.js`; the walk still never reads one by extension).

### A drafted rule's claims about the code are checked before it is stored

A model drafting rules from the architecture wrote what the code does as
prose, and the gate stored it unread: "the nightly job runs only these two
scripts" for a script that runs more, "writes only the `codes` field" for a
function that also writes others, "this folder never touches the
network" over a folder with one networked module. A rule now carries typed
**claims** beside its sentence (`src/shared/rule_claim_types.ts`): runs-only,
writes-only, imports-only, never-calls, reaches. Each is decided against the
code before the rule is stored (`src/server/rule_claims.ts`, the gate in
`src/server/rule_draft_claims.ts`):

- **verified**: kept as a check clause `{rule: "claim", …}`, so `check`, the
  hooks and the Rules panel decide it again after every edit;
- **contradicted, with what the code shows**: the rule's sentence is
  rewritten from the code, and the clause keeps what the model said (`was`),
  shown on the card as "Corrected from the code: Claude said …; the code
  shows …";
- **contradicted over a folder**: the scope narrows to the files that keep
  it, and the files that break it are named;
- **contradicted, with nothing the code can correct**: the rule is refused;
- **unverifiable**: the rule stays prose and the card says what could not be
  decided. It is refused when its own reason names a file its claim leaves
  out.

A sentence that says what the code does ("only", "never") with no claim and
no check is labelled "nothing checked it against the code". Rules already
stored are unchanged; the next draft gets the new prompt.

To read what a function writes, a Python assignment to a subscript
(`record["sources"] = …`, whose `name` is "?") now carries its target's
source text as `targetText` (field-additive, no version bump; node ids
unchanged; four snapshots regenerated, only the new field). Tests:
test:rule-claims (17, synthetic Python and TypeScript projects in
`test/fixtures/claims/`).

### A ratified software spec outranks a model's classification

A package's role decides whether it is a box on the architecture map and of
what kind, so it shapes the groups proposed around it. A ratified spec only
filled packages nothing else had named, so a `classify` answer (a model's,
unreviewed, which the setup runs first) kept its role after a person
ratified a spec saying otherwise. The order is now: a role a person stated
(a stack policy) > a ratified spec > the orchestrator's > a model's
classification (`src/server/stack.ts`). Tests: test:software (+2 checks, red
on the old order).

### A rule in plain words

The Rules panel's WHY showed the drafting gate's note ("proposed from the
architecture (claude:default); rests on crossing:1, crossing:3, …"), while a
drafted rule's real reason sat at the end of its text as "(why: …)". Each
card now reads (`src/shared/rule_readable.ts`; the stored rule is unchanged,
so a hooked Claude Code session still gets the reason with the rule):

- **why**: the reason, taken from the rule's "(why: …)", which leaves the
  title and the rule's text.
- **checked**: whether VibeGraph checks it, in words: "Not checked
  automatically: VibeGraph's map of the code has no definition of `X` and no
  call to it, so a check could only ever say it cannot tell. Claude Code is
  told the rule; no edit is blocked by it."; "Checked, and the code breaks it
  today: …"; nothing when its check row already says.
- **from**: the one sentence of the quoted source that the rule is about,
  without markdown, never the whole line or comment.
- In the fold ("Source, scope and history"): **source** ("Proposed by Claude
  from the project's architecture; you ratified it"), the scope, and
  **based on**, the facts it rests on in words ("3 hops between processes,
  tools.x, the module the calls go through") with the drafting model.
- A check proposed for a stated rule gives its reason the same way.

Tests: test:rule-readable (4, new), test:e2e-rule-draft (a drafted rule's
why, from, source and based-on in words; the undecidable one's "Not checked
automatically").

## 0.40.0 (2026-10-22): pick the setup's steps and run them; specs from private packages

### The setup guide: pick the steps, then one Run

"Run the next step", "Run all" and their confirmation are gone. Every step
Claude can take now starts selected, its chip highlighted; clicking the chip
takes the step out or puts it back (the plan, and the hooks, which are
installed from a terminal, are never in the run). What each selected step
will do is listed under it, including the docs link a spec is read from, and
the GitHub login tick box sits under the software step. One **Run** button
says how many steps and model calls it is, and takes them in the setup's
order, one at a time, streaming each in the working card. A step that waits
for you ("waiting for you") opens where it is decided from its status chip;
the hooks' chip shows the command. The run takes the selected steps
(`setup-run` `steps`; `runSetup({ steps })`), and none selected is refused.

Tests: test:setup-run (the selection run in the setup's order; none
selected), test:e2e-setup-welcome (every runnable step selected, the plan and
the hooks never; a chip out and back in, Run's count following it; Run with
the rules left out runs the rest and never the rules; a waiting step's chip
opens the Brief card).

### Specs from private packages: the installed README, and your GitHub login when you grant it

On a real project the setup's spec step failed with "could not read
https://github.com/<org>/<repo>: HTTP 404". The package was private, its
`repository` named a folder of a monorepo whose root has no README, and the
README it was installed with sat in `node_modules` the whole time.

- **The README installed with the package comes first** as a spec's docs:
  the version the project uses, read from disk (no network, no login).
  Only a `node_modules/<package>/README*` path the setup found is read this
  way; nothing else on disk.
- **A repository link names the package's folder** (`repository.directory`),
  and GitHub links are read through GitHub's API as raw text: a repository's
  README, a folder's README, or the file a link names.
- **Your GitHub login, only where you grant it.** A private repository answers
  404 without it. Claude Code reads one because it runs `gh` or `git` as you;
  VibeGraph never uses your login unasked. Grant it per owner, per project:
  the tick box in Run all's confirmation, the "Use my GitHub login … and try
  again" button on the step that needed it, or `vibegraph-knowledge setup
  grant github <owner>` (a person's step: refused from Claude Code; `setup
  revoke github <owner>` takes it back). The grant is kept under
  `~/.cache/vibegraph-knowledge`, never in the project. The token is read from
  `GITHUB_TOKEN` / `GH_TOKEN` or `gh auth token` when a granted owner's
  repository is read, goes only to `api.github.com`, and is never stored,
  logged or given to a model. `setup` lists the grant command beside a
  candidate whose docs are on GitHub.
- **An expired Claude login says what to do**: "log Claude Code in again:
  run `claude` in a terminal and type /login", naming the CLI VibeGraph runs
  (it can be another install than your editor's).

Tests: test:github-docs (6, new: links, a public read with no login asked
for, a private one naming the grant it needs and then read with it, the
token sent only to api.github.com, a monorepo package's installed README
read from disk and nothing else, the grant refused from Claude Code),
test:find-claude (+1). Checked on the reporting project: its package's
installed README is found and read (10 KB), its repository link now names
the folder, and with a grant your `gh` login reaches the private repository.

## 0.39.1 (2026-10-21): groups are proposed one way

### Groups are proposed one way, wherever you ask

Run all grouped a real project worse than the map's "Propose groups". They
were two different calls: the map's is the architecture proposal (the derived
map, the deployment files, the docs and the plan, with `match` rules a later
box joins a group by), while Run all, the Brief card's "Propose groups first"
and `brief codebase` used the Brief's own groups section, one line of
instruction with members and no rules.

- **Every path now proposes groups through the architecture proposal**
  (`arch_propose.ts`): the map's button, the setup's Run all, the Brief
  card's "Propose groups first" and `brief codebase` with no settled groups
  (which now prints the proposal and says `architecture --ratify | --reject`).
  The proposal waits in the map's proposal bar; the Brief waits for it.
- A Brief's own groups section (`brief codebase --only groups`) is unchanged
  and is still decided through the Brief.
- The Brief card hears when a groups proposal lands or is decided on the map
  or in the Inbox; it kept saying "no groups are settled".
- The setup's commands for a pending groups proposal are `architecture` and
  `architecture --ratify`.
- The wait message said "a proposed architecture wait for a person".

Tests: test:brief-groups-first (the groups-first draft is the architecture
proposal prompt, its rule kept, the Brief waits, `architecture --ratify`
settles it; a Brief's groups section still ratifies through the Brief),
test:e2e-brief (Propose groups first: the map's proposal bar, ratified on the
map, then the Brief). Checked zero-token on a copy of the reporting project:
the groups-first dry run is the architecture proposal prompt, with its
deployment facts and doc lines.

## 0.39.0 (2026-10-21): the setup runs from the app

### The setup runs from the app: "Run the next step" and "Run all"

The setup guide's "Go to the next step" opened the Plan panel for the
software step, where nothing could classify a package or draft a spec: those
were the map's Tools lens and the command line. A step Claude takes is now
RUN from the guide; only a person's decision opens a panel.

- **Run the next step** runs the setup's next step when it is Claude's.
  **Run all (N)** runs every step Claude can take now, in the setup's order:
  classify the packages no table knows, a spec for each software candidate
  from the docs link the setup found, propose the groups, write the Brief
  (once the groups are ratified), propose rules, and read the direction (no
  model call). Both list every model call first and run only on "Run them".
- **The run reads the setup again after each step** (`src/server/setup_run.ts`),
  so a classification that makes a package a candidate brings its spec into
  the same run. No action runs twice in one run, and none of a person's
  steps is ever taken: it ends saying what ran, what failed and why, and what
  waits for you and where.
- **One task the app follows** ("setup", tasks/guiTasks.ts): the working card
  in the guide, the bubble over the chat button, and it carries on with the
  guide closed.
- **A spec from its docs, in the app.** `software add`'s read, gate and save
  moved to `src/server/software_add.ts`, which the CLI now calls too, so the
  two cannot disagree about what a draft keeps. The app reads only the
  http(s) docs link the setup found on the server; a client never names a
  URL or a path.
- **"Go to the next step" goes to the setup's own step.** It followed the
  app's overall Next, which is the Inbox whenever a decision waits there (a
  groups proposal is one), so a groups proposal opened the Inbox, not the
  Brief card.
- The sidebar's Next for a software step Claude runs opens the setup guide.

Tests: test:setup-run (4, new: what can run now and what waits, a run that
reads the state after each action and never repeats one, one step only and
nothing to run, a spec read only from an http(s) link), test:e2e-setup-welcome
(Run all through a stub model that answers nothing: the census runs, the
model steps fail with their reason, the result lists what waits; the first
step offered as a run, cancelled without spending; a groups proposal opens
the Brief card), test:software (the CLI's add through the shared gate).

## 0.38.0 (2026-10-21): the plan comes after the setup

### The plan comes after the setup

The setup asked for "the objective and the project's principles" (a plan) as
its fifth step, and drew it amber, "waiting for you", on a project with no
plan, where nothing waited. On a codebase that exists the plan repeated what
the other steps give: the ratified Brief already says what the system is for
and reaches every session at its start, and the rules and the direction are
its axioms, read from the code and checked. A plan is the next piece of work.

- **The setup is now** software specs, architecture groups, the Brief, rules,
  direction (optional), hooks: five counted steps, where it was six.
- **A plan for what you build next** follows the setup and is not counted in
  it. It reads "optional" until a plan is started, "waiting" only when a
  proposal in it waits for you, and "done" once the plan has an objective
  (principles are the plan's own business now). The sidebar's Next offers it
  only once nothing in the setup is left, then "Start a task with Claude
  Code".
- `vibegraph-knowledge setup` prints it under "After the setup, not counted
  in it" (`[then]` when it is offered); the app's setup guide shows it below
  the same line, dashed; `/vibegraph-setup` no longer lists `plan draft
  --direction` among the paid steps it asks about up front, and offers the
  plan once, after the setup. An installed skill reads as out of date until
  `init --skill` refreshes it.

Tests: test:setup (+1: the plan offered only once every setup step is done,
then "start a task"), test:now-state, test:setup-welcome,
test:e2e-setup-welcome (the plan under its own line, optional), test:e2e-now
(2 of 5).

## 0.37.1 (2026-10-21): the setup offered to a project with its hooks installed

### The setup offered to a project with its hooks installed

- **Installed hooks no longer count as the setup started.** A project whose
  `.vibegraph` had been deleted to start again was never offered the setup,
  because `init --hooks` had been run on it earlier. Installing the hooks is
  often the first thing run on a project and says nothing about its groups,
  Brief or rules, so the offer now ignores them.
- **The side panel's setup line is a button that looks like one:** "Setup
  guide · N of M steps done", drawn as a chip beside the rules and direction
  chips. It was muted underlined text and easy to miss.

Tests: test:setup-welcome (installed hooks now leave a project new),
test:e2e-setup-welcome (+1: the popup opens on a project with its hooks
installed; red on 0.37.0), test:e2e-now (the button's text).

## 0.37.0 (2026-10-21): the setup offered to a new project, Claude's work seen while it runs, the Brief review fixed

### A new project is offered the setup

- **The app spots a project nobody has set up.** Pointed at a project with
  no groups, Brief, plan, setup or direction file, no software spec, no
  stated rule and no hooks (`src/server/setup_welcome.ts`), it opens a guide
  (`src/webview/setup/SetupGuide.tsx`) listing the setup's steps in the
  order `vibegraph-knowledge setup` and `/vibegraph-setup` use, each with its
  state, whether it asks Claude and whether you decide it. **Start the
  setup** goes where the next step is decided (a panel, or the Brief card on
  the map). **Set up from Claude Code** shows `npx vibegraph-knowledge init
  --skill`, `/vibegraph-setup` and the hooks command, each copyable. **Not
  now** sets the offer aside for this project, kept per person under
  `~/.cache` and never in the project; starting the setup sets it aside too.
  `VG_WELCOME=off` switches the offer off.
- **The sidebar's setup line opens the guide** at any time: "setup: N of M
  steps done" is now a button.
- **Opening the map from another view lost its request.** The task bubble's
  Open, for a Brief or groups task that finished while you were on another
  view, switched to the map and sent its request in the same moment, before
  the map existed to hear it: the map opened on whatever it showed last and
  the Brief card stayed shut. The request now waits until the map and its
  card mount (`requestMapOpen`, `src/webview/tasks/guiTasks.ts`).

Tests: test:setup-welcome (3, new: what counts as a new project, the offer
set aside per person and never in the project, the steps on the now-state),
test:e2e-setup-welcome (3, new: the offer, Not now across a reload, the
sidebar line, Start to a panel, and Start to the map from the thread list,
verified red without the kept request); test:now-state updated for the new
fields. The browser suites run with the offer off (`VG_WELCOME=off` in
playwright.config.ts), since every bare fixture is a new project.

### Claude's work in the app: seen while it runs, kept when a panel closes

- **One working state everywhere.** Drafting the Brief, proposing groups and
  proposing rules show the same card while the model works: the drafting
  glow and marching border, a shimmer on the title, the time it has run,
  and what it is doing now. The server streams the model's reply
  (`stream-json`, `src/server/llm_stream.ts`) into steps such as "the model
  is …", "thinking", "writing the reply: 2,400 characters" and "checking
  the reply against the facts". Only these app tasks stream; every other
  model call is unchanged. Reduced motion holds the card still.
- **A task runs to its end whatever its panel does.** The server owns each
  one (`src/server/gui_tasks.ts`, one of a kind at a time) and every client
  hears it. A panel that closes and reopens shows the task still running,
  or its result; the Rules panel's "Propose rules" no longer looks lost
  after the panel is closed.
- **A bubble over the chat button** shows a running task and, when it ends,
  what it found. Open takes you to where it is decided; ✕ dismisses it.
- **Proposed groups are shown as they arrive.** The Brief's groups-first
  step stored its group changes with the Brief, and the map drew none of
  them. They are now drawn dashed as they would be once ratified (the
  ratification's own function, on the copy the app is sent, never on an
  export), the proposal bar says so, and the boxes they hold are lit. An
  architecture proposal's groups are lit the same way.
- **Rules are not cut.** The panels clamped every bullet at two lines and a
  rule's header at 90 characters; the inspector cut a rule at 40 and the
  inbox at 140. Each now shows its whole text.

Tests: test:gui-tasks (4, new: the task registry, the stream read into
steps, the Brief's groups drawn before they are decided), test:e2e-rule-draft
(the panel closed mid-run, the bubble from running to done, the result in the
reopened panel, the rule's text uncut), test:e2e-brief (the groups dashed and
lit before ratifying), test:e2e-gui-design (its two-line clamp check is now a
no-cut check). One real call fed through the stream reader found that a
model's thinking can arrive without text; it now stays "thinking".

### The Brief review: judged against the whole map, and the topology before the plan

From a field report: after a re-brief in the app, nine claims read "rests on
the plan only … the code shows no such call", seven of them false, while
`brief codebase show` on the same Brief flagged three.

- **A thin map no longer passes for the map.** The app's model is derived
  after each pass from the threads, the stack index and the crossings. When
  thread extraction failed, the threads became an empty list. A failed
  stack index or zone pass was likewise swallowed. The model then held the
  store links the plan and topology declare, but none from the code. The
  Brief review was judged against that, and it was written over the
  exported `architecture.vibegraph.json` (5 links where the export held 55).
  - A failed extraction now keeps the previous threads.
  - Every failed pass is stamped on the model as `incomplete`, with the
    reason; so is a model with entry points and no threads.
  - An incomplete model is never written over the exported map (the server
    logs why).
  - The review says what it checked against: "checked against 60 store
    operations on the map: 60 read from the code". When the map is
    incomplete it says so, in amber, with the reason.
- **The project's topology outranks the plan.** A claim the topology
  declares as a feed was reported as resting on the plan only whenever the
  plan declared it too, because the plan's steps are read first and the
  first declaration won. A feed is now preferred, and is worded as evidence:
  "a feed chosen at run time, which the static reading cannot follow". A
  negative claim, and a main job left unstated, now name the source that
  declares them (the code, a recorded run, a ratified claim, the topology or
  the plan).
- **The card while a model call runs.** Drafting or re-briefing now shows
  what is running and for how long, in place of the disabled buttons. "All
  11 still true" read like a status of the draft; it now says what it does:
  "Mark the 11 stale lines still true".

Tests: test:brief-checks (+2: a topology-declared watch the plan also
declares is not "plan only"; the review's basis), test:system-map (+1: a
model with a failed pass says so and is not written over the export), all
three red on the prior commit; test:e2e-brief checks the basis line.

### The map fits the plan when you switch to it

Switching the architecture map from Real to Plan kept the Real map's pan and
zoom, keyed by lens alone. The plan alone is laid out in its own coordinates,
so on the Overview lens its tool column landed off the right edge, half cut.
The kept viewport is now shared only by views drawn in the same coordinates:
Real and Overlay keep your place, as before; Plan is fitted. test:e2e-plan
checks every planned card is fully in view after the switch (red on the prior
code: a card 78% in view).

### The pictures in the README and guides, current again

- Every screenshot is regenerated from the current app. The Arch and Diagram
  pictures, last taken in August with the old toolbar, are now generated too
  (on `examples/pump-wear`), and a new one shows the side editor.
- The generator copies only tracked files, so local state (a roadmap, manual
  seeds, untracked work) can no longer appear in a published picture. Two of
  its steps had stopped working: the Plan panel now closes as a sheet, and an
  Agent Manager run waits for Finish.
- The first command in the README and one in `CLI.md` ended their lines with
  `$ref` where the shell continuation `\` belonged.

## 0.36.0 (2026-10-21): rules proposed and measured, the setup in one order, hooks in under half the time

0.35.0 was cut in the repository but never published to npm, so on npm 0.36.0
follows 0.34.3 and carries both sets of changes.

### M1 — a rule's scope, picked from grouped, coloured chips

On a large project the "state a rule" form showed every tool the stack index
knows as one flat wall of grey chips (100+), threads were not offered at all,
and files were typed by hand. The scope is now picked from groups read from
facts the envelope already carries — a group with no facts is not drawn:

- **Architecture** — the map's processes (each scopes by its entry points) and
  the groups a person stated;
- **Threads** — entry points by kind and framework (routes per framework, MCP
  tools, programs, tests, public API);
- **Scripts** — shell, package and command scripts, and folders holding two or
  more of them;
- **Protocols** — tools a boundary leaves through, by role (HTTP, databases,
  model APIs, platform SDKs, MCP, queues, cloud, remote access) — role before
  origin, so `sqlite3` and `fetch` are a database and an HTTP client although
  they ship with the language;
- **Code** — the project's own funnel modules and its folders;
- **Libraries** and **Runtime** — folded.

Each chip is a toggle in its kind's colours (the kind table: processes teal,
stores blue, external services orange, modules purple, paths grey) with the
number of threads it alone reaches; a search box filters across groups; the
picked chips sit above the groups; and a live line says how many threads the
scope reaches — computed with the server's own routing predicate, now one
function in `src/shared/scope_route.ts` that `routeConstraints` delegates to.
The typed field stays, as an addition to what is picked. Docked panels (the
default since 0.35.0) lay their section nav out as a row on top: the 200px
column left a 520px sheet's content ~260px wide.

Tests: test:rule-scope-groups (6 — each chip's count equals the server's
routing for that scope), test:e2e-rule-scope (the groups, colours, search, the
live reach and the stored scope on the fleet example); test:e2e-stack's
prefill assertion follows the picked chip.

### M2 — "Propose rules from the architecture"

A button in the Rules panel and `constraints draft` — the ONE token-spending
step for rules (one model call per press; its usage says so). The harvest and
the direction census stay zero-token; they are inputs here.

- **What the model is shown** (`src/server/rule_draft.ts`, deterministic,
  capped, ~3,000 tokens on the fleet example): the architecture's processes and
  stated groups, the tools by role and which threads leave through each, the
  project's own funnels, the hops between processes, the configuration that
  fails silently when unset, the unguarded data flows, the top harvested
  sentences, the census's proposals and the plan — each fact with an id — plus
  the rules already stated (not to restate) and the scope vocabulary in the
  project's own spellings.
- **The gate** (`src/server/rule_draft_gate.ts`): a rule must cite fact ids it
  was shown or it is refused and listed "without evidence"; scope tokens the
  project does not spell are dropped, and a scope left naming nothing refuses
  the rule; a check is tidied (an empty list means absent), validated, then RUN
  against the code — VIOLATED is kept and labelled, UNVERIFIABLE is removed and
  said; a restatement of a stated rule (by text, or by the same check in any key
  order) is refused. Survivors are stored **agent-stated** with the facts in
  their note and a harvested sentence as their `cite`, and wait in "Awaiting
  you"; a rule's card now shows the sentence it was read from.
- `--dry-run` spawns nothing; `--reply <file>` gates a saved reply; `--prompt`
  shows what the model is shown.

**Live run** on the fleet example (`reviews/m-rules/DRAFT.md`): 105 s, $0.39,
12 rules proposed and stored, none restating the six stated ones, three
`import-only` checks passing; read by hand, seven real, four for a person's
judgement, one a change request. The run found three things now fixed: an
empty `forbid: []` refused a payload check (the prompt's own example showed
both lists), a payload check aimed at a route path rather than a function, and
the note cutting off the reason a check was removed.

Tests: test:rule-draft (5: the dossier pinned; the gate on a stub reply with
one good rule, one fabricated cite, one restatement, one undecidable check and
one scope naming nothing; a saved reply; key order; empty lists),
test:e2e-rule-draft (button → estimate → proposals awaiting you with their
evidence → refusals shown → Ratify).

### M3 — rule writing measured, and what the measurement fixed

Three writers (`/vibegraph-rules` from the prose, `constraints draft` from the
architecture, both) on three trees (the fleet example with its rules removed,
the same with its prose hints removed, the review's five shapes), scored by a
new `scripts/dev/score_rules.mjs` against gold rules and a bypass tree of
planted breaks (`reviews/m-rules/REPORT.md`). Every writer found the rules the
prose states; the architecture alone found 3 of 6 on the blind tree — the three
it missed are the reasons only a person holds. Fixed from the numbers:

- **`import-only` reported false violations on any project with a manifest.**
  `package.json` (or `requirements.txt`, `Cargo.toml`) was counted as importing
  every package it declares, so "openai is imported only in model/client.ts"
  read VIOLATED on code that kept it — in a verb that blocks edits, and in the
  map stack policies read. Import facts now come from parsed source files only.
- **The harvest suggests the scope a rule governs** (a funnel → every thread
  using it or its tool; a route → every entry serving it; a function → its file)
  and a funnel's import-only check. A prohibition with no check widens to the
  area a violation could be written in — it must be delivered before the edit —
  narrowed to the area the sentence names. Suggested scopes went from 0.35 to
  0.53 routing overlap with a person's. `constraints harvest` prints them;
  `/vibegraph-rules` uses them and writes "reason not stated" rather than
  inventing one.
- **A check for a stated rule that has none** can be proposed: the draft prompt
  marks such rules, the reply may carry `checks`, and a restatement that brings
  a check becomes a proposal on the stated rule instead of a refusal. Live: three
  checks proposed in one pass, one of them the gold rule's own.
- **`constraints draft` (and the button) refuse while 12 or more proposals
  already wait for a person** — one live tree reached thirty. `--force` overrides.

Tests: test:rule-harvest (+1), test:rule-draft (+3), test:constraint-grammar
(+1, on a real envelope with a manifest).

### M4 — the hooks with code, examined

`vibegraph-knowledge hook log [--session <id> | --list] [--json]` prints what
each real hook firing did: event, milliseconds, whether it parsed, the threads
a prompt routed to and how each matched (node id, file, symbol, a keyword guess,
a planned thread), what was newly sent, what the inline limit deferred or cut,
and the findings an edit introduced. It is kept under `~/.cache`, never the
prompt and never a command line. Then 13 live Sonnet sessions on three trees
(the fleet example blind with M3's rules, the ops fixture, the MCP TypeScript
SDK replaying a real fix), recorded in `reviews/m-rules/HOOKS.md`. Fixed from
what the log showed:

- **A wrong guess no longer fills the context.** On the SDK, a keyword guess
  built from words inside identifiers the prompt named ("key" from
  `TRACERESPONSE_META_KEY`) sent an unrelated example's contract, 9,415 chars.
  A backticked "`number`" matched 22 threads that only call `z.number()`.
  - The remit index now splits names into segments only for the project's own
    code; a library call keeps its whole name.
  - The words inside named code no longer feed the keyword guess.
  - A keyword guess sends its rules and the command that prints its contract,
    never the contract itself. A prompt that names the code still gets it.
- **The first shell command of a session is free.** The baseline records the
  source stamp, so a first `git status` no longer runs a full check.
- **A violation the tree already had is not "introduced" by an edit that moves
  its line.** A finding's identity no longer includes line numbers, which four
  checks print.
- **A rule stated across `wsl.exe` is recorded as a model's.** There a
  Windows-side Claude carries no mark and no terminal, and `constraints add`,
  plan edits, spec edits, claims and rule changes recorded "human". Recording
  now follows the same rule as refusing: a person needs a terminal, or
  `VG_PERSON_NO_TTY=1` in their own script.
- **`layer` read a package's own subpath as a violation.** "May import only
  `@acme/core`" failed on `@acme/core/internal` once the resolver found its
  file. An import written as a package name is now that package.

Measured, not fixed: a real edit on the 1,161-file SDK costs 9 to 10.6 s of
hook time, made of link, re-extraction and cache I/O. The cold first session
start took 30 s, against the 60 s hook timeout.

Tests: test:hook-log (4, new), test:hooks (+2), test:remit (+1),
test:field-hooks (+1), test:plan-layers (+1).

### The Direction page: two switches on every rule

One drop-down for the whole page decided what the hooks sent. It sat under
"Generic direction" but also governed the project's own rules, its options
described a mechanism ("only a rule's why"), and "nothing" was just the
default. Now every generic skill and every agreed project rule carries the
same two switches:

- **Tell Claude up front.** Its rules arrive once per session, with the first
  prompt that reaches a thread they apply to. A generic skill told up front also
  reaches the chat panel, work-run workers and thread agents in full; one not
  told up front no longer does.
- **Explain when an edit breaks it.** When an edit trips the check a rule is
  tied to, the rule and its reason arrive beside the finding. A rule that
  nothing checks shows this switch disabled, with the reason.

Both off means not used. A short explanation heads the page, and each skill
lists its rules. A switch flips the moment it is pressed. It used to wait for
the server, which rebuilt every skill's measured breadth on each toggle, so the
catalogue is now rebuilt only when the threads change. The breadth is
re-sent after each derive; the panel showed "breadth unmeasured" when it
opened before the first derive finished.

Existing files keep their behaviour: `.vibegraph/skills.json`'s `hooks` mode is
read as each skill's starting switches (`headlines` both, `on-violation`
explain only, `off` neither) and stays the default for project rules agreed
later. The CLI follows: `direction set <skill|dN> --up-front on|off
--when-broken on|off`. `direction hooks <mode>` remains and sets every skill
and agreed rule at once. `direction` and `direction project` show each item's
switches.

Tests: test:direction (+1), test:generic-skills (+1), test:project-direction
(+1), test:e2e-skills-inject (the switches flip within 250 ms, persist and
survive a reload), test:e2e-project-direction (+1), test:e2e-skills-chip.

### `setup`: the whole setup, in one order

`vibegraph-knowledge setup` says where a project stands and gives the exact
commands for the next step. It spends no tokens and changes nothing. The order
is fixed and read from the project's files:

1. **Software specs** for the tools the code leaves the project through. A
   candidate is a third-party package the code calls (not only imports) whose
   role makes it a boundary: a platform SDK, a database, a cache, a queue, a
   cloud or remote service, a model API or an agent protocol. A called package
   no table knows is classified first (`classify --apply`), because its role
   decides whether it needs a spec at all. Packages of one npm scope are one
   candidate. A shell command no table knows is listed but never holds the
   step open. A package used in an ordinary way is set aside with a reason,
   using `setup skip software <name> --why "…"`.
2. **Architecture groups**, which the Brief proposes first.
3. **The Brief.**
4. **Rules**, harvested, drafted and ratified.
5. **The objective and the project's principles.**
6. **Direction**, which is optional.
7. **Hooks**, installed and seen to fire.

Each command says who may run it (you, Claude, or either) and whether it spends
tokens. Specs come first because the Brief, the plan draft and the rule draft
read them.

- **`/vibegraph-setup`**, a new task skill, walks a Claude Code session through
  it. Claude runs the zero-token steps, asks once before the first step that
  spends tokens, and never takes a person's step. It pushes back on axioms
  that cannot be wrong.
- **`plan draft --direction` also reads what a person ratified.** That is the
  Brief and the architecture groups, as quotable documents beside the prose. It
  asks for an objective in one concrete line, and principles concrete enough to
  be wrong ("state of the art" is not one).
- **The app's "Next" line follows the same order**, after decisions waiting for
  you and stale Brief lines. The strip shows the setup's progress. The order of
  that line changes: groups and the Brief now come before the objective, and
  direction is suggested only when it has something waiting.
- **`init` ends by pointing at `setup`.**
- **`cacheDirFor` moved to `scripts/cache_dir.mjs`** and is re-exported from
  where it was. The server's CommonJS bundle can read it without the parse
  pipeline, whose top-level `await` CommonJS cannot carry.

Tests: test:setup (5, new; fixture `test/fixtures/setup/setup_demo`),
test:now-state (the new order), test:plan-direction (+1), test:e2e-now,
test:task-skills.

### `setup`, run live: what the first real project fixed

`/vibegraph-setup` was run end to end with real Claude Code sessions on a
public Next.js chat app (154 files, 24 threads). Every fix is general, with a
test of its own.

- **Not knowing a package is not a reason to write its spec.** Six of the
  first eight candidates were UI libraries no table knew. They are now
  classified first, and only boundary roles become candidates (above).
- **Docs sources, in order:** the installed package's manifest; a line of the
  project's docs that names the package exactly or says it is docs; the
  package's published README, at the version the manifest declares (jsDelivr
  for npm, PyPI for Python); and only then a line that merely mentions the
  name. The live run drafted the `postgres` driver from the README's link to
  its hosting provider, and 20 of the 57 items had no quote.
- **A thin draft says so.** When a quarter or more of a spec's items have no
  quote in its documents, `software add` prints a THIN SOURCE line, and
  `setup` lists the draft with a re-draft command before the ratify one. A
  3 KB README left 18 of 58 items unquoted; the specs drawn from full READMEs
  had 1–2.
- **A refused reply is kept.** It is saved under the cache with the command
  that re-runs it with `--reply`, at no cost. The live run paid for one
  draft twice.
- **One reader for a model's JSON** (`src/server/json_reply.ts`). Ten parsers
  took the first ``` fence in a reply. A spec reply quotes documentation full
  of fences, so a sound reply was refused with "Unexpected token '*'". The
  reader finds every top-level `{…}`/`[…]` with brackets counted outside JSON
  strings, and takes the largest. When that one does not parse, the reply is
  refused; a fragment inside it is never accepted as the whole. Software
  specs, plan drafts, the Brief, rule drafts, classification, architecture
  proposals, node scope, gap explanations, the roadmap and system drafts, and
  example inputs all read through it.
- **A funnel's users are the files that use what it wraps.** The direction
  census proposed "Reach fetch through lib.utils: 52 files use fetch through
  lib/utils.ts". Those 52 files imported the module for its class-name helper,
  and only four took the fetch wrapper. Stack tools gain `users`
  (`src/server/funnel_users.ts`): importers that take a binding whose body
  uses the wrapped tool. That covers a call the index keyed, a call through
  the file's own import of the tool, another wrapping binding (to a fixpoint),
  and a wrapper passed as a value (`memo(PureArtifact)`). A namespace import
  with no resolved call into one is not counted. `files` is unchanged. On the
  live app, the false rule is gone; the census proposes the real one:
  drizzle and postgres through `lib/db/queries.ts`, used by all 14 files.
- **A manifest line is not a direct use.** The census listed `package.json`
  among the files that "reach drizzle-orm directly".
- **The table knew `drizzle`, not `drizzle-orm`** (the ORM's package), so it
  never matched. Added beside it: `postgres`, `kysely`, `sequelize`, `mysql`,
  `sqlite3`, `@libsql/client`, `@neondatabase/serverless`, `@vercel/postgres`,
  `@planetscale/database` (db) and `@upstash/redis`, `@vercel/kv` (cache).
- **An installed skill names the exact command that installed it**, at its
  version, never `@latest`. The first session fetched whatever npm had.
- **`--help` after a command** prints that command's usage.
- **The setup skill runs model steps in the foreground.** It uses the longest
  timeout and never ends its turn while one runs: the first session sent one
  to the background and lost it.
- **`setup` prints each command as the command that ran it**, ready to paste.
  A session handed the person "replace `vibegraph-knowledge` with the full
  node command". The skill's note now gives an example
  (`vibegraph-knowledge setup` means `<cli> setup`), because "use that command
  with the same arguments" was read as `<cli> vibegraph-knowledge setup`. The
  CLI now drops its own name given as the first argument; it is never a
  command, and the person's-step refusal still sees the real one.
- **A direction proposal is read against the code as it is now.** The census
  stores what it found, and a proposal stored before the funnel fix still said
  "52 files" and was offered for agreement. Agreeing now re-runs the census
  (zero tokens), from the CLI, the Direction panel and the inbox, and refuses
  a proposal whose facts have moved or gone, saying what the code shows now.
  `direction project` marks such a rule NOW, and `setup` puts `direction
  project census` before the agree command. Dropping is always allowed.
- **An installed skill an older version wrote is named.** A session followed a
  skill installed before a fix, read the old note, and made the mistake the fix
  was for. An installed skill is a copy and nothing said it was old. `setup` now
  opens with a note naming each project or user skill that differs from what
  this version installs, compared without the pinned command and version, and
  gives the `init --skill` command that refreshes it. The setup skill says to
  refresh first.
- **A `process` group holds the project's own code.** A Brief proposed
  "In-process client libraries (drizzle-orm, fetch)" as a process. Both
  proposal gates (the Brief's groups and `architecture --propose`) now refuse
  a process group with no cluster or dispatcher box, and say why: a library
  loaded in process belongs in the group of the process that loads it, and a
  service the code reaches is a zone or trust group. Both prompts say it too.
- **Groups ratified through the Brief are ratified.** The Brief wrote them to
  `architecture.json` as stated groups but set no `ratified` stamp, so every
  check for ratified groups said no. Right after a person ratified them,
  `setup` said "no groups yet", drift had no baseline, a re-propose was not
  gated, and `plan draft --direction` did not quote them. Ratifying the groups
  now stamps them and records the drift baseline, from the CLI, the Brief card
  and the inbox. A store an earlier version wrote this way is recognised from
  its "from the brief" notes.
- **A census funnel rule passes the code as it is.** "Reach drizzle-orm
  through lib/db/queries.ts" came with an `import-only` check that allowed
  only the funnel, while `schema.ts` imports the ORM by design, and the census
  named it in the same rule. The check now allows the files that reach the
  tool directly today and catches a new one. A tool a stated rule already
  limits with `import-only` is not proposed again: the census had restated two
  drafted rules. Every caller reads the plan and the stated rules through one
  `censusAt`.
- **With no plan, the objective step is a person's.** `setup` offered Claude
  `plan draft --direction`, which needs a plan, and starting one is a person's
  step, so a session tried `plan init "placeholder"`. `setup` now puts `plan
  observe` and `plan init` first, and the draft refusal names both. With a
  plan already started, the person's command is `plan edit set-objective`,
  not `plan init`.
- **`plan draft` keeps what it can.** One principle the plan's validator
  refused (`"check": null`, then one over the one-line cap) refused the whole
  draft, "nothing written". The session paid for four drafts to land one, and
  went reading VibeGraph's own source to find out why. `null` on an optional
  field now means "none". An item the plan refuses is dropped and named by
  what it says, and the rest land in one revision. A reply nothing survives is
  kept, with the `--reply` command that re-reads it at no cost.
- **What a prompt gets first is the task's own thread.** In the first hooked
  session, the prompt hook put the whole plan (seven principles with their
  reasons) and the AI SDK's spec in ahead of the routed threads. Those threads
  were what the inline limit cut: "Also matched, not sent". The routed threads
  now come first. The plan takes what is left, with room always kept for its
  objective line; when the full plan does not fit, that line and a pointer go,
  and a later prompt sends the plan. Software specs are budgeted too: one the
  code calls before one it only imports, and one that does not fit is named,
  not cut mid-text. They follow only the threads actually given, never a
  keyword guess or a deferred thread.
- **The CLAUDE.md block names the command that installed it**, as the skills
  do. A hooked session ran `npx vibegraph-knowledge check`, npm's published
  version, older than the one that set the project up, and read its false
  violations on `package.json` as "pre-existing".
- **Stating the objective answers "What is this project for?"** The question
  `plan observe` opens stayed open and was counted on every prompt. A
  proposed objective is still closed by its own adoption, and `setup` now
  points at `inbox agree objective:<id>`, which adopts it and closes it in one
  step, instead of retyping it with `set-objective`.
- **A path with a framework's folder names routes.** A prompt naming
  `app/(chat)/api/vote/route.ts` matched only `api/vote/route.ts`, which no
  file is, so the thread it named was never routed. Five threads that merely
  pass through `lib/db/queries.ts` were routed instead. Path segments now
  accept Next.js `(group)`, `[id]`, `[...slug]` and `@slot`, and SvelteKit
  `+page`; the file part may hold dots (`a.test.ts`); a parenthesis from the
  prose around a path is not part of it. The tail of a path matches when
  exactly one file ends with it, as a bare basename did, and a camelCase
  name written with its arguments is code.
- **`<command> --help` works for an aliased command** (`constraints` /
  `constraint`); it printed the whole usage.
- **A Brief draft with no data claims** is told so, not that it was "written
  before claims were checked". That message is now kept for drafts that
  really are older.

Tests: test:funnel-users (5, fixture `test/fixtures/stack/funnel_users_demo`),
test:json-reply (4), test:software-add (3), test:setup (+6),
test:project-direction (+2), test:arch-propose (+1), test:brief-checks (+2),
test:brief-groups-first (+1), test:plan-direction (+1), test:prompt-priority
(3, new), test:cli-init (+1), test:remit (+1), test:now-state, test:stack.

### The thread view stays a thread view

- **A zoom never changes view.** On a big thread the view would sometimes
  jump to the System view and show the thread-interaction cards, one per
  entry point. M-ZOOM made the band below the overview zoom leave the thread
  for the system plane, and fits the view made on its own could cross it. The
  worst was switching to **All**: it counted every node it revealed as "the
  thread grew" and flew the view out to fit them all. The crossing is gone,
  both ways. A level switch or an opened nest is no longer read as growth:
  only a re-extract is, and only its drawn new nodes are fitted. The
  "keep zooming out for the system view" hint goes with it.
- **The thread-interaction view is removed.** The architecture map's lenses
  answer the same questions better. The System view has two modes,
  Subsystems and Architecture, and a remembered thread mode opens the map.
  The thread call graph behind it (`deriveThreadCalls`) stays: the contracts,
  the export, `plan_work` and the system map read it.
- **Threads open at Secondary.** The default level is Secondary (was
  Primary). **All** lasts for the thread in front of you; it is no longer
  remembered, so one inspection no longer opens every later thread with
  thousands of nodes. A level stored as All before this is ignored.

Tests: test:e2e-big-thread (+1: switch to Secondary, back to All, wheel to
the zoom floor, and the thread stays; red on the prior commit, the view gone
into the System view), test:e2e-thread-rank (All is not remembered),
test:lod (no zoom changes view), test:thread-interaction (the graph only);
test:e2e-zoom, system-thread-interaction and w4-thread-hue removed with the
view they drove.

### The side editor: a function is a view of its file

- **The red underlines come from the whole file.** The editor was handed a
  function's lines on their own, as an anonymous snippet, so every name
  imported above the function read "Cannot find name", and JSX in a `.tsx`
  read as an error. The editor's model is now the whole file at its own
  path. A function view hides the lines outside the function and keeps the
  cursor and any selection inside it (Ctrl+End, Ctrl+A), and it numbers the
  lines as the file does. Save still sends just the function through the CST
  rewriter. The TypeScript service also stops reporting what it cannot see
  from one file: modules, Node and test-runner typings, the JSX runtime.
  Real errors in the file are still reported.
- **The breadcrumb is the file's hierarchy:** project › file › Class ›
  function. Click the file to open all of it; click the function to go back.
  An unsaved edit still asks first.
- **The chat beneath the code resizes.** Drag the line between them, or
  focus it and use the arrow keys. The height is remembered, and the code
  keeps room for at least its header and a few lines.

Tests: test:e2e-editor-file-view (new: the file's line numbers, no error
markers on the function, Ctrl+End stays in the view, Cancel restores it,
the breadcrumb both ways, the splitter by mouse, by keys and across a
reload). On the prior commit, the same function showed "Cannot find name
'queryUsers'". The save-error spec caught Ctrl+End escaping into the hidden
lines before the clamp existed.

### The hooks after an edit: 10 s to 4 s on a large tree

M4 measured 9 to 10.6 s of hook time per edit on the MCP TypeScript SDK (743
parsed files, 862 threads) and left it open. A CPU profile of the real
post-edit hook found the time in work repeated per item, not in the work
itself:

- **The injection index rescanned every file per interface.** Finding the
  classes that implement an interface by their members walked every node of
  every file once per interface: 1.2 s of a 1.45 s link. The candidate classes
  are now listed once. Link: 1.45 s to 0.21 s.
- **Attribution scanned every tool's evidence for every boundary.** The
  call-site rule is now a lookup built once per stack index
  (`src/shared/stack_sites.ts`), keeping the scan's first-match order.
- **The crossing index matched each literal against every path, once per
  thread.** Paths are indexed by suffix once, and each file's nodes that can
  name a script are found once rather than for every thread that reaches the
  file. Discovery uses the same index.
- **The checks built a crossing index they never read.** The contract
  options built it eagerly, while a rule check needs it only for attribution.
  It is built on first use, and a caller that already has one passes it in:
  the prompt hook was building two. Rule check: 1.79 s to 0.38 s.
- **The cache rewrote 150 MB after every edit.** The envelope and the parse
  map were two whole files, stringified and written again on each edit (0.75
  s), and the incremental path read back 56 MB of linked IR it then rebuilt.
  The cache now keeps one file per parsed IR, linked IR and thread, each named
  by the hash of its text, under a small manifest
  (`scripts/envelope_store.mjs`). An edit writes its parse, the linked files
  whose links moved and the threads it re-extracted. The previous threads are
  read only when some can be reused. A missing piece costs a rebuild, never a
  partial envelope. A version-1 cache is rebuilt once and its two files
  removed. Cache write: 0.75 s to 0.06 s. Peak memory: 1.0 GB to 0.52 GB.

Measured on the SDK by alternating `HEAD` and this change, each with its own
cache, five edits each:

| | before | after |
|---|---|---|
| post-edit hook, median wall time | 10.2 s | 4.3 s |
| prompt hook with nothing moved, median | 6.2 s | 2.7 s |

Every derived structure is unchanged, checked by hash on the SDK and on a
1,816-file copy of this repository's own code: linked files, threads, entry
points, symbol index, crossings, stack index, injections, contracts and check
results.

Still to pay: the Python extraction receives every linked file to re-extract
the threads that walk the edited one (about 1 s), a checkout's Node start-up
costs 0.6 s, and the Python probe 0.15 to 0.25 s on every hook call.

Tests: test:envelope-cache (+4: the stored envelope reads back byte for byte
with no orphaned blob, an edit writes only what it changed, a missing blob
rebuilds, a version-1 cache is replaced), test:flow (the suffix index answers
as the scan did), test:stack-attribution (first match in index order).

## 0.35.0 — 2026-10-18 — the field review: rules from the prose, declared means deployed, panels beside the graph

### From a field review on a large project

A team ran 0.34.3 on a ~1,200-file production codebase and judged each output
by one test: would it have found a real bug we hit? Four changes came out of it.

- **"Declared" means "set by something that reaches a host".** The day's outage
  was a variable the code read and no deploy wrote. `configuration.md` already
  listed it, as one of 224 "declared nowhere", alphabetical, three lines below
  a CI secret that was fine, because declarations came only from
  `.env.example` and compose files. Declarations now also come from GitHub
  workflows (`env:` keys, saying whether each is a secret or a var; `envs:`
  passthrough lists; run steps that write a variable onward: `>> .env`, `-e` /
  `--env` / `--build-arg`, or a helper given a name and its own value), plus
  Dockerfile `ENV`/`ARG`, systemd `Environment=`, pm2 `env` blocks and k8s
  `env:` lists (`src/server/env_declarations.ts`; names only, never a value).
  The unset list is **ranked by what an unset value does**:
  - fails silently: an empty value split into a list, or a negated read
    gating an early return;
  - no default;
  - fails loudly: it raises or exits;
  - has a default.

  The parsers record this per read in a new optional `fallback` / `use` pair
  on `envReads` (JS/TS, Python, bash). Build-time names (`NEXT_PUBLIC_`,
  `VITE_` …) are marked as needing a rebuild. Deploy targets of one kind (two
  deploy workflows, two compose files) are compared: "set on one, missing on
  the other". A thread contract's Configured-by line says "fails silently
  when unset". Python no longer counts `os.environ["X"] = v` as a read.
- **Tool classifications are not rules.** All 22 of the project's constraints
  were `describe` policies from `classify` ("clsx is classified as frontend"),
  and every hooked session was told "Stated rules (22) — from the people who
  run this code". A classification still names the tool's role in the stack
  index and the system spec. It is now out of `check`, the session-start and
  per-prompt rule lines, rule counts, skill and Brief rule blocks, and the main
  list in `constraints.md`. It is shown in its own short section, in the Rules
  panel's new Tool classifications section and in `constraints list`, and
  agent-written ones are one Inbox line instead of one decision each. The
  session-start list also says how many rules an agent stated. **A ratified
  skill on a thread that had a classification routed to it reads stale once;
  Re-affirm re-stamps it.**
- **`check` says when nothing was checked.** With no rule that has a checkable
  half it printed "0 checked … → exit 0", which read as a pass. It now prints
  `NOTHING WAS CHECKED — this is not a pass` and **exits 3**, as it does when
  there are no rules at all. Exit 0 means at least one rule was checked and
  passed.
- **A guard-named call is a guard.** `security.md`'s one "unguarded" shell
  finding was a script whose `guard_rel_script "$REL"` ran 44 lines before
  its exec. Such a finding now reads "review: a check is called on it first …
  verify it rejects what it should". That applies when a call is written at or
  before the sink, to a function named `guard*`, `validate*`, `verify*`,
  `assert*`, `require*`, `check_*` or `is_valid*` / `is_safe*` / `is_allowed*`,
  and it takes the value or a value it was built from. Not `ensure_*` (it
  creates), not JS `require`, never a call that is itself a sink. A check
  written after the run guards nothing. Findings are grouped by file.

- **The rules in the prose.** The project's real operator rules — a file that
  must be a root-owned copy, an ACL that is first-match by rowid, a `pm2
  instances: 1` that is a correctness setting, a payload key that must never be
  sent, a database that must have no user grants — sat in its CLAUDE.md and
  module headers while its constraints held none of them. Three parts, in the
  three strata:
  - *derived, zero tokens:* `constraints harvest` lists rule-shaped sentences
    (must, never, only, "the one", "leaves through", "is inert", "first-match",
    "correctness" …) from CLAUDE.md, AGENTS.md, READMEs, docs, module headers
    and docstrings that name something the IR knows — a file, a function, a
    tool, a route, an environment variable, a payload key the code sends, or a
    file-shaped path under a known folder that does not exist yet — ranked by
    anchors, marker strength and location, and marked down for narrative (a
    date, a past-tense record, a release-note heading), a parenthetical aside,
    a test file or an `examples/` path. It never writes a rule. Where the shape
    is unambiguous it suggests a grammar check (`--check …`).
  - *proposed:* the `/vibegraph-rules` task skill (installed by `init --skill`,
    `--skills rules`) has the session's Claude read each candidate in context
    and state the real ones with `constraints add … --cite file:line` — inside
    Claude Code they land agent-stated and wait in the Rules panel and Inbox.
    `--cite` is a gate: the quoted sentence must be in that file near that
    line, or the rule is refused; the rule carries `cite` and every prompt
    block says `— from file:line`.
  - *stated:* a person ratifies, as before. The session-start hook says how
    many candidates there are, once, while no person has stated a rule.

  Measured, not assumed: on the fleet example all six stated rules surface
  from its README at the default threshold (and two from module headers), the
  behaviour-describing docstrings do not; on a fixture built from the review's
  five shapes, five of five. Five outside projects (Python, TypeScript, bash)
  taught four general rules now in the ranker: release notes under any file
  name are records; test files and sample code rank low; a marker inside a
  parenthetical aside describes rather than rules; "in order to" is not an
  ordering rule. Named limit: a documentation sentence describing a library's
  behaviour ("`X` never enumerates the directory") is rule-shaped and only a
  reader can tell it from a rule — the list is ranked and read, never applied.

Tests: test:configuration-deploy (5), test:rule-surfaces (5), test:rule-harvest
(8), test:cli-check (+1), test:dataflow (+1); the bash and polyglot snapshots
gained only the new `fallback` field.

### The GUI pass: where the project stands, panels beside the graph

A review of the app found its knowledge shown as lists behind a row of
buttons: nothing said what state the project was in or what to do next,
every panel covered the graph, and a proposal looked the same as a decision.

- **Panels open docked beside the graph** by default; the dock button still
  centres one, and a viewer's choice is remembered. `VG_SHEET_DOCK=centre`
  restores the centred sheet as the default (the Playwright suites pin it).
- **"Now"**, at the foot of the side panel: the objective, what waits for you,
  stale Brief lines, open questions, the stated rules and the project's
  direction, each opening the panel that acts on it, and ONE next step chosen
  by a fixed order (a waiting decision, then a stale Brief, then no objective,
  no rules, no agreed direction, then "start a task") — computed by
  `src/server/now_state.ts` (WS `now-get`), never a model's summary. It sits in
  the side panel because over the canvas it covered the controls each view
  keeps on its bottom edge (the map's "start here" story, found by
  test:e2e-arch-map).
- **Live counts on the panel tabs:** Inbox (decisions waiting), Plan (plan and
  objective proposals), Direction (proposed rules), beside the Rules count.
- **A proposal looks like one:** an item waiting for a person — a proposed plan
  item, an agent-stated rule, a rule change, a decidable Inbox item — is drawn
  with a dashed border in the proposed accent; an agent's change to an AGREED
  plan item shows each field as agreed and as proposed, above the fold.
- **The chat on the style rules:** lucide icons for the thread and context
  pills (were ⑂ / ◈ / × glyphs), a steady caret (the blinking one was an
  infinite animation), a readable empty state, type and spacing on the scale,
  shadow and motion from tokens.
- **No "Draft roadmap" on a project with code:** the empty-roadmap prompt
  belongs to building from empty; a project with entry points sees it only once
  a roadmap exists or is drafting.
- Found on the way: test:e2e-plan-questions had been red since 0.28.0 — it
  called a person's CLI step without the no-terminal opt-in (fixed in the test).

Tests: test:now-state (the next-step order, walked on an empty project),
test:e2e-now (the block, the docked panel it opens, the counts after a census).

### The project's own direction, read from its code

Direction was six skills shipped with VibeGraph: a project could not add its
own, two of the six fire on nearly every thread, and the plan's principles
reached no session but the hooks. Now a project has its own direction, read
from what its code already does.

- **The census** (`src/server/project_direction.ts`, zero tokens) proposes:
  - *funnels* — a tool the project reaches through a module of its own (the
    stack index's funnel), when most of its use already goes through it:
    "Reach sqlite3 through telemetry.storage (telemetry/storage.py), not
    directly — 5 files use sqlite3 through it; none reach it directly",
    checked by `import-only` (a language global such as `fetch` is never
    imported, so that rule says it is not checked rather than pass on nothing);
  - *guarded zones* — a data zone whose every write runs behind one check
    (the write guards): "Every write to partner_status is decided by
    verify(…) — 1 only when it holds, 1 only when it fails";
  - *the plan's agreed principles*, with their checks.
- **A person decides.** Proposals wait in the Direction panel's new "This
  project's direction" section (Read from the code · Agree · Drop) and in the
  Inbox. A dropped rule is never proposed again. An agreed rule whose facts
  moved is flagged ("the facts it was read from moved") — its wording is never
  changed under the agreement. `.vibegraph/direction.json`; CLI `direction
  project [census | agree <id> | drop <id>]` (agree and drop are a person's
  step).
- **Delivered like the generic direction**, under the same hooks mode: an
  agreed rule arrives once per session with the first thread whose files it is
  about; one with a check is checked after every edit AS ADVICE — a violation
  the session did not start with brings the rule and its why, never a block (a
  rule that must block is a stated rule). The Agent Manager's framing counts
  the agreed rules; "What Claude will be told" shows them.
- `hooks.mjs`: the inline-cap helper moved to `hook_text.mjs` (the file is at
  490 lines, under the rule again).

Tests: test:project-direction (4: the census on the brief fixture and the fleet
example, merging, the plan principle and the Inbox, the real hooks),
test:e2e-project-direction.

### The Agent Manager is a conversation

A review found the Agent Manager's default run was one `claude -p` call with
the raw task: when Claude needed a decision the run simply ended, the hooks'
"name it again to receive the rest" could never be acted on, and nothing told
the session the project's objective or which VibeGraph tools exist.

- **One session, many messages.** The run keeps Claude Code open
  (stream-json in, as the chat does). Each turn ends with "waiting for you":
  reply (Ctrl+Enter), or **Finish and review** — the evidence is collected as
  before. Stop works mid-turn or while waiting. The limit is 2 hours, waiting
  included.
- **Claude can ask.** The framing asks it to put each decision that is the
  person's on a line starting `QUESTION:` and end its turn; the panel shows it
  as an amber "Claude asks you" card and the reply box says "Answer Claude's
  question…". The answer goes to the same session.
- **The framing** (`src/server/hooked_framing.ts`, appended to Claude Code's
  system prompt): how the run works (hooks, blocks, never edit `.vibegraph/` to
  pass a rule), the project now (objective, how many stated rules, what waits
  for a person and not to decide it, the open plan questions to say if answered,
  enabled direction), and which VibeGraph tools to reach for when (thread brief,
  contract, coverage, blast radius, dataflow, plan, direction, investigation).
  The panel shows the same facts before you start: "What Claude will be told".
- **Guardrails.** The MCP tools that spend tokens or start other agents
  (propose architecture, scope a node, spawn a thread agent, start a work run,
  draft or sweep skills, generate a README, explain a node) are denied to the
  run. A cost cap (`VG_RUN_COST_CAP`, default $10) stops further replies; the
  status line shows the cost so far against it.
- **The timeline reads as a conversation:** your messages, Claude's replies,
  its questions, folded runs of tool calls, blocks and errors, each arriving
  with the node-enter motion.

Also found: the orchestrated (legacy) e2e had been red since prompts over
24 KB moved to stdin — its stub read a flag's value as the prompt. The stub
reads stdin now.

Tests: test:hooked-run (the question parse, the framing), test:e2e-hooked-run
(a whole conversation: the question card, the answer to the same session, an
edit from the answered turn, finish, review).

### Fixes from a review of the Agent Manager and direction

- **The Agent Manager shows an edit block again.** The panel looked for "breaks
  a stated rule"; since 2026-10-01 the post-edit hook says "introduced a break
  of a stated rule", so a blocked edit never reached the timeline (the e2e had
  been red). Both wordings match now.
- **A run cannot quietly loosen a stated rule.** What the project states under
  `.vibegraph/` (rules, plan, architecture, skills, Brief, specs, thread skills,
  topology sources) is now part of the run's snapshot: a change to it is listed
  in the evidence ("what the project states — a person's decision"), the rule
  checks are made against the rules as they stood when the run began, rules
  the run added, removed or changed are named, and Reject puts it all back.
  Nothing blocks the write (a `.vibegraph/` write guard was declined earlier);
  it can no longer pass unseen.
- **After `/compact` or `/clear`, everything is sent again.** The hooks forgot
  what the contracts and rules had sent, but kept the records for direction,
  architecture and the Brief, so those never came back.
- **A thread held back for room no longer loses the direction record** for
  the rest of that prompt.
- **The app re-reads `.vibegraph/skills.json` when it changes**, so
  `direction enable` from the CLI shows without a restart.

Tests: test:hooked-run, test:direction, test:e2e-hooked-run.

### The Brief sees the check a write sits behind

A field Brief never said its decisions are verified. A drill reproduced it
(`test/fixtures/brief/exchange_demo`, `reviews/brief-intent/BASELINE.md`):
with the intent only in the plan and the code, 0 of 3 drafts said it — and one
said why: no fact showed the verification step. The guard was in the code
(`if (!verify(decision)) continue;` before the write); the facts listed write
sites, never the check in front of them.

- **The parsers record an `if` that always leaves its block** — field-additive
  `exits` on `if_stmt` (TS/JS `return | continue | break | throw`, Python
  `return | continue | break | raise`). `continue`, `break` and `throw` emit no
  node, so this was the only way to see the guard. IR snapshots regenerated
  (the new field only).
- **What a write runs behind** (`src/server/write_guards.ts`): from the IR, the
  if-arm around a statement and every earlier exiting `if` in its block, kept
  when the test calls something (a check, not a null test); `!check(x)` /
  `not check(x)` read as the check failing. An exit inside a flattened callback
  guards only the rest of that callback.
- **The Brief facts list each guarded zone write as [enforce]**: "partner
  exchange writes partner_status only when verify(decision) holds — in
  publishVerified". The map's zone references now carry the write call's IR
  node.
- **Measured:** errors per draft (verification, publish only what verifies,
  quarantine, restore, inverted, omitted as secondary) 3.7 → 0.7 on the drill's
  fixture; verification and the restore stated 0/3 → 3/3. The scorer is
  `scripts/dev/score_brief_intent.mjs`.

Tests: test:write-guards (4); test:ir, test:jsts-ir, test:polyglot snapshots.

## 0.34.3 — 2026-10-14 — the plan's boxes hold while a change is pending; questions close on evidence

From the same field review, re-run on 0.34.2:

- **A pending change no longer drops a box.** While an agent's change to an
  agreed process waits for a person, the map draws the process as it was last
  agreed (`agreedAs`); before, it fell back to the code-only boxes until
  someone re-agreed.
- **A question something assumes can be closed on its evidence.** A person
  closing a question whose latest evidence is CONFIRMED settles it: the items
  resting on it stop assuming it, and the resolved record says so. Otherwise
  the refusal says what is missing (no evidence, refuted, not run yet) — it
  used to say "record its evidence" even when the evidence was there.
- **A stale box name is flagged.** Ratifying records each box's entry points;
  a ratified name on a box whose entry points have since left is drift
  ("the name … was given when it held 6 entry points; it now holds smoke") and
  asks for an update. Recorded from the next ratification on.
- **A box lists a file once** when it is seeded on both its module and its
  `main`.
- **"Placed by its folder"** replaces "located, not anchored" on a box the plan
  places by its `at` only — plan check calls it realised; a library needs no
  entry point.
- **Brief staleness says what changed:** the was / now texts show the part that
  differs, in whole words, not a prefix cut before the change; a citation of a
  declared feed's edge (`…:feed:N`) that has folded into the code's own edge is
  not stale.
- **The Brief facts list every gate** of a declared tree (`topology:dt:<id>:gates`:
  id, kind, who answers, the question) — the tree's line kept six of twenty.
- **The review sheet no longer contradicts itself:** a process's main job is
  stated by a line that cites the box's edge to that zone, or names the box
  and the zone, even when the line carries other claims.

Tests: test:plan-boxes (11), test:plan-assumptions, test:brief, test:processes,
test:system-views.

## 0.34.2 — 2026-10-14 — the access grid opens whole; chips in the Stack panel

- **Fix: the access grid showed as an empty strip with scrollbars.** On a
  store with more write grants than the map draws, the Resources lens opens the
  access grid first (0.34.1) — but the grid was rendered inside the lens bar,
  whose `backdrop-filter` makes it the containing block of a fixed child, so
  the overlay was squeezed into the bar's height. It renders on the page now
  (a portal), full size, and closes to its button.
- **No legacy "Open a Python file" start screen.** Before the project
  arrives the canvas says "Reading the project…"; the Code button's hint no
  longer names Python.
- **The Stack panel uses the kind chips** every other panel uses: each tool
  (a project funnel as a module, a library as external), what a funnel wraps,
  the files it is evidenced in (click to open), and each policy's rule (click
  to open the Rules panel).

Tests: test:e2e-stack (the chips), test:e2e-topology-scale (the grid opens
first, whole).

## 0.34.1 — 2026-10-12 — the map's boxes follow the agreed plan

From the same field review, re-run on 0.34.0:

- **Boxes follow the agreed plan.** The map clusters entry points by how they
  are launched (framework family, package), so a partner exchange and the
  admin tools sat in one shared scripts box although the agreed plan names
  each as its own process. Now, where a derived box holds the entry points of
  more than one AGREED plan process (or of one and of none), or one process's
  entry points sit in several boxes, that process gets its own box,
  `cluster:plan:<id>`, labelled as the plan names it
  (`src/server/arch_plan_split.ts`). Only the entry points a process LISTS
  move: a process placed by its `at` alone is located, not anchored, and
  moves nothing; nor does a proposed process. A box the plan does not
  divide keeps its id, so stored names and groups still find it. **Behaviour
  change:** box ids change where the plan divides a box; a ratified group
  that named the old box shows as drift.
- **Drift counts more.** A new entry point is drift even when it lands in an
  existing box, and a box the agreed plan made that no group holds is
  substantial — the map asks for an update.
- **`--seed-plan` and the Plan overlay** find a stack tool the plan names by
  another name (a store reached through its client packages), from the
  packages `plan check` found it reached through.
- **The state machine is drawn once.** A derived machine with the declared
  machine's transitions folds into it; its box says "declared and derived"
  and names where the code reads it. The declaration says who applies it.
- **Gate cards** no longer repeat the question in their rows.
- **No wall of grants.** Above 48 write edges the Resources lens says each
  principal's writes on its card ("may write 30 zones — select to draw
  them"), and the access grid opens first.
- **The Brief is not blocked by a pending groups proposal** when groups are
  already settled: it is drafted through the settled groups, says so, and the
  pending proposal waits beside it (a full draft no longer drops it).
- **The Brief facts** list where the code calls a ratified software spec's
  operations as [use] evidence (a signature check's key lookup, a document
  write), tests left out; and a feed the project's own topology declares is
  no longer flagged as "rests on the plan only".
- **TypeScript:** a field or constructor parameter property with no
  annotation but a `new K()` default is typed `K`, as TypeScript infers it, so
  `this.codec.encode(…)` links (under the existing rule: only when no
  project class extends K). A gateway's thread now reaches the codec it
  constructs.
- `fast-xml-parser`, `xml2js`, `xmllint-wasm` are `utility` (in-process).

Tests: test:plan-boxes (7), test:e2e-topology (the gate panel's rows).

## 0.34.0 — 2026-10-12 — the Brief stays current; decisions and access read as such

A field Brief showed two lines STALE though nothing they said had changed. Two
citation kinds were too fragile: a `file:line` was checked only against the
lines printed in that run's facts pack (which keeps only the top-ranked ones),
so a line that moved, or fell out of the ranking, read "no longer among the
facts"; and a plan citation hashed the item's status, so agreed → proposed
staled every line citing it.

- **Anchored citations.** A `file:line` is anchored when it is written: to the
  innermost function or class around it (its structural id and a hash of its
  source), or, at module level and in docs, to the line's own text. Staleness
  asks the anchor — that function changed or is gone, that line is no longer in
  the file — never where it sits or whether it made today's pack. Lines written
  before this are re-read from the file, not judged by the pack.
- **Plan citations** ignore the item's status; its wording still counts.
- **Still true** (card, or `brief codebase reaffirm [--line …]`): a person says
  a stale line holds; its citations are stamped against the code as it is now.
  Zero tokens.
- **Scoped re-brief**: re-briefing stale lines sends only what they rest on
  (their boxes, the boxes next to them, what they cite) — not the project.
- **The hooks**: session start marks a line whose anchored code changed; after
  an edit, a note names the Brief lines the edit touches (a thread behind the
  line's boxes walks the file, or a function it cites is in it) — once a line.
- **Sync** (a switch on the Brief card, or `brief codebase sync on|off`): when
  the code a ratified line cites changes, the running app re-drafts just the
  stale lines — one scoped call, after a quiet minute, at most one per 10
  minutes — and keeps them PROPOSED for you. Off by default; a person's switch.

Tests: test:brief-sync (8); the Brief card e2e toggles sync.

### Fix: "Re-brief" failed with `spawn ENAMETOOLONG`

A re-brief's prompt was passed to `claude -p` on the command line, which
Windows caps at 32,767 characters for the whole line. Every model call the app
or the CLI starts now sends a prompt over 24 KB on stdin
(`src/server/reasoning_tools.ts`). Tests: test:reasoning-spawn (a ~300 KB
prompt).

### The Decisions and Resources lenses read as decisions and access

From a field review on a shared-store project (54 zones, 641 grants, one tree
of 20 gates, a state machine of 11 phases):

- **No phantom readers.** A role list that refers to another list
  (`read: FOLDER`, `[...ALL, ...BOARDS]`) is expanded; a reference that cannot
  be resolved is unknown, never a role named after the list (`FOLDER` had
  become a reader of every record zone). When a project's generator declares
  grants, the code-derived grants are not merged in.
- **One tree, drawn as a tree.** A derived tree sharing the declared tree's
  gates is the same tree: drawn once, its box saying "declared and derived".
  The Decisions lens lays out its own way: state machines first as a row of
  phases, each tree from its root (depth to the right, yes before no, outcomes
  as leaves), the evidence's families and zones on the right.
- **A gate card says how it is decided.** Its question; whether it is a
  person's judgement or a check on recorded evidence, and who answers it; the
  function evaluating it; where it is declared; each zone it reads and who may
  write that zone; its evidence fields; yes → / no → with the outcome; where
  the answer is recorded. The topology schema gains `answeredBy`, `kind`,
  `records` on a decision node and `refusedWhen` on a transition. Decision and
  topology edges say what they are (yes, no, reads, write) instead of "shape
  not spelled here". A phase card lists its ways on: who asks, what is needed,
  when it is refused.
- **Zones fold into groups.** Zones one family pattern expands to
  (`record_{Type}`), or sharing a name prefix, are one card when three or
  more: it says what all of them share ("writable by …", "readable by every
  principal") and its edges are one per principal and access, counted.
  Selecting the group, or a zone in it, opens it. **Behaviour change:** a
  large store now opens folded.
- **Access grid** (Resources lens): who may write (W) or read (R) each zone, a
  principal per row and a zone group per column, collapsed to "W n · R m"; a
  click opens a group.
- **Every feed's fate is said.** `topology run` ends with one line per
  declared feed: drawn (N edges the code does not show), already shown by the
  code, no box for its process (anchor the plan process), no zone holds its
  family, or STALE. A feed may cite a whole file.
- **The Brief says what is decided.** The facts count each state machine's
  transitions and phases, and each tree's gates (how many are a person's
  judgement), outcomes and who answers; the function a declaration names as
  evaluating a gate or applying a machine is an [enforce] item at its
  definition; a planned module's facts say which third-party tools its files
  use and which boxes reach it (so translation is credited to the codec, not
  the gateway that calls it). The review sheet counts "says who reads or
  writes in prose only" once, instead of a warning on every such line.

Tests: test:topology-review (6), test:e2e-topology (the gate panel and the
access grid), test:e2e-topology-scale (rewritten for the folded store),
test:decision-tables.

## 0.33.2 — 2026-10-12 — a ratified scope's description sits in Process

- A ratified scope's description now sits in the box inspector's **Process**
  section, under the process words — it says what the box does — instead of at
  the foot of the card below the payload notes. Marked "scoped" (and STALE
  when the code it was drawn from changed); the note at the foot keeps who
  scoped it and when. Tests: test:e2e-node-scope.

## 0.33.1 — 2026-10-12 — model calls that only reason can no longer run anything

**Safety fix.** The Brief card, Scope this node, the Classify button, Explain
this gap, Propose groups, READMEs, skills, Intent, compose, changeset,
build-plan and system drafts, and synthesised example inputs all start
`claude -p` in the project's own folder with permissions skipped. Most denied
only file edits — Bash was still allowed (two denied nothing at all), so on a
project that drives machinery a model could, unasked, have run a script that
moves it. Every one of them now denies file edits, Bash and the sub-agent tools
(`src/server/reasoning_tools.ts`, one list; the CLI's `classify`, `brief` and
`architecture` use the same list — they denied Bash but not sub-agents).
Building the map never ran anything and still does not.

Left as they are, on purpose: the chat and the hooked Agent Manager run
(sessions a person drives), a work run's worker (edits through the chokepoint,
in a run a person starts) and its reviewer (may run a packet's checks).

Tests: the Brief and architecture stubs refuse a spawn that could run Bash or
sub-agents, so e2e-brief, e2e-arch-map, e2e-arch-drift, arch-propose and
arch-artifacts fail if any of those paths regresses.

## 0.33.0 — 2026-10-12 — the run floor no longer assumes an unknown library is harmless; hardware is a role

**Safety fix.** Before run-to-here executes anything, the floor scans every call
on the path and refuses (or asks consent for) whatever reaches outside the
program. Its last rule treated a dotted call on ANY imported module as a
harmless builtin, so `serial.Serial("/dev/ttyUSB0").write(b"go")`,
`paho.mqtt.publish.single("plant/valve", "open")` and
`socket.create_connection(...)` scanned pure and would have run without asking
— the run's sandbox copies files, not a serial port, a broker or a network.

- A dotted call on an imported module is now decided by that module: the
  project's own as before; the standard library allowed except modules that
  reach outside the process (socket, ssl, http, urllib, smtplib, ctypes,
  subprocess, multiprocessing, sqlite3, …); a third-party library allowed only
  when its role is known to stay in-process (tensor, data, utility — from the
  stack tables or a person's statement; a model's `classify` proposal never
  loosens the floor). Anything else is refused and named for consent, at
  import time as well as in the function. An unclassified library fails safe.
- `from m import f as g` keeps its alias in the Python IR (the linker already
  expected it): `g()` links, and the floor knows what `g.write()` reaches.

Tests: test:scan-effects (19, four new — red on the previous commit); the
run-to-here suites, both pump examples and the run e2e specs unchanged.

**What the unclassified boxes are.** A field map of a RevPi / EtherCAT project
read "unclassified" for every hardware library — no role existed for hardware.

- Role `device` (hardware I/O): pyserial, pysoem, pyvisa, revpimodio2, RPi.GPIO,
  gpiozero, smbus, spidev, pymodbus, python-can, pyusb, nidaqmx; serialport,
  onoff, johnny-five in JS; `piTest`, `i2cget|set` in bash. A device box on the
  map says its wire (serial, EtherCAT, VISA, Modbus, I2C, GPIO, …) in a category
  of its own; a module wrapping one is a funnel. Also: paho / mqtt / mosquitto
  are queues, yaml a utility, sudo a process; definitions for the common ones.
- A standard-library box says "standard library", never "unclassified".
- **Found on the way:** a box named "node" was the standard library's
  `fileURLToPath`. A call's file was looked up by its node id, and the FIRST
  file holding that id won — two files with a module-level `EXAMPLES` swapped
  imports, and `node:url` was read as an unknown tool. A call's file is now the
  step it hangs off.
- **Classify on the map**: the Tools lens offers "Classify N unclassified tools"
  — the estimate first, then one model call through the same functions as
  `vibegraph-knowledge classify --apply`. Answers are stored agent-stated: they
  show as a model's, wait in the inbox for a person, and never loosen the run
  floor.

- **And a flake that was a bug:** the map cleared an open trace (a story, a
  route, a reach) whenever the same layout arrived again — a background
  re-derive after a ratify was enough, and e2e-arch-map failed 1 run in 2 for
  it (3 of 6 before, 6 of 6 pass after). A trace now ends only when what is
  drawn changes.

Tests: test:device-role (5); e2e-arch-map 6/6 on repeat.

## 0.32.0 — 2026-10-09 — the Brief reads the system through its groups, and names what it runs on

A field brief got the shape of a system right (dispatcher → script → cached
output) and missed what made it noteworthy: commands run on a remote host
through a policy-gated platform, under each caller's own identity, with a free
and a paid tier. Each miss had a cause in what the Brief was given.

- **Groups first.** A full draft with no settled groups proposes the GROUPS
  alone (which boxes deploy together, which trust zone they share) and waits
  for a person; once they are ratified the brief is drafted without a groups
  section, and a stated group is a citable statement (`group:<id>`) — for
  where a box runs, never as a mechanism. They had been listed as "not
  evidence" even when a person had ratified them. `--skip-groups` (and Skip
  groups on the card) keeps the one-call draft.
- **What each tool IS.** A tool box's definition, from the vendor's docs
  (the stack taxonomy's tool notes), is in the facts as `tool-def:<package>`,
  and a line about how the system reaches another host names the tool, never
  only "a client".
- **Checks said as checks.** A new feature word, `checked`: a property the
  project's own test, probe or script checks, citing it — tested, not enforced.
  A policy check that is only `[verify]` evidence used to be dropped. And a
  method word, `dispatches`: sends named work to run on another process or host.
- **Invoked-name variants.** A script that behaves by the name it is run as
  (`case "${0##*/}" in tool-public) … tool-metered) …`) answers to each of
  those names; a literal naming one (`"tool-metered"`, or a path ending in it)
  is a command hop to that script with `invokedAs`, the map edge says
  `as tool-metered`, and so does the Brief's edge line. The bash IR keeps a
  case's arm patterns (`casePatterns`) and a composite TS return its string
  literals — both field-additive.

Tests: test:brief-groups-first (5), test:invoked-variants (4); the Brief card
e2e walks groups → ratify → brief.

## 0.31.0 — 2026-10-09 — what the code decides at run time: a ladder of evidence

Some facts a static reading cannot see: which request channels a service finds
by listing them, a feed over a family, names from configuration. A model
guessing them would put plausible guesses on the map as facts. Instead each
fact says how it is known — **derived** from the code, **declared** by the
project, **observed** in a recorded run, **inferred** from cited lines and
ratified by a person — cheapest and most trustworthy first. No hook ever spends
tokens or decides anything.

- **Rung 1 — the shape of run-time names (zero tokens).** Which names exist may
  be decided at run time; their shape is static. A function returning a
  collection built from one template carries that template as its element
  pattern, through a local, a linked method call, a caller's argument, a
  closure, and into a `.map` / `for … of` callback; an operation's receiver
  (`(await reg.meta(b)).watch(…)`) names the resource before its literal
  arguments. A funnel whose callers name different families is charged at each
  call site, never one family for all; a test is not a caller that disagrees;
  a name may be the zone's own (one channel per zone).
- **Plan-to-box matching.** A planned process is the boxes its named entry
  points run (anchored), else its folder's one box (located — a weaker match,
  said), else **ambiguous**: no box is charged its planned steps, and the sheet
  says to anchor it. `architecture.md` marks a stated group label the facts no
  longer support **LABEL STALE**.
- **Rung 3 in session — claims (zero tokens).** `claim propose --subject <box>
  --verb … --object <zone> --cite <file:line>…` — open to an agent: every cited
  line must exist in a file the subject's threads reach, and the map must not
  contradict it. Stored PROPOSED · inferred with a hash per cited line (a change
  makes it STALE); `claim agree|reject` and the inbox are a person's. Agreed, it
  answers the facts gap, is an `inferred` edge on the map and an inferred
  operation in the Brief's facts. A prompt routed to a box with an open gap gets
  one line naming it and the command — once a session, never crowding out what
  did fit. Session start shows each Brief line's evidence kinds.
- **Rung 2 — declared feeds (zero tokens).** The topology may declare `feeds`
  (`{process, watches|reads|writes, via}`): shown as declared, answering the plan
  step; STALE when a function named in `via` is no longer defined.
- **Rung 4 — recorded runs (a person opts in).** `trace enable|disable|forbid`,
  `trace run -- <cmd>`, `trace status`. The recorder (loaded by `NODE_OPTIONS`;
  for processes Claude Code starts, set in `.claude/settings.local.json`) writes
  per operation only the process, the verb and the zone — never a value, key or
  name — to `.vibegraph/traces/` (git-ignored). A run confirms what the code
  shows ("observed in N recorded runs") and adds what it does not (an `observed`
  edge). Limit, stated: an operation through a plain exported function, or an
  object no wrapped method hands out, is not seen.
- **"Explain this gap" (the one step that spends tokens).** `claim gaps`, `claim
  explain <n> [--estimate]`, or Explain beside a gap on the Brief card: one call
  shown the gap and the call sites the box's threads reach; its claim must cite
  a chain of lines it was shown, then goes through `claim propose`'s checks.
- Also: `inbox` crashed on a plan change that adds a field.
- Found by closing a real project's gaps: a function that maps a name through a
  table and joins the parts (`documentIdFor(path)`) was read as returning a
  COLLECTION, which hid the name it carries — an element pattern now needs the
  template to BE an element, and a joined list is a string; a name now routes
  through an unknown ONE-argument function (a mapping of one name) — an
  identifier argument as well as a call; a function of several combines them. And a planned process anchored to several boxes does a
  step when ANY of them does — a gateway's ingest script was charged with the
  requests its server writes; a step none does is one gap, not one per box.

Tests: test:shape-tracking (4), test:plan-matching (3), test:claims (5),
test:feeds (3), test:recorded-runs (5), test:gap-explain (3).

## 0.30.0 — 2026-10-08 — the Brief checks itself: what changed, what the evidence is, what the map says

A field review of the first Brief found it read well and still described the
core loosely, and that nine lines read STALE straight after drafting. Each fix
is one rule in one place (`src/server/brief_checks.ts`): drafting refuses a
line it names, and the review sheet shows the same findings on any brief,
including one ratified before these checks existed.

- **STALE means what it says (B7).** A citation is hashed from exactly what it
  cites: a rule's text, check and scope; a source line and its neighbours; an
  edge's ends and operation (moving code is not a change). The code a cited
  rule guards is hashed apart, so the card says which changed — "rule c13
  changed — its text, check or scope (was: …)" or "the code rule:c10 guards
  changed: approve (…)". A source that cannot be read is not known, never
  changed: the nine false markers came from the server's map copy losing the
  parsed code it was built from (fixed, `model_source.ts`). A brief ratified
  on 0.29.x is checked against how that version hashed it, so the upgrade
  stales nothing. Every `file:line` the facts print is citable — the prompt and
  the allow-list are one source.
- **Evidence has a role (B8).** Each cited item is enforce (where a rule is
  applied: a function a stated rule guards, a declared grant, a grant or admin
  call), verify (a test, probe, demo or refused attempt), use, declare, doc or
  note. A Method line resting only on tests, rules, the plan or docs is
  refused; a mechanism word (`enforces`, `partitions`, …) with no enforce
  citation is flagged. A mechanism is never described by its test.
- **Data claims are checked (B9).** A line that says who writes, reads,
  watches, creates or owns a zone carries the claim as a fact — checked
  against the map's zone edges, the plan's flows (a feed over a declared
  family the code cannot show is "declared, not seen in the code") and the
  zone's partitions (`request_{Role}` has no single owner). Contradicted
  refuses the line; plan-only and unverifiable are shown.
- **Main jobs (B10).** Each process's main job is where its part starts in the
  plan's flows (else what it does most); a line naming a secondary job as the
  process's work is flagged, and a main job no line states is on the sheet.
- **Absolutes (B11).** only / never / no / none / nothing / without / all /
  every / always need a stated rule that says them, or a `not` claim the map
  confirms. A project adds its own in `.vibegraph/brief-vocabulary.json`
  (`absolutes`).
- **Coverage (B12).** Every rule a person stated, and the salient mechanisms
  (ranked by how many rules name a file and how many threads reach it), is
  cited or named in `omitted`. Doc lines are ranked by how much they talk about
  this code, a tool's own feedback and reference folders left out
  (`excludeDocs` for more).
- **The review sheet and notes (B13).** Before Ratify the card, `brief
  codebase show` and the inbox show each line's warnings, citations by role,
  what no line covers and the facts gaps; the button says "Ratify 15 lines, 2
  with warnings". **Brief again with notes** (`--note "…"`, repeatable, or the
  card) sends the person's corrections as stated input; a note no line cites
  and `omitted` does not answer is reported.

Measured on a throwaway copy of the repository that reported it: one STALE
line where there were nine (a citation written by 0.29.0, said as such);
editing a rule's text stales exactly the lines citing it; a brief again with
three notes rewrote the four wrong lines correctly, covered the missing core,
and its sheet showed five warnings, each true.

Tests: test:brief (8), test:brief-checks (7, fixture
`test/brief_checks_setup.mjs` on views_demo), test:e2e-brief (the sheet, the
Ratify label, notes).

## 0.29.1 — 2026-10-08 — panels in the app's colours; the inbox as chips, decisions at once

- **One surface.** The panel sheet (Inbox, Plan, Rules, Stack, Agent
  Manager, …) is no longer tinted per panel: it is the app's own surface, the
  panel told apart by its title and icon. The selected tab and section are a
  neutral highlight; the toolbar's buttons no longer fill with an accent when
  chosen. Inside a panel only the chips, the verdict pills and the operation
  words carry colour: the sheet redefines the accent tokens as neutral (one
  rule in `styles/kinds.css`, not an edit per panel) and gives the real ones
  back inside those bubbles, so prose, banners, borders and status icons are
  neutral. Errors stay red.
- **The inbox as chips.** Every inbox item is the panels' one item frame: its
  subject as a chip read off its id, each detail line a labelled bullet
  (`says`, `changes`, `effect`, `evidence`, `do`) with its file paths and box
  ids as chips; a proposed item sent whole reads as its fields, not JSON
  (`src/shared/inbox_view.ts`, so a new kind of item needs one table row).
- **Agree / Reject answer the click.** The item leaves the list at once and
  comes back with the reason if the server refused it; before, the buttons
  stayed disabled until a reply that, on a refusal, never cleared them. The
  server reconciles the plan once per plan state instead of three or four
  times a click (`src/server/reconcile_memo.ts`; ~400 ms each on a 116-file
  repository), which the Plan panel's Agree shares.

Tests: test:inbox-view (4); test:e2e-gui-design (the panels now share one
surface; a person's CLI step in it sets `VG_PERSON_NO_TTY`, which 0.28's
no-terminal guard requires); test:e2e-inbox (the subject chip).

## 0.29.0 — 2026-10-08

The Brief, the map facts it rests on, and zones named by the store the project
says they belong to.

### One store, not two: zones named by what the project says

The code knows only that a family is written THROUGH a client package, so the
map named its one derived store after that package: a zone the plan did not
group read "zone of @vendor/client-sdk" beside the plan's own store, and one
store showed as two. A zone's store is now read from the project, strongest
first, never guessed (`src/server/store_naming.ts`):

1. the declared topology places the family in a zone → that zone;
2. exactly one planned store is `reachedThrough` the client → that store, and
   the zone says it is one the code uses and the plan does not name (the map
   notes list them);
3. a RATIFIED software spec lists the client among its packages → the spec's
   tool (a draft names nothing);
4. otherwise the zone stays under the client, read as "the store behind
   <client> (unnamed)", with a note saying what would name it.

Two planned stores reached through one client is ambiguous: neither is chosen,
and the note says so. A spec is needed only for a store-like package that no
plan or declared topology names. Tests: test:store-naming (4).

### The Brief: a cited account of the system, on the map

One model call writes what the system is for (**Function**, ≤ 3 lines), how
it holds together (**Method**, ≤ 6) and its **Key features** (≤ 6), and
proposes group changes, box names, scopes for boxes the facts say nothing
about, and a start-here path. Nothing of it survives that the facts it was
shown do not support, and none of it is used until a person ratifies it.

- **Shown, then checked.** The prompt carries the derived map, the declared
  topology, the plan, the stated rules, the software specs and the project's
  docs, each fact under an id. A citation to an id that was not shown is
  dropped; a line left with none is kept as INFERRED and shown faded. A box's
  own id is no evidence for its name. Every line must use a word from a fixed
  vocabulary (`decides`, `partitions`, `audit-trail`, …; a project may add
  words in `.vibegraph/brief-vocabulary.json`, never redefine one). A line
  past a count limit is refused, never silently dropped; a line over 200
  characters is cut at a word and ends "…". A ratified group label the facts
  no longer support (a port, a list of names) is shown as a fact a rename can
  cite. What the checks refused and what the model left out are listed.
- **Ratified by section.** `brief codebase ratify|reject [spec|groups|scopes|path]`
  (names are decided with groups), the Brief card on the map or the Inbox. A person's step,
  refused from inside Claude Code. Groups, names, scopes and the path go into
  `.vibegraph/architecture.json`; the spec into `.vibegraph/brief.json`.
- **Stale, not wrong.** Each citation's content is hashed. When a cited line
  changes, the Brief line that rests on it reads STALE (card, `brief codebase
  show`, Inbox). A stated rule is hashed with the source of the functions its
  check names (by structural id, not line), so an edit to the function a
  `callers-only` rule guards stales a line resting on that rule, and moving
  code does not.
  `brief codebase --stale` re-briefs only those lines (`--estimate` with it
  says what that costs), and ratifying replaces exactly them.
- **Where it reaches.** `architecture.md` in the export opens with the
  ratified Brief. A hooked session starts with the Function and Method lines,
  and a prompt routed to a box's threads gets the Method lines naming that
  box, once per session. On the map, the card is pinned top-left and a line
  lights the boxes it names.
- **Cost first.** `brief codebase --estimate` (and the card's first click)
  says the calls and tokens before anything is spent; `--dry-run` prints the
  prompt; `--reply <file>` validates a saved reply with no model call.
- Also: the classifier sends a prompt over 24 KB on stdin, not argv.

Tests: test:brief (8), test:e2e-brief (1).

### The map's facts, before a Claude layer goes on top

A field review of 0.28.0 on a multi-process TypeScript repository listed
what the map gets wrong before anything model-written can cite it. Checked
against a throwaway copy of that repository, and pinned by
`test/fixtures/system/starters_demo` (test:field-map).

- **What the code does to each declared zone.** The declared topology's
  zones (the Resources lens, `topology.md`) said who MAY write them, never
  which processes DO: a zone the state service writes read "in: — · out: —".
  Each declared zone now carries the derived reads and writes, matched by name
  or by the families it holds (a per-person zone through its
  `request_{Role}__{Person}` pattern): "the code: written by …; read by …".
- **Start here walks the store.** The story's steps follow edges a thread
  takes, and the store-zone edges carried no threads, so no write or read was
  ever a step. A process's beats now come writes first, then reads and
  watches, then calls; a call nobody has given a role comes last instead of
  standing for the core.
- **Starters by path, all of them.** "started by server.ts" when three files
  have that name now names each starter's path. A starter that spawns through
  its own helper (`run(script)`) is listed too; such a helper does not make a
  one-shot script a process box. Two process files with one name in one
  package are two boxes (they had merged, the second overwriting the first's
  starters).
- **A plan name only on a box it is.** A planned process names a box only
  when it accounts for every entry point there. Otherwise the box keeps its
  name and says "contains the plan's …" (one planned item had named a box of
  18 scripts).
- **Stale labels are drift.** A ratified group label that lists names (2+ of
  them the declared principals or the identities `topology live` saw) while
  more exist, or names a port no member process shows, is substantial drift
  with the reason.
- **Zone counts explained.** A `{Placeholder}` zone is a name pattern, not a
  zone: the store card reads "51 zones + 1 name pattern", and its notes break
  the zones down by kind (21 `request_*`, 15 `record_*`, …).
- **One spawn's keys on one edge.** A script path several files end with is
  settled by the call's `cwd` (a literal, or a name bound to one, resolved
  against the file's folder for `import.meta.url` / `__dirname`). A hop that
  stays ambiguous no longer copies the call's keys onto every candidate.
- **Bird's-eye:** a web app's derived Browser box is its outside caller; the
  generic "Outside callers" box beside it is no longer drawn twice.

Not reproduced: "the System view is blank until a thread is selected" — on
Linux and with Windows Node against a copy, the map opens on the project
with its boxes in view, whatever lens was last used.

## 0.28.0 — 2026-10-07

### From a field session: a Python tool set, refactored with the hooks on

A maintainer's write-up of one working session on a real repository (about 25
standard-library command-line tools, a Windows-side Claude Code against a WSL
checkout) listed 30 problems. Each fix below has a fixture; most were
re-checked on a throwaway copy of that repository (deleted afterwards).

**The viewer on Windows with WSL**
- **A watch that fails never stops the server.** Recursive watch, then a
  guarded per-file watch, then polling, then off (`src/server/watch_project.ts`).
  On a `\\wsl.localhost\…` path it polls and says why. Before, one EISDIR from
  the per-file fallback exited the server before it listened.
- **The URL opened is the one bound.** The server prints `Open: http://127.0.0.1:<port>`
  after it listens, and `view` opens exactly that. It used to open `localhost`,
  which hangs under WSL's mirrored networking, and it built the URL before a
  busy port moved the server on, so `--open` showed another project.
- **A busy port says what holds it:** `Port 4200 is another VibeGraph 0.28.0
  serving /path; trying 4201` (new `GET /vg-about`).
- **Versions.** `view` prints its version. Each write to plan.json,
  constraints.json or architecture.json stamps `.vibegraph/writer.json` with the
  newest version that wrote it, and an older version warns at start-up. `view`
  and `init` warn when a local and a global install disagree. Node below 20 now
  stops the CLI with the reason.
- **The boot screen says what the first pass is doing,** with counts:
  `parsing 248 of 248 files — a large tree…`, then `tracing threads from N
  entry points`.

**Python layouts**
- **A thin script is an entry point.** `from pkg.cli import main` then
  `sys.exit(main())` seeds at `pkg/cli.py:main`, labelled with the script, and
  `coverage` counts the script as reached. A `__main__` call that resolves to
  nothing still gives an entry, on the module, naming what it could not find.
- **Sibling modules imported by bare name link.** `import envfile` in `tools/`
  (Python puts the script's folder first on the path) already became
  `tools.envfile`, but `envfile.load()` never matched it. Aliased project
  imports (`import pkg.helpers as h`) had the same gap.
- **`from m import *` and `globals().update(vars(m))`** bind every
  module-level name of a project module, including the filtered-comprehension
  form. The parser used to drop star imports entirely. `coverage` says when a
  file binds names at run time.
- **A project folder is never a third-party tool.** Methods called on project
  classes (inherited ones too, `parser.feed()` on an `HTMLParser` subclass) are
  attributed to the project module; the stack index carries `projectModules`.

**Reachability**
- **"Never named" reads the source**, not just 80-character previews, so
  functions named in a long dispatch table are named. Comments and docstrings
  don't count as uses.
- **Framework callbacks** are their own reason: `handle_*` on HTMLParser,
  `visit_*` on NodeVisitor, `do_GET`, `emit`, dunders. They are no longer dead
  code.

**Rules**
- **A rule names one definition.** `callers-only` / `calls-through` targets take
  `file.py:fn`, `pkg.module.fn` or a bare name. A bare name with several
  definitions is UNVERIFIABLE as ambiguous, with the spellings to use; it is
  never merged. A call counts only when it is bound to that definition.
  Before, another file's same-named function produced false offenders.
- **`import-only`** takes a module's plain name (`envfile`) and otherwise
  suggests spellings ("did you mean …"). A rule on a module that exists and
  that nothing imports now PASSES ("satisfied"); it used to read UNVERIFIABLE,
  which exits 2.
- **`constraints add` runs the check first.** UNVERIFIABLE is refused unless
  `--force`; `--dry-run` shows the verdict and stores nothing; a rule the code
  already breaks is stored, with a note.
- **Folders of old copies** (versioned names, archive-style folder names, deeper
  mirrors of live files) are named at boot, in the export and in `check`, with
  the `.vibegraphignore` line. Their offenders are marked "historical copy".

**Hooks and the person gate**
- **A person's step also needs a terminal.** CLAUDECODE does not cross
  `wsl.exe`, so a Windows-side Claude's commands inside WSL looked like a
  person's. Person-only steps (plan agree, constraints ratify, …) are now
  refused when no terminal is attached; `VG_PERSON_NO_TTY=1` is the escape for
  a person's own script. `doctor` and `hook install --target wsl` say how to
  carry CLAUDECODE through WSLENV.
- **Edits through Claude Code's PowerShell tool are checked**: the post-edit
  matcher includes `PowerShell`.
- **`doctor`** names a hook whose Node or CLI path no longer exists (an nvm
  upgrade) and reports when each hook last fired. `hook install` warns when the
  Node it records is nvm's. The docs say hooks start "from the next session, or
  when Claude Code reloads its settings".
- **Less noise.** The prompt hook needs two distinctive words, or every word
  of a seed's name. Everyday words ("line", "keep", "date") route nothing, and
  test threads only come up for a prompt about tests. More than 8 affected
  tests are summarised by file. `hook run` always prints what it did.

**Plan and inbox**
- An open question that an agreed module or a promoted rule may already answer
  is marked "possibly answered by …", by location: a rule naming a new
  top-level folder answers "at the repository root".
- `inbox` lists without parsing (0.4 s on the field repository); `--sensors`
  runs the code-reading checks.

**Not done, with reasons:** streaming the parser's output (output size still
counts against the 384 MB buffer; ignoring is the fix today); naming an
external program run by path (`shutil.which("x")` stored on `self`, then
passed to `subprocess.run`) needs value flow through an attribute, which
VibeGraph does not guess; and a mixed-up loop effect (a pure helper charged
with a same-named function's file-system call) did not reproduce, so the
case is pinned by a fixture and nothing changed. The release-side item (wait
until npm serves a new version before announcing it) belongs to the publish
step.

Tests: test:serve-watch (5), test:python-layouts (12), test:field-hooks (6),
test:writer-stamp (3), test:historical-copies (2), test:plan-answered (2);
fixture `test/fixtures/python_layout/scripts_demo`.

## 0.27.8 — 2026-10-07

### Arrows say what they carry

Asked for: arrows in the code view and the thread view that mean more. A call
arrow said what went in (its arguments) and nothing about what came back, and
nothing showed one call's result being handed to the next.

- **The IR records every name an unpacking binds.** `a, b = f()` was an
  assignment named `?`; it now carries `targets: ["a", "b"]` (Python tuples
  and lists, `*rest` starred; TS/JS object and array destructuring, shorthand,
  renames, defaults, rest). Additive — `name` and node ids are unchanged, no
  snapshot moved.
- **What comes back.** A call edge reads `(args) → names`. In the code view a
  call into another file's stub gains an amber `→ names` line; in the thread
  view the edge label does the same. One rule, `src/shared/call_flow.ts`,
  serves both views.
- **Data-flow lines.** Within one function, a later call whose arguments read
  a name an earlier call's result was bound to gets a dashed amber line from
  producer to consumer, labelled with the names (`load ⇢ run_training` via
  `train_x, train_y`). The latest earlier binding wins (a rebinding takes the
  flow); `x.shape` reads `x`; strings and keyword names do not count. They are
  drawn over the layout and never move a card; in the thread view they appear
  only between drawn nodes, so the Primary rank stays quiet. Named limit: by
  name, not by value — no aliasing, containers or attribute stores.
- Tests: `test:call-flow` (5), `test:code-layout` (data-flow edge from the
  stub), `test:e2e-thread-dataflow` (fixture `test/fixtures/threads/
  dataflow_demo`: four lines with their names, the call edge's
  `("data.csv") → xs, ys`, amber labels). A label that finds no clear spot is
  still not drawn; every thread edge now carries its full text as
  `data-edge-carries`.

## 0.27.7 — 2026-10-07

### Cards fit their content

Reported: in the file view's card mode, cards stretched sideways with dead
space. Measured on the pump-wear example, a median of 109px of nothing per
card — a 108px right reserve every card kept for the hover action strip,
240px minimum widths, and import / call / return text counted at 7px a
character when it paints at 6–6.7.

- **The action strip rises above the card on hover** (a child of the card,
  so moving onto it keeps the card hovered) instead of being given 108px of
  every card; a card keeps a 16px right margin (`--node-action-reserve` and
  buildLayout's `ACTION_RESERVE`, one value).
- **Sized from the fonts painted:** import, return, raise and call cards
  measure their small label and their 11px / 10px text; an `except` block
  measures its label; the minimum widths come down (a short card is no longer
  held at 240px).
- **Long text wraps onto a new line in the card** (cap 560px, was 1000), and
  a card whose text wraps is as wide as its longest WRAPPED line — a long
  token moved whole to the next line no longer leaves the card at the cap.
- Median dead space a card: 109px → 26–37px (the margin and the arrow tips
  included). `test:e2e-big` gains `fileview-tight-cards.spec.ts`: the median
  card ends within 48px of its text, no leaf card carries more than 130px,
  and the strip on hover sits above its card.

## 0.27.6 — 2026-10-07

### The file view's code mode reads as the code's story

Asked: arrange a file's functions, objects and calls to tell the story left
to right — what runs first, what it calls, what it passes. The order was
already roughly right (call depth as columns), but nothing said why: the call
lines were off by default, a callee sat top-aligned with its caller wherever
the call was, and the story stopped at the file's edge. Now, all from the IR:

- **What runs first leads.** Module-level code that runs (`if __name__ ==
  "__main__":`, a bare call) is badged "runs first", and its group is laid
  out first; the card view gets the same ordering.
- **Every call is its own line**, drawn by default in code mode, leaving from
  the line that makes it and ending at what it calls, labelled with what it
  passes — the call's arguments (`model, train_x, train_y`).
- **Level with the call:** a callee sits with its header on the line that
  calls it, in call order, so the lines run straight across.
- **The story does not stop at the file's edge:** a call into another file
  ends at a stub beside its line — `load()` · `data.py` — in a lane of its
  own right of the caller, clear of the rows where its in-file calls leave.
- Edge labels render on the file canvas at all (its default edge had dropped
  them).
- The semantic-zoom e2e now pins 0.27.2's rule that a zoomed-out chip grows
  only into the room reserved for it (it asserted the old unbounded growth).

## 0.27.5 — 2026-10-07

### `view` loads in seconds, and re-reads only what changed

Reported on a 58-file Python project in WSL: `view` took minutes to show
anything. Measured: the server was up in 3.6 s, but every start and every
external save (another session was editing four files) ran the WHOLE pipeline
— all files re-parsed, all 1,180 threads re-extracted, 24–41 s a pass — and
the first draw waited for two of them.

- **The server's pipeline cache** (`src/server/pipeline_cache.ts`, the CLI
  envelope cache's rules): a file is parsed again only when its CONTENT
  changed; a thread is extracted again only when its seed or a file it walks
  changed after linking (every thread when a module path or a method moved);
  a new path, a changed parse-context file or a new tool parses everything.
  Kept in memory and under `~/.cache/vibegraph-knowledge/server/`, so a
  restart starts warm. Content hashes rather than git: an uncommitted edit is
  exactly what the watcher reports.
- **The last run's map at once:** a tab opened while the server starts is
  sent the previous run's project immediately (the "re-linking…" pulse is
  on), and the fresh one when the pass ends.
- **Each pass says where its time went:** `[Project] full pass 7.6 s — parse
  0.9, link 0.9, …` with why it parsed or extracted what it did;
  `VG_TRACE_WATCH=1` names the file that set off each re-parse.
- Measured (a copy of the project): a cold pass 26.7 s; a restart with
  nothing changed 9–11 s, with the map on screen at 3.8 s; one file edited
  while running 7.6 s (that file parsed in 0.9 s, no thread re-extracted).
  The e2e suites start every run on a fresh cache (`playwright.config.ts`).
- Still large: the project message is 32 MB for 1,180 threads; sending only
  what changed is the next step.

### `plan review --agree all`

`--agree` / `--reject` take `all` and a whole section (`processes:*`), beside
`section:id` lists; what the other flag names explicitly stays its own
(`--agree all --reject stack:yjs`).

## 0.27.4 — 2026-10-07

### One answer to "which machine is this"; skipping what is not live code

From running `view` in WSL (a Python project) and on Windows (a TypeScript project):

- **`src/server/host_os.ts`** decides what differs by machine — Windows, WSL,
  Linux, macOS — and every OS-dependent choice asks it:
  - **the browser:** on WSL, the Windows browser through interop (`wslview`,
    then `rundll32.exe`, then `powershell.exe`), started from a Windows folder;
    `xdg-open` in WSL usually opened nothing. On Windows, `rundll32`, so a `&`
    in the URL is never parsed by `cmd`;
  - **Claude:** on WSL a Linux Claude (e.g. `~/.local/bin/claude`) is used
    before a Windows one on the PATH (`/mnt/c/…`), which stays the last resort;
  - **Python:** the server spawns the interpreter `view` resolved (`python3`,
    else `python`, else `VG_PYTHON`) instead of the bare name `python3`
    everywhere — a Windows install with only `python.exe` works.
  `view` prints the host, Node and Python it runs with.
- **The CLI warns** (never stops) when Node is older than 20, and when the
  Windows install of the package is being run from inside WSL through `/mnt/c`
  — the cause of a slow `view` on the system's Node 18.
- **`.vibegraphignore`** at the project root: folders and files the project
  says not to read (a name anywhere, a root path, a glob; `VG_IGNORE` for one
  run). Every walker honours it — the parse, the envelope cache, the server
  and its watcher, the hooks, the system tier — and what it skipped is
  reported with the build folders already reported.
- **A parse too big for its buffer no longer fails in silence.** The output
  limit is 384 MB (was 64), and past it the error says how big and names
  `.vibegraphignore`; before, "parse_cst.py failed:" with an empty message.
  Measured on a copy of a project with 188 archived copies of its Python: the
  export now completes either way — 11 minutes and 10,198 thread contracts with
  `_archive/` read; 32 seconds and 1,178 without it. The export README says
  why each folder was not read (compiled output, or named in the file).
- **`view` no longer reinstalls black on every start.** The "one time"
  install probed only the environment libcst was found in, never the folder
  black had been installed into, so pip ran at each launch; it is now found
  there (129 ms).

## 0.27.3 — 2026-10-07

### Scrollbars

Every scrolling panel (the threads column, the side panels, the sheets) now
draws a slim rounded pill instead of the browser's default bar: muted at rest,
brighter and a little wider under the cursor, the thread accent while dragged,
floating in a clear track. Colours are tokens, so the light theme follows;
Firefox gets the closest it draws (thin, same colours). The code editor's
scrollbar uses the same three states.

## 0.27.2 — 2026-10-07

### Zoomed out, a container chip stays in its room

Reported with a screenshot: in a test with a loop over files holding a loop
over an awaited plan, the outer `FOR` chip's second line slid under the inner
chip, and the inner chip sat on the first card. Boxes are spaced for a chip
at 11px; below full zoom the chip's font grew with zoom-out (up to 64px)
inside the same width, so it wrapped taller than the room it was given. Now,
below full zoom, a chip is one line ending in "…", grown only until that line
fills its reserved height; the whole label stays its title and its tooltip.
The chip's width cap includes its padding (`border-box`), so a one-line chip
never runs past its container. `test:e2e-chip-long` now checks both shapes at
the overview tier too, with a fixture of the reported shape (red on 0.27.1:
chips on chips and on cards).

## 0.27.1 — 2026-10-07

### Finding Claude on every platform

Reported from Windows: "claude CLI not on PATH — Install Claude Code" while
`claude` worked in PowerShell, and Chat, Analyze, Intent, READMEs and `scope`
all failed. Four copies of the lookup split `VG_CLAUDE_BIN` on spaces and
started the bare word `claude` with no shell — which on Windows finds only a
real `.exe`, never npm's `claude.cmd` — and searched PATH alone.

- **One resolver** (`src/server/find_claude.ts`), used by every Claude call:
  the one-shot spawns and tier routing, the GUI chat, `classify` / `scope` /
  `architecture --propose`, and the startup check. A test fails if any other
  file reads `VG_CLAUDE_BIN` or starts `claude` itself.
- **Order:** `VG_CLAUDE_BIN` (a path used whole, a JSON array, or a quoted
  command line), the new per-user `config set claude.bin`, PATH searched as
  the OS does (npm's Windows wrapper followed to the package's `claude.exe`,
  or its JS entry run with this Node), then the install places — native
  installer, npm's global folder, Homebrew, `~/.claude/local`, the editor
  extension's bundled binary (newest, labelled). `VG_CLAUDE_ARGS` adds
  arguments; a pinned `--model` is read from the parsed arguments.
- **Never through a shell:** a prompt with `& % ^ "` reaches Claude as
  written.
- **`doctor`** says which Claude was found, how, and its version (`--version`
  once, cached by mtime). When none is found, the message lists every place
  tried and both fixes, instead of "install".
- **The classifier** (`classify`, `scope`, architecture proposals) no longer
  passes `--dangerously-skip-permissions`: it allows read-only tools and keeps
  the deny list, so your own permission policy still applies.
- **Behaviour change:** a bare `node` in `VG_CLAUDE_BIN` now means the Node
  running VibeGraph; a relative script path is resolved where it was set.
- Verified on Windows with npm-only Claude Code (only `claude`, `.cmd` and
  `.ps1` on PATH): it resolves to the package's `claude.exe`.
- Found on the way, not fixed: `test:e2e-hooked-run`'s blocking case fails on
  this machine at 0.26.0 too (the run completes without the post-edit block);
  it predates this change.

## 0.27.0 — 2026-10-06

From a field review of 0.25/0.26 on a finished project (the direction
review): the map drew wrong facts, and the plan did not follow the project.
Worked as the review's modules, cheapest and most misleading first.

### Refused attempts are not writes; keys only from the payload (M5, M7)

- **Attempts** (`src/server/attempts.ts`). A live check or probe that tries
  writes the platform must refuse was drawn as those processes writing. A
  write is now an ATTEMPT when it sits — directly, or through its enclosing
  function at every call site — inside an attempt wrapper: a call named like
  one (`attempt`, `expectRefused`, `assert.rejects`, `….rejects`) or a project
  function shaped like one (its `try` calls one of its parameters and its
  `catch` returns), with the text around it expecting a refusal; or when its
  file is declared negative (`"negative": [globs]` in
  `.vibegraph/operations.json`). A site expected ALLOWED (a control) stays a
  write. An attempt is drawn red and dashed, is its own operation in
  In → Process → Out, and never makes a box "write".
- **Keys from the call that crosses, only.** A zone edge's keys come from
  the store call's own node (by id and line), never from a call on the same
  line (`results.push({ check, expect, got })`); a constructor's options
  (`new Client({ readOnly })`) are not a payload; a hop's keys come from its
  own call even when sibling calls share a structural id (crossings now
  record their `line`).
- **Two false data operations gone:** a call that wraps another operation on
  the same zone is the container, not the operation; a string / array
  built-in on a parameter (`b.replace(…)`) is never a write.

### Runtime processes, not packages; runs-as from evidence (M3, M4)

- **A process is a box** (`arch_model.ts`). An entry point whose file
  listens, or that another project file starts with a local spawn / fork /
  exec, is its own box (`cluster:process:<root>:<file>`, `runtime: {how,
  by}`) instead of a member of its package's cluster; the one-shot scripts
  and CLIs of the package stay together. A file with routes is already its
  framework's API box. A shell script running another script is a step of a
  one-shot job, not a process start; a platform's remote command
  (`stream.exec`) is not a local start; an ambiguous hop (one literal,
  several parsed files) is evidence for none. Bird's-eye never folds a
  process into its package.
- **Who it runs as, from the code** (`arch_identity.ts`, `identity` on the
  box): an identity-shaped env var it — or a module it imports — reads
  (`…_PERSON`, `…_USER`, `…_ROLE`, `…_ACCOUNT`, credentials, and a
  `…CONFIG_PATH` when it holds a platform / database / cloud client); one its
  starter passes in the spawn's `env`; an identity its starter creates for
  the run (`createRunIdentity`, `createAccount`, …). Strongest first. No
  evidence, no badge.
- **The plan names, never asserts.** A plan process with `entryPoints` is
  ANCHORED to the box running them; one placed only by `at` is LOCATED, not
  anchored (said on the box) and gets no runs-as badge from the plan. An
  anchored process shows the plan's principal only when the code shows an
  identity source — and an identity created per run wins over the plan's
  name, with the disagreement in its notes.
- **A writer must hold a client for the store.** Logic shared with the real
  writer, run by a process with no edge to the store's client tool (an
  offline tool given an in-memory store), is not drawn writing the store;
  the count is in the notes.
- **Decision structures sit where they run:** placed by the threads that run
  their evaluating functions, or that run steps in their file, a running
  process outranking a library or CLI that shares the logic.

### One decision inbox, terminal and GUI alike (M11)

The review's finding: decisions were made in the terminal and person-only
steps (refused under Claude Code, rightly) piled up where nobody looked.

- **`vibegraph-knowledge inbox`** (`src/server/inbox.ts`) lists every step
  waiting for a person — plan proposals, a proposed objective, changes to
  rules, rules an agent stated, an architecture groups proposal, scopes,
  skill and software-spec drafts, and open questions at the cap — each with a
  stable id and its evidence; exit 1 while any waits. `inbox agree|reject
  <id>…` (or `--kind <kind>`) decides through each store's own operation; a
  person's step, refused under Claude Code.
- **The Stop hook ends each Claude turn with one line** when something waits
  ("5 decisions await the person (…): `vibegraph-knowledge inbox` in a
  terminal outside Claude Code, or the Inbox in the viewer. Do not decide
  them yourself"), and the session-start orientation says the same (it
  replaces the plan-only "Review backlog" line).
- **The Inbox panel** — a toolbar button with the count (shown while
  something waits), the same list grouped by kind, Agree / Reject.
- Found on the way: the panels-below-toolbar e2e had been red since the
  0.22.0 PanelSheet (it searched for a right-edge box and closed through the
  scrim); it now measures the sheet — a modal stacks above the toolbar, a
  docked sheet starts below it.

### Decisions in the plan; the plan follows the project (M1, M9, M10)

The review's finding: the important decisions were made in the terminal and
recorded everywhere except the plan — in a question's own text ("Likely not
needed: …", "ANSWERED: …"), a handover note, commit subjects, the code — so
the map kept drawing a store the project had decided against.

- **A decisions ledger** (`plan.decisions`, `src/server/plan_decisions.ts`).
  A decision says what was decided, where it came from (`open:q11`,
  `commit:<sha>`, `doc:<file>:<line>`, `sensor:<key>`) and the plan edits it
  implies (`effects`, the ordinary ops). An agent's decision waits PROPOSED;
  a person agrees it once and its effects apply together — and a decision
  from a question closes that question with it. New ops: `decide`,
  `supersede`, `agree-decision`, `reject-decision`.
- **Supersede** is first-class: the item is `dropped` with `supersededBy`
  and `supersededWhy`, leaves every map and the "planned, not built" chip,
  and stays on the record (`plan show` → "Superseded"; the hooked session's
  plan says "Superseded — do not build"). An agent's supersede becomes a
  proposed decision.
- **Drift sensors** (`src/server/plan_sensors.ts`; zero tokens; they WRITE
  NOTHING): an item resting on a question that says it is not needed → a
  supersede; an open question that begins ANSWERED → a decision that closes
  it; a running process no planned process covers → add it; a process that
  creates its own identity per run with no principal for it → add one; a
  planned process placed only by `at` while the code runs one of that name
  elsewhere → anchor it; an item still unbuilt 30 revisions on while half
  the processes are built → supersede, or keep; a commit subject or a line
  of `HANDOVER.md` / `DECISIONS.md` / `docs/decisions.md` that records a
  decision → record it (one that says "q10 answered" is folded into q10's
  finding as more evidence). Each finding is an inbox item with its
  evidence and effects; agreeing records the decision and applies them,
  rejecting records the "no", so it does not come back. Groups that drifted
  from the code and stale scopes are listed as things to look at.
- `inbox` now parses the project to run the sensors that read the map
  (`--quick` skips that); the Stop hook's count includes the ledger and the
  sensors that need no map.
- Measured on the reviewed project (a /tmp copy): q11 → supersede the query
  projector and its store; q8, q9, q10, q13 answered, each with its commit;
  a process's per-run identity → a principal; the three runtime boxes no
  ratified group holds → "groups have drifted".

### Store names built at run time; live next to declared (M6, M8)

- **Names followed further** (zero tokens). A hole filled by a loop variable
  over a literal table (`for (const [key, part] of PARTS) … entityPath(id,
  part)`) is every value of the table — one data operation per family; a
  plain function around a parameter (`/labels/${docIdFor(p)}`) is still that
  parameter's hole; `this.#m()` links to the class's own private method (a JS
  private method cannot be overridden); an object assigned after a typed
  declaration (`let ops: Ops | undefined; … ops = { save: … }`) implements
  the port. On the reviewed project (a /tmp copy) the gateway now reads
  status, provenance, labels and every entity part and writes requests, and
  ingest writes the parts and their labels — from the code alone.
- **Stated where nothing can follow** (`src/server/registered_access.ts`).
  `.vibegraph/operations.json` takes `paths` (a helper → its family) and
  `access` (the operation at a file:line, with a one-line why). Each such
  operation says STATED on its edge with the reason; without the file nothing
  is guessed; an unknown family is reported, not drawn. The reviewed
  project's flow studio — watching a list its deployment model builds at run
  time — is drawn this way.
- **Live next to declared** (`src/shared/live_inventory.ts`,
  `src/server/topology_live.ts`). `topology live` also takes an INVENTORY —
  any JSON listing named resources (a platform's own listing tool) — or
  `--from <file>`; zones match by name only. The CLI, `topology show` and the
  store card read "N declared · M provisioned · K live identities", with the
  never-provisioned zones and the undeclared live resources listed.
- **A catalogue word is not a writer**: `owner-of-entry`, `any-writer` and
  the like are dropped from a store's writer count.

### A direction from nothing; groups re-formed from facts (M2, M12)

- **`plan observe`** (`src/server/plan_observe.ts`, zero tokens): the
  direction the code already takes — each process (a running one by its
  entry file, the rest by package; names shared by several get their package
  prefix), who it runs as (one principal per identity the code shows), the
  stores and zones it touches — as plan items an agent would propose, each
  `groundedIn` the fact. With no plan it starts one (a person's step: refused
  under Claude Code) whose objective says it is not stated, and asks for it.
  On the reviewed project (a /tmp copy, plan removed) it finds the decider
  (its own identity per run), the gateway (its partner identity), the flow
  studio, the app server and the admin tools.
- **`plan draft --direction`** (spends tokens, opt-in): the project's own
  prose — README, CLAUDE.md, HANDOVER.md, docs/**.md, recent commit
  subjects — goes to the draft, which may now answer `objective` (a
  "Proposed objective" question a person adopts; the citation is not carried
  into the objective) and `name` (a label for an observed process) beside its
  items; every line passes the same quote gate, an unquoted one is INFERRED.
- **`architecture --regroup`** (`src/server/arch_regroup.ts`, zero tokens):
  groups re-formed by the identity the code runs each process as (and its
  port — `runtime.port`, read off the process's own `listen` call), then by
  package. A label says only what every member shares and is REBUILT from the
  members on every derive (`labelFrom: "facts"`,
  `src/shared/arch_fact_label.ts`). Pending in replace mode: ratifying
  replaces the groups it was formed against. The inbox offers it when the
  groups drifted.
- **Bird's-eye** folds a generic transport library (`@grpc/grpc-js`,
  `fetch` — role http-client, not essential): it says how a process talks,
  not to whom. Overview and Tools still draw it. The reviewed project's Real
  Bird's-eye: 16 boxes → 14.

## 0.26.0 — 2026-10-06

### In → process → out for every box (part 1 of 3: the facts and the words)

From a field note: a box's card said what it IS (a role, its funnel, call
sites) and never what data reaches it, what it does with it, or who takes
what it produces.

- **One vocabulary** (`src/shared/operations.json`): 13 processing words —
  serves, renders, calls, runs, routes, reads, writes, watches, stores,
  queues, decides, validates, transforms — each with a definition, an icon,
  a colour token and the IR evidence that implies it. A project may ADD words
  in `.vibegraph/operations.json` (a redefinition is refused with its reason).
- **`src/shared/node_io.ts`**, zero tokens: a box's In and Out rows follow the
  DATA (a read brings data back to the caller), each with the keys the call
  spells, the stated and planned rules on that edge, and through a store the
  path on — who takes what it wrote, who wrote what it reads. Its process is
  the vocabulary's words whose evidence is on it, each citing that evidence.
  What the IR cannot see is said ("no reader of this is seen in the code").
- Zone edges now carry the payload of the access call (`writeDoc("status",
  id, { phase })` → keys `phase`).
- `architecture.md` gains **What each box does (in → process → out)**.

### In → process → out on screen (part 2 of 3)

- **The inspector is an In → Process → Out card.** Click a box: **In** lists
  who sends it data (a store's reads included, since a read brings data
  back), each with its operation, the keys as JSON chips, the rules on that
  edge as rule chips, and through a store who put it there; **Process** is
  the box's words as pills in their colour — click one for its definition
  and the evidence; **Out** lists who takes what it produces, with the keys
  and who reads it next. Click a row and that path lights on the map; the
  rest dims. Chips are the software-spec chips.
- **Payload chips on the edges.** An edge that carries an operation or keys
  the code spells shows them as chips — the operation first, then the keys,
  then a short protocol — in exactly the room the router left for its label;
  what does not fit is "+N" (all of it on hover and in the inspector). A
  planned boundary keeps its "· N keys · 1 rule" label.
- **Words on the cards at Detail** (Tools, Payloads): each card carries its
  process words; the card's height counts them, so routes go around them.
- A project's own words (`.vibegraph/operations.json`) reach the screen
  (carried on the envelope, never written to an export) and draw dashed.

### Scope this node (part 3 of 3)

Where the code says little about what a box does (on the field project, 4 of
25 boxes — SDKs and platform clients), Claude can describe it — under the
same rules as the architecture proposal.

- **The dossier** (`src/server/node_scope.ts`): the box's call sites as
  numbered lines, its edges by id, any ratified software spec's definition
  and operations, and what the code already shows. Only those are citable.
- **The gate**: a word outside the vocabulary and a box that does not exist
  are refused and named; a citation it was not shown, or the box's own id, is
  dropped; a claim left uncited is kept as INFERRED (faded).
- **Proposed, then a person's decision.** The scope waits in
  `.vibegraph/architecture.json` (`scopes`) and changes nothing until it is
  ratified — in the inspector (**Scope with Claude** → Ratify / Reject, with an
  optional note to steer it) or with `vibegraph-knowledge scope <box>` /
  `scope ratify|reject <box>` (refused from Claude Code). A ratified scope's
  words and rows join In → Process → Out marked *scoped*, and
  `architecture.md` carries it.
- **A scope goes stale with its code.** Each scope records a hash of what it
  was shown (the citable code lines, edges and spec lines — not the list of
  other boxes, so a box added elsewhere stales nothing). When that changes it
  reads STALE in the inspector, in its words' evidence, in `architecture.md`
  and in `scope list` (exit 1); the flag is worked out on read, never stored.
- **Over MCP.** `vibegraph_node_io` answers any box's In → Process → Out —
  over the same map the GUI's Real view draws (store cards, decision
  structures, outside callers), with its scope — and names the nearest ids
  for a wrong one; `vibegraph_scope_node` drafts a scope (spends tokens), and
  ratifying stays a person's step.
- The scope button appears only on boxes the code derives (a store card, a
  decision structure or an outside caller is already drawn from facts).

## 0.25.0 — unreleased

### The System view: the project in its own words, simpler as you zoom out

From a field report on a finished project: the Real map showed the central
store as a five-zone "file store", none of the identities, no outside caller
and no decision structure, even though plan check called them realised; the
Overlay drew 11 zones for 5 families and the store twice; and Bird's-eye,
Overview and detail drew the same boxes in Plan and Overlay.
[docs/guide/VISUALISATION.md](docs/guide/VISUALISATION.md#3-start-with-the-architecture-map).

- **Real says what plan check found.** A process plan check calls realised
  carries the plan's name ("named · plan"; the code's name is in the
  inspector) and badges who it runs as. Each store is one card under its plan
  or declared name with its declared size and writers ("order ledger · 7
  zones · 5 writers"); the zones the code touches sit in its box, labelled by
  the plan, sized by the declaration, badged by who may write them, and a
  zone only one identity writes gets a "written only by …" box. A process that
  serves calls (routes, a `.listen()`) has an **outside caller** in front of
  it: the plan's external process when one has a boundary to it, else
  "Outside callers". Each declared state machine and decision tree is a card
  on the process that evaluates it; the declaration's and the code's reading
  of one structure are one card. The plan's flows are a **Flows** list: pick
  one and its path lights up.
- **Overlay matches by identity, not label.** A zone by its families, a
  process by its entry points or its `at` path, a store by its id or the tool
  it is reached through. A matched plan item adds its name and "planned ✓" to
  the real box and is never drawn again.
- **Every mode zooms semantically.** Bird's-eye: processes, stores, outside
  callers, decision structures and trust boundaries; zones and the store's
  SDKs fold into the store card; everything planned but not built folds into
  one "N planned, not built" chip; unclassified tools are left to Tools.
  Overview adds the zones; Tools / Payloads draw everything. Going from
  detail to Bird's-eye never adds a box, and switching Real / Plan / Overlay
  keeps your zoom.
- **The map shows the zones plan check sees.** A call to a planned store's
  `access` function with a literal zone is drawn as that zone, as plan check
  already counted it.
- **The System view opens on the project.** If Subsystems is remembered on a
  project with no subsystem tier, the map is drawn instead of an empty
  canvas, and a launchpad chosen only because the architecture had not
  arrived yet gives way to the map when it does.
- **Topology freshness on Windows.** A source registered with its inputs as
  one space-separated string (as a Windows shell passed them) matched no file,
  so it read stale for ever after every run. Inputs are now split on spaces
  and commas, `\` becomes `/` and a leading `./` is dropped, in `topology add`
  and for sources already registered; a run whose inputs match nothing says
  so.

## 0.24.0 — 2026-10-05

### The plan's open questions: shown whole, closed on purpose, kept on the record

From a field report (plan revision 205, 9 of 10 questions open): the only
control on a question was "✓ Answered", which read as a status badge, so the
operator could not tell how to close one; a dropped question was deleted and
looked like a broken panel; long questions were clipped to two lines with
the answer in the clipped part; and in "Everything" the questions sat
10,000 px down.
[docs/guide/VISUALISATION.md](docs/guide/VISUALISATION.md#8-planning--a-hypothetical-project-beside-the-real-one).

- **Shown whole.** A question card grows with its text, which wraps; no line
  clamp, no ellipsis, no inner scroll. A question may now be up to 1,200
  characters, room for the answer as it is found.
- **Close and Drop are labelled actions.** "Close — answered" and "Drop — not
  needed", each confirmed, each with an optional note recorded in the plan
  history (`close open q3 — <note>`). "ANSWERED …" at the start of a question
  shows as a passive tag. A person's step: refused from an agent, and from the
  CLI under Claude Code (`plan close|drop|reopen open qN [--note]`).
- **Closed and dropped stay on the record.** A collapsed "Closed and dropped
  (n)" group shows each one's state, revision, who, when and note, with
  Reopen. Only open questions count against the cap of 10. `plan show` lists
  them.
- **Reachable.** A summary near the top of "Everything" ("9 open questions (cap
  10) · 4 look answered") jumps to the questions; at the cap, adding one more
  lists those that look answered with "Close all answered" (one confirm naming
  every id).
- **The panel follows edits made elsewhere.** A plan or architecture store
  changed by the CLI or another session reaches an open panel within a second
  (they are polled by modification time: an atomic save replaces the file, and
  the directory watcher lost it after the first one).

### The map: the plan switch and legend below the lens bar

The Real / Plan / Overlay switch and the legend sat on the lens bar's row and
covered its end on narrower windows. The lens bar now publishes its measured
bottom edge; the proposal bar, the switch with the legend under it, and the
node inspector all start below it.

## 0.23.1 — 2026-10-05

0.23.0's content, published whole. 0.23.0 (like 0.21.1) went to npm with 3
files instead of ~93: the package's build output is never committed, and it
was published straight after a fresh export with nothing built. `npm
publish` now builds the package itself (`prepublish.mjs`, run as
`prepublishOnly`) and refuses to publish if the CLI bundle, the viewer or the
parser scripts are missing. Use 0.23.1, not 0.23.0.

## 0.23.0 — 2026-10-05 (broken publish: 3 files — use 0.23.1)

### Architecture groups that stay true as the project grows

A ratified group used to name exactly the boxes it wrapped, so every cluster
added later fell outside every group without a word, the proposing model
never saw the plan, and a ratified map was never re-checked.
[docs/guide/VISUALISATION.md](docs/guide/VISUALISATION.md#3-start-with-the-architecture-map).

- **Membership by rule.** A group carries `match` rules over facts the map
  already holds (folder, package root, family, framework, tool role or name;
  `src/shared/arch_rules.ts`) beside the boxes it names. Code that fits a rule
  joins the group on the next change, with no model. A named box stays put;
  otherwise the most specific rule wins; `exclude` keeps a box out.
- **The plan in the proposal.** Claude sees the objective and the planned
  processes, modules and stores with their folders, is asked for rules that
  will hold as the plan is built, and may anchor a group to a planned item
  (`planned`, citable as `plan:processes:<id>`) before its code exists. The
  zero-token **Seed groups** gives every planned process a rule on its `at`
  folder; one not built yet waits instead of being refused.
- **Drift since ratification.** Ratifying stores a baseline. On every change
  the map compares against it (`src/server/arch_drift.ts`): new clusters the
  rules placed are counted; clusters no group holds, a new deployment unit, a
  new planned process or an emptied group are *substantial* and the bar offers
  **Update groups** — a model extends the ratified groups (fixed: it may only
  add), a person ratifies. CLI `architecture --drift` (exit 0/1/2) and
  `--update`.

**Behaviour changes:** `--seed-plan` seeds unbuilt planned processes as
waiting groups; the map re-reads `architecture.json` and the plan when they
change on disk, not only on a re-derive.

## 0.22.0 — 2026-10-05

### Rules you can review, one panel frame, one colour per kind of thing

From a field inspection of the viewer: the stated rules were reachable only
half-way down the Agent Manager's legacy run form, with no id, no verdict, no
proposals and no Accept button; every panel was a different shape in the same
grey; a plan's verdicts were walls of italic prose. Six changes,
[docs/guide/VISUALISATION.md](docs/guide/VISUALISATION.md#7-knowledge-that-survives-rules-skills-stack).

- **One colour per kind.** A single table (`src/shared/kinds.ts`) gives each
  kind of code object a hue and an icon — process, function, module, store,
  zone (dashed), path, type, JSON, XML, identity, setting, external service,
  rule, open question (dashed). Every chip and the legend (**Key** in any
  panel) derive from it; adding a kind is one row. A kind comes from a fact
  the analysis holds, never from the words. Clicking a chip goes to the object.
  Verdicts are a different shape (a pill with a dot).
- **A light theme.** The toolbar's theme button: dark (the default, as
  before), light, or follow the system. The code view stays dark.
- **One panel sheet.** Plan, Rules, Stack, Agent Manager, Direction, Models and
  the Board open in the same centred sheet (`min(1100px, 92vw)` ×
  `min(820px, 88vh)`), each with its own faint tint, a tab row to switch
  without closing, a section column, Esc to close, and **Dock** to keep it at
  the side. A pin opens the Board docked, so the graph stays usable.
- **Concise plan items.** A header line and at most three labelled bullets of
  chips, longer lists cut to three and "+N", the verdict prose folded under
  "Why realised · 14 files · 9 entry points", a scorecard that filters.
  `plan check --json` findings carry `facts` (the bullets, typed chips) and
  `numbers` beside `detail`.
- **A Rules panel.** Its own toolbar button, with a badge counting reviews that
  wait for a person (agent-stated rules plus open proposals). Each rule shows
  its id, who stated it and its live verdict from the same function
  `vibegraph-knowledge check` prints (`src/server/constraint_report.ts`, now
  shared). **Awaiting you**: Ratify / Remove an agent's rule; Accept / Reject a
  proposal shown before and after. The thread view gains a **rules** chip
  listing the rules on that thread.
- **History names the person.** Accept, reject, edit and ratify — from the
  panel or the CLI — record `who` (git `user.name`, else the account name);
  a rejection and a ratification are recorded too (they were not).

### Thread view: `if` and `try` boxes no longer cover cards

On a script thread whose functions call the same helper from many `if`
blocks, a box stretched from its own call site to wherever the shared card was
drawn, over every card between (one 276-card thread: 99 cards straddling a box
edge, sibling boxes overlapping, chips on cards). Four causes, all fixed:

- A card several calls reach is drawn once; a box now wraps only the members
  placed by a call written inside it (the call site's structural id starts
  with the box's). A block whose calls are all drawn elsewhere keeps its old
  box only if that covers no other card.
- A box hugs the column of its own calls; a call nested in another call's
  arguments, drawn one column right, no longer widens it over other callees.
- Boxes are sized from the cards' measured size, not a 200×75 guess; rows are
  spaced by their tallest measured card on threads up to 400 cards.
- The row spacing that reserves room for box chrome never saw the boxes in the
  live view (the drawn thread carries none); it is now given them.

**Behaviour changes:** panels no longer open as right-hand drawers (use Dock);
opening one panel closes another; the Stack panel's "state a policy" opens the
Rules panel's form; the brief's light-theme chip lightness (30%) failed its own
4.5:1 test on teal, so light chips use 25%.

## 0.21.1 — 2026-10-05

### A large Resources lens stays responsive

On a topology where every principal may read every zone, the lens drew one
edge per grant. A generated catalogue of ~50 zones and ~24 principals drew
over 1,500 edges, spent ~0.4 s laying them out on every open, panned slowly,
and laid out again whenever the project re-derived.

- **Reads that carry no information per edge are folded onto the cards.** A
  zone every principal may read says "read by all N", and a principal that may
  read every zone says "reads every zone". If the remaining reads still exceed
  150 edges, they are summarised on the zone cards too. Writes and drift are
  always drawn.
- **Select a zone or principal to draw its reads.** The cards stay where the
  folded map put them, so nothing moves when you click.
- **A large map is laid out behind a spinner.** Over 600 cards and connections,
  the layout runs after a paint, so the click returns at once. Over 200 edges,
  only what is in the viewport is rendered.
- **No re-layout when nothing changed.** The app ignores a topology reply
  identical to the last one, and the server reuses the derived topology until
  the next derive pass.

Measured on the 1,260-grant fixture (`test/fixtures/topology/scale_demo`):
60 edges instead of 1,260, layout 31 ms instead of 383 ms. On a real 1,513-grant
project: 200 edges, no long task while panning.

**Behaviour change:** universal read grants no longer appear as edges. Select
the zone or principal, or read the card.

## 0.21.0 — 2026-10-02

### Where data lives, decided at run time ("the location split")

Seven fixes from a field report on a system that builds each resource name at
run time (configuration plus a key looked up in a table), decides who may
write each zone in a function, reaches the store through injected functions,
and chooses each process's identity by configuration. Every piece was already
in the IR; these join them.
[docs/guide/DATA-ARCHITECTURE.md](docs/guide/DATA-ARCHITECTURE.md#where-data-lives-decided-at-run-time).

- **M1 — one pattern type.** Catalogue paths, built names, zone names with
  holes and plan globs are compared as patterns everywhere: `record_{Type}`
  covers `record_X`, and `request_*` covers `request_{Role}__{Person}`.
  Transforms (lowercase, `_` to `-`) apply to literal runs only.
- **M2 — resource names and zones verified by the table.** A builder fed from
  configuration names each zone's resource, typed and with its default:
  `acme-ledger`, from `{BUCKET_PREFIX=acme}-{zone}` and its transform chain.
  `plan check` realises a planned zone when the zones the code declares unify
  with what it holds, instead of looking for a literal in the router.
- **M3 — effective writers.** In the function that builds the writer map from
  the catalogue, later `out.zone = [...]` replaces and `add("zone", [...])`
  extends, with string constants resolved. A key built at run time is listed
  with its line.
- **M4 — the call path behind a write.** A write charged through reach carries
  the path its process's thread takes to it (`decider via main.ts →
  onRequest`), preferring the process's declared entry point.
- **M5 — structural implementations.** A class with every required member of
  an interface implements it without saying so. It is reported as
  `structural` and never walked in threads.
- **M6 — who a process signs in as.** Read from where its entry point builds
  its client: a literal config, an env variable's default, a settings field,
  or a documented launch line or `package.json` script that sets the
  variable. A write's own client is followed back to its identity. A
  process's `runsAs` is proposed, never applied. A script that signs in once
  per person acts as many, and says so.
- **M7 — one topology model.** The derived topology joins every reader: the
  rule checks (`single-writer` on a derived zone is now checkable), the
  `topology` commands, `plan check`, the lenses and the export. A role no
  declared principal holds is still an answer to `who-writes`.

## 0.20.1 — 2026-10-02

Three findings from running 0.20.0 on a real plan, each fixed generally.

- **A store write is charged to the processes that reach its function, not
  its file.** The write matrix placed a write by the folder its file lives in,
  so a file holding one process's write closure and another process's
  read-only helper charged the write to both. It is now placed through the
  threads that reach the enclosing function. An entry point maps to a planned
  process by the plan's `entryPoints`, else by the process that owns the entry
  file. A write reached only from entry points in no planned process reads
  unverifiable, saying why. File ownership is the fallback only for code no
  thread reaches.
- **A planned tool is realised through its software spec and its store.**
  A planned database tool read "drifted: the code uses <another db library>"
  while the store of the same name was realised through the platform SDK. A planned tool now also matches
  the packages its ratified software spec names as its identity, and the tools
  a same-named planned store is reached through. The finding says which.
- **The system map draws the store's zones.** Each zone the code writes, reads
  or watches is a box, grouped the way the plan's store groups families when a
  plan is open. Every process doing so is an edge labelled write, read or
  watch. A zone no operation reaches is not drawn.

## 0.20.0 — 2026-10-02

### The data architecture, read from the code (eight modules)

Systems on a shared data platform keep their architecture in data tables,
computed resource names, SDK verbs, injected I/O and documents two processes
share. `export` now derives all of it from the IR, with zero tokens, as
`data-architecture.md` (`data_topology.json` with `--with-ir`); its topology
joins the declared one as the lowest-ranked source, so the Resources and
Decisions lenses work without a generator.
[docs/guide/DATA-ARCHITECTURE.md](docs/guide/DATA-ARCHITECTURE.md).

Measured against a reference architecture a project's own team wrote for a
sync-document platform (178 facts, scored section by section by
`scripts/dev/score_reference.mjs`): **14 → 157** found. Each module was built
against two codebases unlike the reference first (`test/fixtures/declared/`: a
TypeScript billing service on a broker, a Python object-store pipeline). The
21 not found are stated: principals (in a local, ignored file), the link from
records to the fields a fold reads, two SDK calls whose receiver is an untyped
callback parameter or an array element, and three flow steps that need a zone
list computed at run time.

- **Literal tables:** a module-level constant holding data keeps its rows in
  the IR (`table`), in TypeScript and Python.
- **Name patterns:** a small pure builder is stamped with the pattern it
  returns (`returnsPattern`). Call sites fill its holes from literal
  arguments, through locals, agreeing callers and router functions;
  everything else is "computed at file:line".
- **SDK effects:** a receiver is tied to its tool through imports, typed
  parameters, constructors, factory return types and class fields. The verb
  names the effect (read / write / admin / watch / grant), payload keys are
  kept, and an untied effect-looking call is listed.
- **Injected capabilities:** a call through an interface-typed parameter
  links to every implementation (a returned object literal, a typed constant,
  a subclass). The TypeScript linker adds `viaInjection` edges, so threads walk
  into the adapter; test fakes are counted, never walked.
- **Stores, zones, families:** these come from a catalogue table and a naming
  record, with writers and readers as grants.
- **Data-coupled flows:** a family written in one process and watched or read
  in another, including writes made through a port or a project funnel. The
  order is never claimed.
- **Decision structures:** state machines and decision trees are recognised
  by shape, linked to their evaluating functions and declared evidence.
- **Library vs deployable** (`plan check`): a process with nothing of its own
  is not built (it read "realised (0 files)"). An entry point named like the
  process outside its folder is reported. Derived writes reach the write
  matrix, which used to pass zones the code writes as "no write to it yet".
- **TypeScript calls in argument objects** (`send({ topic: topicFor(t) })`)
  are minted as nodes, as Python mints keyword arguments' calls.
- **`docs stamp <path>`:** a byte-identical regeneration no longer stays stale
  for ever.
- **`constraints.json` round-trips:** unreadable rules and unknown fields are
  carried through, their ids are never reused, and a file of an unknown
  version is never rewritten.

## 0.19.0 — 2026-10-02

### Fixes from field use

- **Thread view: long block headers wrap; nothing overlaps.** A container
  chip such as `FOR [label, sid, doc] of [[ …a long literal… ]]` ran far off
  its box to the right. A chip is now never wider than its own box, wraps
  onto at most two lines, and ends in "…" past that (the whole label is its
  hover title). The layout leaves room for the wrapped chip and for the
  nested boxes' headers between rows, and an inner box paints above its
  outer one, so a FINALLY chip is no longer buried under the box above.
  Pinned in both orientations by `test:e2e-chip-long`.
- **No more mojibake from Python on Windows.** `→` read as `â†'` because
  Python decoded and encoded the pipe in the Windows locale (cp1252). Every
  script now reads and writes UTF-8, and the app and the CLI set
  `PYTHONUTF8=1` for the interpreters they start.
- **`software plan` adds what fits, instead of refusing the lot.** A spec
  with 25 rules was refused whole ("policies: 25 items, over the cap of
  10") and nothing entered the plan. The rules now go in core first, as many
  as the plan has room for. The ones that did not fit are named in the
  reply, and `--rules s1,s4` chooses which. Updates to rules already in the
  plan take no room. The Plan panel's button behaves the same way.
  `test:software-plan-cap`.

### Declared topology (topology brief, Modules 1–6)

On a shared data platform the architecture that matters is declared as data
and its resource names are computed at run time, so static analysis showed
none of it. A project now hands it over through a generator it owns. Zero
tokens, opt-in, and a project with no generator sees no change.
[docs/guide/TOPOLOGY.md](docs/guide/TOPOLOGY.md).

- **`topology add|remove|list|run|show|check`**: register a generator
  (command + inputs). Its JSON output is validated against
  `schemas/topology.schema.json`: stores, zones, families, principals, grants,
  routers, state machines, decision trees, each item optionally citing
  `file:line`. Output is stored under `.vibegraph/topology/`, stale when the
  inputs' content changes, re-run by `export` (which writes `topology.md`) and
  flagged by the session-start hook.
- **Resources lens** and **`topology who-writes | can-write | touches`**:
  stores as boxes of zones, principals with read / write edges (roles
  expanded, grants cited), each zone with its router's threads. `touches`
  reads the IR of the functions a thread walks.
- **Rules over the topology**: `single-writer` (declared form: `zone`,
  `writer`), `writer-subset`, `no-write`. A missing, undeclared or STALE
  topology reads unverifiable, never a pass.
- **Decision structures**: state machines and decision trees in the JSON. The
  **Decisions lens** links each node to its evaluating function, the families
  it reads, their zones and who may write them; `topology explain
  <tree>:<node>` prints the same chain.
- **`topology live --command`**: a read-only inventory command's output is
  diffed against the declaration (undeclared zones, missing and extra
  grants), saved, and drawn on the Resources lens. Nothing is written to the
  platform.
- **`topology trace <log.jsonl> [--save]`**: each event is checked against
  the grants and decision structures, and the app's trace bar steps through a
  saved run on either lens.

Also: the map's layout gained `keepAll`, so an edge-less card (a zone nobody
may touch) is drawn in these lenses.

Tests: test:topology (7), test:topology-rules (5, a pass / fail /
unverifiable case per kind), test:e2e-topology (3). Fixture
`test/fixtures/topology/topo_demo`.

## 0.18.1 — never published on its own; shipped in 0.19.0

### The viewer on Windows (two bugs reported against 0.17 and 0.18)

- **A missing file in the package.** `discover_project.mjs` imports
  `package_entries.mjs` (new in 0.17), and the build never vendored it, so every
  `view` logged "project-level entry-point discovery failed" and lost the
  package.json and program entry points. The build now follows every vendored
  script's relative imports, copies what is missing, and refuses to finish when
  an import still does not resolve.
- **Windows paths.** Under a native Windows Node the viewer keyed files with
  backslashes (`packages\rules\src\index.ts`), so every manual seed, rule
  scope, plan folder and Python module identity keyed with `/` missed ("manual
  seed … not used: no such file"). Project-relative keys are now always `/`.
  And a Linux-side CLI given a Windows-form path (`\\wsl.localhost\…`,
  `//wsl.localhost/…`, `C:\…`) translates it; on Windows it is left as is.

Tests: test:windows-paths (4). Checked by hand on Windows (Node 24, project on
C:, a manual seed) and on WSL with a `\\wsl.localhost` path.

## 0.18.0 — 2026-10-01

### The proposal backlog (plan-architecture brief, Module 11)

- **`plan review`** puts every pending proposal on one page: a new item in
  full, a change to an agreed item as a field diff against the version a
  person agreed to (kept as `agreedAs` when an agent edits it), the evidence
  for each, the command that decides it, and the rule changes agents proposed
  to `constraints.json`.
- **`plan review --agree … --reject …`** decides several at once (a person
  only). A new `reject` op restores the agreed version of a change, or drops
  a new item.
- The **session-start hook** gives the backlog count. The Plan panel shows the
  count, an agent's change and a **Reject change** button.

Tests: test:plan-review (4).

**Migration (Modules 1–11).** Nothing to migrate: every new plan section and
field is optional, a plan without them saves byte-for-byte as before, and
`version` stays "1". See the migration note in
[docs/guide/PLAN-ARCHITECTURE.md](docs/guide/PLAN-ARCHITECTURE.md#migration-note).

### Generated documents go stale visibly (plan-architecture brief, Module 10)

- **`docs add|remove|list|check`** registers a project's generated documents
  (path, generator command, inputs) in `.vibegraph/docs.json`. `check` reports
  each as fresh, **stale since <commit>** (the first later commit that changed
  an input, or the working tree) or unknown, and exits 1 when any is stale.
- The **session-start hook** lists stale documents with the command that
  regenerates them.

Tests: test:docs-registry (5).

### Rename safety and change impact (plan-architecture brief, Module 9)

- **`plan affected [--uncommitted] [<file>…]`** lists the plan items whose
  named steps, routers, access functions, rule targets or entry points the
  change touches, and any name now **gone** (defined in a changed file at
  HEAD, nowhere now).
- The **post-edit hook** says when an edit removed a function the plan names,
  once per name per session, with the op that fixes it.
- **`rename-symbol`** (a `plan edit` op) renames a function in every place the
  plan names it.

Tests: test:plan-affected (4).

### Assumptions and evidence (plan-architecture brief, Module 8)

- Any plan item may list **`assumes`** (open-question ids), and a question or
  an item may carry **`evidence`**: command, expected result, date and, once
  run, the result. The latest run decides whether an assumption is confirmed,
  refuted or unverified. VibeGraph never runs the command.
- `plan check` adds "realised in code, assumption UNVERIFIED / REFUTED" to an
  item's finding without changing its verdict. A refuted assumption is its own
  violated finding that flags every item resting on it. Shown in `plan.md`, the
  hook's plan and the Plan panel.
- A question something rests on can't be dropped, only answered with
  evidence.

Tests: test:plan-assumptions (4), test:e2e-plan-stores.

### Access and authority rules that are checked (plan-architecture brief, Module 7)

- Three new verbs in the constraint grammar:
  - **`single-writer`**: only these functions or files write a zone or
    document family, through the store's write functions;
  - **`always-with`**: every path through function X also calls Y;
  - **`id-scheme`**: ids of a family come only from its producer functions.
- Each says what it checked and what it could not. A computed zone, an id from
  a parameter or an absent function is **unverifiable**, never a pass.
- In the plan they take the plan's own names (`zone: "store/zone"`, process
  ids), expanded on promotion.
- Like `layer`, they fail `check` and are advice in the hooks until calibrated.

Tests: test:plan-authority (5, fixture `test/fixtures/plan/authority_demo`: a
passing and a failing case of each).

### Layering rules that are checked (plan-architecture brief, Module 6)

- A new verb in the constraint grammar, **`layer`**: `{rule: "layer", files,
  mayImport, allowStdlib?}`. It says the files of a layer may import only what
  `mayImport` names (project folders, globs, package names, `@acme/*` scopes;
  the standard library unless `allowStdlib: false`). It is checked against the
  project import graph, and a violation names each import with file and line.
  A layer with no parsed file is unverifiable, never a pass.
- In the plan, a layer rule may name **planned module ids**. `plan check`
  expands them, and `plan promote` writes folders into `constraints.json`.
- **`plan layers [--apply]`** proposes each module's rule from today's import
  graph.
- Like `payload-keys` before calibration, a `layer` violation fails `check`
  (exit 1) but is advice in the hooks.

Tests: test:plan-layers (5).

### Library vs deployable (plan-architecture brief, Module 5)

- A plan may hold **`modules`** (code units: `at`, kind `library` | `app` |
  `tool`), and a process may say what it starts from (**`entryPoints`**) and
  what it runs (**`uses`**). A process's files are its own plus its modules'.
  A library two processes use belongs to neither when placing a write.
- A planned thread with no `process` attaches to the process its entry point
  lives in, so the "threads the plan gives no process" card no longer fills up.
- **Workspace packages imported by name are project code.** `import … from
  "@acme/rules"` in a multi-package repository is resolved by the parser
  (`scripts/frontends/jsts/workspace.mjs`) into the package's source and
  linked, so threads cross the package boundary. **Behaviour change:** such
  packages are no longer listed as third-party tools in the stack, and threads
  that stopped at them now continue into them.

Tests: test:plan-modules (4, fixture `test/fixtures/plan/deploy_demo`).

### Coordination through the store (plan-architecture brief, Module 4)

- A plan may hold **`flows`**: ordered steps across processes, each "process
  writes / reads / watches store/zone (family)". `plan check` reports each step
  found or missing, and the flow as realised, drifted or not built.
- **Indirect hops** are derived from the code: a write of a family in one
  process and a watch or read of it in another. The map joins the two
  processes with a dashed edge labelled by the family, so request → decision →
  verdict reads as A → B → A. A computed zone never makes a hop.

Tests: test:plan-flows (5), test:e2e-plan-stores (3).

### Principals and who may write (plan-architecture brief, Module 3)

- A plan may hold **`principals`** (`service`, `human-role`, `owner`). A
  process says what it **`runsAs`**, and a zone's **`writers`** / **`readers`**
  name principals, so "only P writes zone Z" is data. Every name is validated,
  and a rename carries it everywhere.
- `plan check` derives the **write matrix** (principal × zone) from the code's
  access sites and checks each zone's writers: **pass**, **violated** (a
  process writes a zone its principal may not, with file and line) or
  **unverifiable** (a write it cannot place). It is shown in `plan.md`, the Plan
  panel and on the map's zone and process cards.

Tests: test:plan-principals (4), test:e2e-plan-stores (2).

### Zones inside a store (plan-architecture brief, Module 2)

- A store may list **`zones`** (`holds` document families or key patterns,
  `writers`, `readers`, `routedBy`) and its **`access`** functions (the
  client's own `write` / `read` / `watch` API). A call to an access function is
  an access site, read with its literal arguments.
- `plan check` marks a zone **realised** where the code's routing names it:
  an access call's literal, or the router function the plan names. A zone the
  code only reaches with a computed argument is **unverified**, never a pass.
- A boundary may name the **`zone`** it writes. It is realised at its own
  process's access to that zone, and **drifted** when that process touches
  only other zones.
- The map draws the store as a box with its zones inside it, and a boundary
  with a zone ends on that zone.

Tests: test:plan-zones (5), test:e2e-plan-stores (1).

### Stores are resources, not processes (plan-architecture brief, Module 1)

- A plan may hold **`stores`**: a database, sync service, object store or queue
  the processes share, with what the code reaches it through (tools, a project
  funnel, a folder or a workspace package name). `plan check` marks a store
  realised when any of those is used. A boundary may target a store, and is
  then realised or unverified, never drifted or orphaned while the store lives.
- **`to-store`** (a `plan edit` op) converts a database or cache that was
  modelled as a process into a store under the same id. A db/cache process,
  and an orphaned boundary into a dropped one, now say so.
- The map draws a store as its own card (or marks the real tool box that
  realises it), and `plan.md` and the hook's plan list stores.
- Found on the way: a planned tool whose role no table knows (`unknown`) read
  as **drifted**. Silence is not a contradiction, so it now reads realised,
  with a note.

**Behaviour change.** Plans that don't use `stores` load and save exactly as
before. The only verdict that moves on an existing plan is a stack tool the
tables don't know, which goes from drifted to realised.

Tests: test:plan-stores (5, fixture `test/fixtures/plan/store_demo`).
Docs: [docs/guide/PLAN-ARCHITECTURE.md](docs/guide/PLAN-ARCHITECTURE.md).

## 0.17.0 — 2026-10-01

### The planned architecture on the map (brief Module 1)

- **Planned threads on their process.** A planned process card on the
  architecture map carries an **N threads** chip; it opens the threads that
  name the process (`process` on a plan thread) as dashed step chains,
  coloured by their plan-check verdict, with a step plan check did not find
  struck through. Plan check now reports a drifted thread's missing steps as
  data (`missing`) and a realised process's entry points (`entryPoints`).
- **Rules and open questions where they belong.** Plan rules and open
  questions take an optional `about` (a planned process, thread, boundary or
  tool id, validated); they show as **N rules** / **N open** chips on that
  item. A rule without `about` lands on the one process whose files it names;
  anything else is listed under the Real / Plan / Overlay switch.
- **Boundary keys.** A planned boundary's edge reads `protocol · N keys`, the
  keys on hover.
- **Trust zones.** A planned boundary whose ends sit in two different stated
  (or proposed) trust / zone groups is drawn in the warning colour, the
  crossing named on hover.
- **Seed groups from the plan.** `architecture --seed-plan [--force]` and the
  **Seed groups** button propose `.vibegraph/architecture.json` groups read off
  the plan — a process group per realised planned process, and project /
  outside trust zones — with no model and no tokens. Pending until ratified,
  gated like a model's proposal.

**Behaviour change for existing users.** In the **Overlay**, a planned item the
code has realised used to be hidden on the assumption that its real box stood
for it — but nothing marked which box, and an item the real map draws no box
for (a web framework, a library with no entry point) was drawn nowhere, along
with its threads and rules. Now a realised item marks its real box with a
**planned ✓** chip and moves its threads and rules there; one with no real box
is its own card, chipped the same. The Overlay can therefore show one more card
than before (the plan_demo fixture: 3 → 4, the realised `flask`). Plans that
use none of the new fields (`about`) are read exactly as before; a plan whose
`about` names nothing is refused with the reason, like any other invalid plan.

Tests: test:plan-map (6, fixture `test/fixtures/plan/map_demo`),
test:e2e-plan-map (2), test:e2e-plan (updated: the Overlay's fourth card).

### Hooks and rules on a multi-package TypeScript repo (hooks-feedback brief)

What an agent hit building a TypeScript monorepo with the hooks, fixed
generally. `check`, every hook and `plan check` keep their exit codes: 0 pass,
1 violated, 2 unverifiable (a hook: 0, or 2 to block).

- **A rule can change without being deleted.** `constraint show <id>` (history
  and open proposals), `constraint edit <id> --check '<json>' --text …` (a
  person; applied and recorded field by field), `constraint propose <id> …
  --why "<reason>"` (an agent, or an edit run from inside Claude Code: stored,
  never applied), `constraint accept|reject <id> <pN>` (a person). Every change
  is validated as the whole rule. `constraint` is an alias of `constraints`.
- **A hook blames only what this edit introduced.** A violation an earlier edit
  introduced is one summary line, not a block (the end-of-turn check still holds
  the turn to it). Offenders are de-duplicated and capped per check, the reason
  given once, and a block names the `constraint propose` command for a rule
  that is now scoped too tightly. **Behaviour change:** an edit to a file that
  was already in violation no longer blocks unless it adds a violation.
- **Allow-lists that do not go stale.** `import-only` / `callers-only` `files`
  take an exact path, a folder (`src/db/`) or a glob (`packages/*/src/**`), and
  `allowTests: true` adds every test file. Exact lists behave as before. `plan
  promote` warns when a rule's only allowed file is one test file.
- **Programs found without manual seeds.** A `package.json` `bin` (mapped from
  `dist/` back to the parsed source) or a script whose runner (node, tsx,
  ts-node, bun, deno, vite-node — through npx / pnpm / yarn) names a file makes
  that file an entry point; so does a JS/TS file that awaits at the top level,
  calls `.listen()` or reads `process.argv`. `seed` is an alias of `seeds`.
  **Behaviour change:** projects like this gain entry points, and threads, they
  did not have; `package.json` now invalidates the envelope cache.
- **Planned threads with human names.** A plan thread may set `entryPoint` (an
  entry id, or a file with one entry) and is matched on it first; an unmatched
  thread lists the nearest entry points (a word-match guess, said as one); a
  drifted thread says why each step is missing. A `plan edit` op
  `{"op":"rename","section":…,"from":…,"to":…}` renames an item and every
  reference to it.
- **Plan state that goes stale is said.** Removing a constraint demotes the
  planned rule promoted into it back to agreed; a boundary whose end is a
  dropped process is **orphaned**; a stack tool may name the client libraries
  it is reached `via`; a cap refusal lists items to drop and pairs to merge.
- **Greenfield prompts.** A prompt about a planned thread the code does not
  have yet gets that thread's plan (what it serves, where it will live, its
  steps and the boundaries they cross) instead of a keyword guess at existing
  code.
- **Hooks across OS boundaries.** `hook install [--target posix|wsl]` installs
  the hooks alone (`wsl` = the form a Windows-side Claude Code can run against a
  WSL project); `hook run <event> --file <path>` (or `--command`, `--prompt`)
  builds the Claude Code payload itself and keeps the hook's exit codes;
  `doctor` says whether the hooks are installed, can run from this side, and
  have fired since they were installed (every hook now leaves a one-line record
  under `~/.cache`, never in the project).

Tests: test:constraint-amend (4), test:hooks (17), test:allow-lists (5),
test:program-entries (5), test:plan-thread-match (5), test:plan-stale (5),
test:plan-prompt (2), test:hook-tools (4).

## 0.16.0 — 2026-10-01

- `init --hooks --windows`: hooks a Windows-side Claude Code runs against a
  WSL project. `handles-failure` reads TypeScript / JavaScript. `this.field.method()`
  links when the class names the field's type. Plan check matches a step
  written `Class.method`. A `files`-scoped check reads the files its rule
  names. Sibling container chips no longer overlap.
