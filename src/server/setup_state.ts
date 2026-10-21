// THE SETUP (2026-10-20, Ben: "vibegraph initialise — group the architecture,
// create the brief, run software add on any bespoke software … suggest the
// overall project axioms … the user confirms … then the hooks"). One fixed
// order, read from the project's files at zero tokens, never a model:
//
//   software    a spec for each bespoke tool the code builds on (software_candidates.ts)
//   groups      the architecture groups — the Brief proposes them first
//   brief       the Brief: function, method, key features, names, a start-here path
//   rules       the rules the code must keep (harvested, drafted, ratified)
//   direction   optional: the patterns the code already follows, agreed or dropped
//   hooks       the four hooks in Claude Code, and proof they fired
// and after the setup, not counted in it:
//   plan        a plan for what is built next: its objective, principles and
//               planned processes (plan.json)
//
// The plan was step 5, "the objective and the project's principles", until
// 2026-10-21 (Ben: "do we need a plan at this point? … initialise all other
// steps first then suggest the user make a plan as the ultimate step"). On a
// codebase that exists, the ratified Brief already says what the system is for
// and reaches every session at its start; the rules and the direction are its
// axioms, read from the code and checked. A plan is the next piece of work, so
// it is offered once nothing in the setup is left.
//
// Specs come first because the Brief, the plan draft and the rule draft read
// them. Each step says its state (done / waiting for you / to do / optional /
// skipped), the facts behind it, and the exact commands — who may run each
// (a person; Claude; either) and which spend tokens. The CLI (`setup`), the
// Claude Code skill (/vibegraph-setup) and the app's "Next" line read this one
// order, so they never disagree about what comes next.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StackIndexRecord } from "../shared/protocol.ts";
import type { NowPanel } from "../shared/now_wire.ts";
import { listSpecs } from "./software_store.ts";
import { specCoverage, thinSpecNote } from "./software_draft.ts";
import { softwareCandidates, type CandidateReport } from "./software_candidates.ts";
import { loadArchStore, ratifiedAt } from "./arch_store.ts";
import { loadBrief } from "./brief_store.ts";
import { loadConstraints, statedRules } from "./constraint_store.ts";
import { loadPlan } from "./plan_store.ts";
import { OBSERVED_OBJECTIVE } from "./plan_observe.ts";
import { loadDirection, staleRules, type Candidate } from "./project_direction.ts";
import { cacheDirFor } from "../../scripts/cache_dir.mjs";

/** init.mjs's HOOK_MARKER, the word every installed hook command carries.
 *  Not imported: init.mjs → paths.mjs reads import.meta.url at load, which the
 *  server's CommonJS bundle does not have. test:setup pins the two equal. */
export const SETUP_HOOK_MARKER = "--vg-hook";

export type SetupStepId = "software" | "groups" | "brief" | "rules" | "direction" | "hooks" | "plan";
export type SetupStatus = "done" | "waiting" | "todo" | "optional" | "skipped";
export interface SetupCommand { run: string; who: "you" | "claude" | "either"; spends?: boolean; why: string }
export interface SetupStep {
  id: SetupStepId; title: string; status: SetupStatus; core: boolean;
  /** comes after the setup and is not counted in it (the plan) */
  after?: boolean;
  facts: string[]; commands: SetupCommand[];
  /** the app's one-line "Next", and the panel that acts on it (null: the map's Brief card, or the CLI) */
  now: { text: string; panel: NowPanel | null };
}
export interface SetupState {
  steps: SetupStep[];
  next: SetupStep | null;
  /** nothing in the setup is left: the step offered after it (the plan, not started) */
  after: SetupStep | null;
  done: number; of: number; software: CandidateReport | null;
}

// ── what a person set aside: .vibegraph/setup.json ─────────────────────
export interface SetupSkips { version: "1"; software: Record<string, { why: string; at: string }>; steps: Record<string, { why: string; at: string }> }
const SKIPS = join(".vibegraph", "setup.json");
export function loadSkips(root: string): SetupSkips {
  try {
    const raw = JSON.parse(readFileSync(join(root, SKIPS), "utf-8"));
    if (raw?.version === "1") return { version: "1", software: raw.software ?? {}, steps: raw.steps ?? {} };
  } catch { /* none yet */ }
  return { version: "1", software: {}, steps: {} };
}
export function saveSkips(root: string, s: SetupSkips): void {
  const p = join(root, SKIPS);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
}
/** The steps a person may set aside (the core ones cannot be skipped: each is
 *  done once and says so when there is nothing to do). */
export const SKIPPABLE_STEPS: SetupStepId[] = ["direction"];

const cmd = (run: string, who: SetupCommand["who"], why: string, spends = false): SetupCommand => ({ run: `vibegraph-knowledge ${run}`, who, why, ...(spends ? { spends } : {}) });

/** The setup's state. `stack` absent (a caller without the derived stack):
 *  the software step is left out rather than guessed. `census` (the direction
 *  census of the code now) lets the direction step name stale proposals. */
export function setupState(root: string, opts: { stack?: Pick<StackIndexRecord, "tools"> | null; census?: Candidate[] | null } = {}): SetupState {
  const skips = loadSkips(root);
  const steps: SetupStep[] = [];
  let software: CandidateReport | null = null;

  // ── software ──
  if (opts.stack) {
    const specs = listSpecs(root);
    software = softwareCandidates(root, opts.stack, specs, skips.software);
    const drafts = specs.filter((s) => s.status !== "ratified");
    const ratified = specs.filter((s) => s.status === "ratified");
    const facts: string[] = [];
    const commands: SetupCommand[] = [];
    let status: SetupStatus = "done";
    let now: SetupStep["now"] = { text: "", panel: "plan" };
    if (drafts.length) {
      status = "waiting";
      facts.push(`draft spec${drafts.length === 1 ? "" : "s"} waiting for a person: ${drafts.map((s) => s.tool).join(", ")}`);
      for (const s of drafts) {
        const cov = specCoverage(s);
        if (cov.thin) {
          facts.push(thinSpecNote(s.tool, cov));
          commands.push(cmd(`software add ${s.tool} ${s.sources.map((x) => `--from ${x.ref}`).join(" ")} --from <the API reference page>`, "claude", "re-draft with a fuller source; the thin draft is replaced", true));
        }
        commands.push(cmd(`software show ${s.tool}`, "either", "read it, every quote beside its rule"), cmd(`software ratify ${s.tool}`, "you", "nothing uses a spec until a person ratifies it"));
      }
      now = { text: `Ratify the software spec${drafts.length === 1 ? ` for ${drafts[0].tool}` : "s"}`, panel: "plan" };
    }
    // Not knowing what a package is comes first: its role decides whether it needs a spec.
    if (software.unclassified.length) {
      if (status === "done") status = "todo";
      const shown = software.unclassified.slice(0, 10).map((u) => u.name);
      facts.push(`${software.unclassified.length} package(s) the code calls that no table knows and nobody has classified: ${shown.join(", ")}${software.unclassified.length > shown.length ? ", …" : ""} — what each IS decides whether it needs a spec`);
      commands.push(cmd("classify --apply", "claude", "one model call files every unknown package under a role (a platform, a database… or a UI or utility library), each labelled a model's", true));
      if (!drafts.length) now = { text: `Classify the ${software.unclassified.length} package${software.unclassified.length === 1 ? "" : "s"} no table knows`, panel: "setup" };
    }
    if (software.candidates.length) {
      if (status === "done") status = "todo";
      const what = { platform: "a backend platform SDK", classified: "classified by a model", stated: "classified by a person", table: "a table knows its role — a spec adds its current API and rules" };
      for (const c of software.candidates) {
        const docs = c.docs.length ? `docs: ${c.docs[0].url} (from ${c.docs[0].from})` : "no docs source found — the person supplies one";
        facts.push(`${c.name} (${c.packages.join(", ")}) — ${c.kind === "table" ? `${c.role}; ${what.table}` : `${what[c.kind]}${c.kind === "platform" ? "" : ` as ${c.role}`}`}, called on ${c.calledOn} thread(s); ${docs}`);
        commands.push(cmd(`software add ${c.name} --from ${c.docs[0]?.url ?? "<its docs page or a file>"}`, "claude", "one model call; keeps only what the docs say, quoted", true));
      }
      if (software.more) facts.push(`and ${software.more} more candidate(s) — set aside or specified, they appear here in turn`);
      commands.push(cmd(`setup skip software <name> --why "<why it needs no spec>"`, "either", "a package the project uses in an ordinary way"));
      if (status === "todo" && !software.unclassified.length) now = { text: `Write a spec for ${software.candidates[0].name} — software the code builds on`, panel: "setup" };
    }
    if (status === "done") facts.push(ratified.length ? `${ratified.length} spec(s) ratified: ${ratified.map((s) => s.tool).join(", ")}` : "no bespoke software found: every package the code calls is one the tables or a classification already describe");
    if (software.skipped.length) facts.push(`set aside: ${software.skipped.map((s) => `${s.name} (${s.why})`).join(", ")}`);
    if (software.commands.length) facts.push(`also seen, commands no table knows (not held open): ${software.commands.map((c) => c.name).join(", ")}`);
    steps.push({ id: "software", title: "Software specs — what the code builds on, from its own docs", status, core: true, facts, commands, now });
  }

  // ── groups and the Brief ──
  const store = loadArchStore(root);
  const brief = loadBrief(root);
  const groupsAt = ratifiedAt(store);
  const proposedGroups = brief.proposed?.groups?.length ?? 0;
  steps.push(groupsAt
    ? { id: "groups", title: "Architecture groups", status: "done", core: true, facts: [`${store.groups.length} group(s), ratified${groupsAt.at ? ` ${groupsAt.at.slice(0, 10)}` : ""}`], commands: [], now: { text: "", panel: null } }
    : proposedGroups || store.proposal
      ? { id: "groups", title: "Architecture groups", status: "waiting", core: true, facts: [`${proposedGroups || store.proposal?.groups.length || 0} proposed group(s) wait for a person`],
        commands: [cmd("brief codebase show", "either", "the proposal"), cmd("brief codebase ratify groups", "you", "or the Brief card on the map")], now: { text: "Decide the proposed architecture groups", panel: null } }
      : { id: "groups", title: "Architecture groups", status: "todo", core: true, facts: ["no groups yet: the Brief proposes them first, from the derived map and the deployment files"],
        commands: [cmd("brief codebase --estimate", "either", "how many tokens it will take"), cmd("brief codebase", "claude", "proposes the groups (a person decides them)", true)], now: { text: "Propose the architecture groups (the Brief)", panel: null } });

  const proposedSpec = !!brief.proposed?.spec;
  steps.push(brief.ratified?.spec
    ? { id: "brief", title: "The Brief", status: "done", core: true, facts: [`ratified ${brief.ratified.at.slice(0, 10)}`], commands: [], now: { text: "", panel: null } }
    : proposedSpec
      ? { id: "brief", title: "The Brief", status: "waiting", core: true, facts: ["a drafted Brief waits for a person"],
        commands: [cmd("brief codebase show", "either", "the draft and its review sheet"), cmd("brief codebase ratify", "you", "or the Brief card on the map")], now: { text: "Decide the drafted Brief", panel: null } }
      : { id: "brief", title: "The Brief", status: "todo", core: true, facts: [groupsAt ? "the groups are settled: the Brief reads the codebase through them" : "after the groups"],
        commands: [cmd("brief codebase", "claude", "function, method, key features, names, scopes and a start-here path, each cited", true)], now: { text: "Write the Brief", panel: null } });

  // ── rules ──
  const stated = statedRules(loadConstraints(root));
  const human = stated.filter((c) => c.source === "human");
  const agent = stated.filter((c) => c.source !== "human");
  const changes = stated.reduce((n, c) => n + ((c as { proposals?: unknown[] }).proposals?.length ?? 0), 0);
  steps.push(agent.length || changes
    ? { id: "rules", title: "Rules the code must keep", status: "waiting", core: true,
      facts: [`${agent.length} rule(s) stated by a model wait for a person${changes ? `; ${changes} proposed change(s) to stated rules` : ""}; ${human.length} ratified`],
      commands: [cmd("constraints list", "either", "each with its reason and check"), cmd("constraints ratify <id>", "you", "or the Rules panel"), cmd("constraints remove <id>", "you", "a rule that is not one")],
      now: { text: `${agent.length + changes} proposed rule${agent.length + changes === 1 ? " waits" : "s wait"} for you`, panel: "rules" } }
    : human.length
      ? { id: "rules", title: "Rules the code must keep", status: "done", core: true, facts: [`${human.length} ratified rule(s), ${human.filter((c) => c.check || c.checks?.length).length} with a check`], commands: [], now: { text: "", panel: "rules" } }
      : { id: "rules", title: "Rules the code must keep", status: "todo", core: true, facts: ["no stated rules yet"],
        commands: [cmd("constraints harvest", "either", "rule-shaped sentences in the project's own prose, zero tokens"),
          { run: "/vibegraph-rules", who: "claude", spends: true, why: "a Claude Code skill: states the real ones, each citing its sentence" },
          cmd("constraints draft", "claude", "rules from the architecture, each citing the facts it was shown", true)],
        now: { text: "State a rule the code must keep", panel: "rules" } });

  // ── direction (optional) ──
  const d = loadDirection(root);
  const dirProposed = d.rules.filter((r) => r.status === "proposed").length;
  const dirAgreed = d.rules.filter((r) => r.status === "agreed").length;
  // with the census now: a proposal the code no longer says is re-read before
  // anyone decides it (the live run offered "52 files use fetch through
  // lib/utils.ts" after the facts under it had become 4)
  const stale = opts.census ? [...staleRules(d, opts.census)].filter(([id]) => d.rules.find((r) => r.id === id)?.status === "proposed").map(([id]) => id) : [];
  steps.push(skips.steps.direction
    ? { id: "direction", title: "The direction the code already takes", status: "skipped", core: false, facts: [`set aside: ${skips.steps.direction.why}`], commands: [], now: { text: "", panel: "direction" } }
    : dirProposed
      ? { id: "direction", title: "The direction the code already takes", status: "waiting", core: false,
        facts: [`${dirProposed} proposed rule(s) read from the code wait for a person`, ...(stale.length ? [`${stale.join(", ")}: read from the code as it was at the census, and the code says otherwise now — re-read before deciding`] : [])],
        commands: [...(stale.length ? [cmd("direction project census", "either", "zero tokens: re-reads the proposals from the code as it is now")] : []), cmd("direction project", "either", "each with its why"), cmd("direction project agree <id>", "you", "or the Direction panel")], now: { text: "Agree or drop the direction read from the code", panel: "direction" } }
      : dirAgreed || d.censusAt
        ? { id: "direction", title: "The direction the code already takes", status: "done", core: false, facts: [`${dirAgreed} agreed`], commands: [], now: { text: "", panel: "direction" } }
        : { id: "direction", title: "The direction the code already takes", status: "optional", core: false, facts: ["not read yet"],
          commands: [cmd("direction project census", "either", "zero tokens: funnels, guarded writes, agreed principles"), cmd("setup skip direction --why \"…\"", "either", "not wanted")],
          now: { text: "Read the project's direction from its code", panel: "direction" } });

  // ── hooks ──
  const hooks = hookState(root);
  steps.push(hooks.fired
    ? { id: "hooks", title: "Hooks in Claude Code", status: "done", core: true, facts: [`installed; last fired ${hooks.fired.slice(0, 16).replace("T", " ")}`],
      commands: [cmd("hook log", "either", "after a session: what each hook delivered, routed and caught")], now: { text: "", panel: null } }
    : hooks.installed
      ? { id: "hooks", title: "Hooks in Claude Code", status: "waiting", core: true, facts: ["installed, not fired since — they apply from the next Claude Code session"],
        commands: [cmd("doctor", "either", "installed, runnable from this side, fired?")], now: { text: "Start a Claude Code session to see the hooks fire", panel: null } }
      : { id: "hooks", title: "Hooks in Claude Code", status: "todo", core: true, facts: ["not installed"],
        commands: [cmd("init --hooks", "you", "writes .claude/settings.local.json (per person, never committed)"), cmd("hook install --target wsl", "you", "instead, for a Windows Claude Code on a WSL project")],
        now: { text: "Install the hooks: vibegraph-knowledge init --hooks", panel: null } });

  // ── after the setup: a plan for what is built next (not counted) ──
  const plan = loadPlan(root);
  const objective = plan?.objective && plan.objective !== OBSERVED_OBJECTIVE ? plan.objective : null;
  const proposedObjective = (plan?.open ?? []).filter((q) => q.text.startsWith("Proposed objective:"));
  const agreed = (plan?.policies ?? []).filter((p) => p.status === "agreed" || p.status === "promoted");
  const proposedPrinciples = (plan?.policies ?? []).filter((p) => p.status === "proposed");
  const title = "A plan for what you build next";
  const drafted = "proposes the objective and 3–7 principles from the project's prose, the Brief and the specs, each quoted";
  steps.push(proposedObjective.length || proposedPrinciples.length
    ? { id: "plan", title, status: "waiting", core: false, after: true,
      facts: [...(objective ? [`objective: ${objective}`] : []), ...(proposedObjective.length ? ["a proposed objective waits for a person"] : []), ...(proposedPrinciples.length ? [`${proposedPrinciples.length} proposed principle(s) wait for a person`] : [])],
      // adopting a proposal is one step that also closes it (the live run's
      // session told the person to retype it with set-objective, which left the
      // proposal open)
      commands: [cmd("plan review", "either", "every proposal on one page"),
        ...(proposedObjective.length ? proposedObjective.slice(0, 2).map((q) => cmd(`inbox agree objective:${q.id}`, "you", `adopt ${q.id} as the objective (or Adopt in the Plan panel)`)) : [cmd("plan edit '{\"op\":\"set-objective\",\"text\":\"…\"}'", "you", "state the objective yourself, one concrete line")]),
        cmd("plan agree policies <id>", "you", "a principle the project keeps"), cmd("plan promote <id>", "you", "a principle with a check becomes a rule that is enforced")],
      now: { text: proposedObjective.length ? "Adopt the plan's objective and agree its principles" : "Agree the plan's principles", panel: "plan" } }
    // no plan: optional, offered once nothing in the setup is left. Starting it
    // is a person's step (the live run's session drafted, was told "no plan
    // yet", and tried `plan init "placeholder"`, refused)
    : !plan
      ? { id: "plan", title, status: "optional", core: false, after: true,
        facts: ["after the setup: what the next piece of work is for, and the processes, threads, stores and principles it adds, checked against the code as it is built"],
        commands: [cmd("plan observe", "you", "starts the plan from the code (zero tokens); the objective is left for the draft"),
          cmd("plan init \"<objective>\"", "you", "or start it with the objective yourself, one concrete line"),
          cmd("plan draft --direction", "claude", `once the plan exists: ${drafted}`, true)],
        now: { text: "Plan what you build next", panel: "plan" } }
      : objective
        ? { id: "plan", title, status: "done", core: false, after: true, facts: [`objective: ${objective}`, `${agreed.length} principle(s) agreed, ${agreed.filter((p) => p.status === "promoted").length} promoted to enforced rules`], commands: [], now: { text: "", panel: "plan" } }
        // the plan exists with its objective left open: set by an edit, never `plan init`
        : { id: "plan", title, status: "todo", core: false, after: true, facts: ["the plan is started; its objective is not stated"],
          commands: [cmd("plan draft --direction", "claude", drafted, true), cmd("plan edit '{\"op\":\"set-objective\",\"text\":\"…\"}'", "you", "or state it yourself, one concrete line")],
          now: { text: "State what the plan is for", panel: "plan" } });

  const core = steps.filter((s) => s.core);
  const next = steps.find((s) => s.status === "waiting" || s.status === "todo") ?? null;
  const after = next ? null : steps.find((s) => s.after && s.status === "optional") ?? null;
  return { steps, next, after, done: core.filter((s) => s.status === "done").length, of: core.length, software };
}

/** Are the hooks installed, and when did one last fire since? */
function hookState(root: string): { installed: boolean; fired: string | null } {
  const settings = join(root, ".claude", "settings.local.json");
  if (!existsSync(settings)) return { installed: false, fired: null };
  let installed = false;
  try { installed = readFileSync(settings, "utf-8").includes(SETUP_HOOK_MARKER); } catch { installed = false; }
  if (!installed) return { installed, fired: null };
  try {
    const since = statSync(settings).mtimeMs;
    const fired = JSON.parse(readFileSync(join(cacheDirFor(root), "hooks-fired.json"), "utf-8")) as Record<string, { at: string }>;
    const last = Object.values(fired).map((r) => r.at).filter((at) => Date.parse(at) >= since).sort().at(-1) ?? null;
    return { installed, fired: last };
  } catch { return { installed, fired: null }; }
}
