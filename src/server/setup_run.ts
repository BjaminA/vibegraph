// "Run all" for the setup (2026-10-21, Ben: "go to the next step button in gui
// still just takes to the plan page - please fix and add a run all button").
// The setup's steps Claude can take are run from the app, in the setup's order
// (setup_state.ts), one model call at a time, through the functions each panel
// already uses: classify (classify_server.ts), a spec from its docs
// (software_add.ts), the groups and the Brief (brief_server.ts), rules
// (rule_draft_server.ts), and the direction census, which spends nothing.
//
// It never takes a person's step. A proposal it makes waits for a person, and
// a step that needs a decision first (the Brief after the groups are ratified)
// is left for the next run: the run ends saying what waits and where. The state
// is read again after every action, so a classification that turns a package
// into a candidate brings its spec into the same run.

import type { SetupState, SetupStepId } from "./setup_state.ts";
import { githubRef } from "./github_docs.ts";
import { isInstalledReadme } from "./software_candidates.ts";

export type SetupActionKind = "classify" | "software" | "groups" | "brief" | "rules" | "census";

export interface SetupAction {
  key: string;
  kind: SetupActionKind;
  step: SetupStepId;
  label: string;
  /** a model call (a token cost); the census spends nothing */
  spends: boolean;
  /** software: the spec's name and the docs it is drawn from */
  tool?: string;
  urls?: string[];
  /** software: the docs are a GitHub repository of this owner (github_docs.ts) */
  github?: string;
}

export interface SetupPreview {
  actions: SetupAction[];
  /** what waits for a person, and where it is decided */
  waits: string[];
}

const MAX_ACTIONS = 16;

/** What Claude can run now, in the setup's order, and what waits for a person. */
export function setupActions(state: SetupState): SetupPreview {
  const actions: SetupAction[] = [];
  const waits: string[] = [];
  const step = (id: SetupStepId) => state.steps.find((s) => s.id === id);

  const software = step("software");
  if (software && state.software) {
    if (software.status === "waiting") waits.push("Ratify the drafted software spec(s) in the Plan panel");
    if (state.software.unclassified.length) {
      const n = state.software.unclassified.length;
      actions.push({ key: "classify", kind: "classify", step: "software", spends: true, label: `Classify the ${n} package${n === 1 ? "" : "s"} no table knows` });
    }
    for (const c of state.software.candidates) {
      // a link, or the README installed with the package (read from disk)
      const url = c.docs.find((d) => /^https?:\/\//i.test(d.url) || isInstalledReadme(d.url))?.url;
      const owner = url ? githubRef(url)?.owner : undefined;
      if (url) actions.push({ key: `software:${c.name}`, kind: "software", step: "software", spends: true, tool: c.name, urls: [url], ...(owner ? { github: owner } : {}), label: `Write a spec for ${c.name} from ${url}` });
      else waits.push(`${c.name}: no docs link found; give one with \`vibegraph-knowledge software add ${c.name} --from <docs url>\`, or set it aside`);
    }
  }

  const groups = step("groups"), brief = step("brief");
  if (groups?.status === "todo") actions.push({ key: "groups", kind: "groups", step: "groups", spends: true, label: "Propose the architecture groups" });
  else if (groups?.status === "waiting") waits.push("Decide the proposed groups on the Brief card (the map)");
  if (brief?.status === "todo" && groups?.status === "done") actions.push({ key: "brief", kind: "brief", step: "brief", spends: true, label: "Write the Brief" });
  else if (brief?.status === "todo") waits.push("The Brief is written once the groups are ratified: run again after deciding them");
  else if (brief?.status === "waiting") waits.push("Decide the drafted Brief on the Brief card (the map)");

  const rules = step("rules");
  if (rules?.status === "todo") actions.push({ key: "rules", kind: "rules", step: "rules", spends: true, label: "Propose rules from the architecture" });
  else if (rules?.status === "waiting") waits.push(rules.now.text || "Decide the proposed rules in the Rules panel");

  const direction = step("direction");
  if (direction?.status === "optional") actions.push({ key: "census", kind: "census", step: "direction", spends: false, label: "Read the direction the code already takes (no model call)" });
  else if (direction?.status === "waiting") waits.push("Agree or drop the direction read from the code (Direction panel)");

  const hooks = step("hooks");
  if (hooks?.status === "todo") waits.push("Install the hooks from a terminal in the project: vibegraph-knowledge init --hooks");
  else if (hooks?.status === "waiting") waits.push("Start a Claude Code session in the project to see the hooks fire");

  return { actions: actions.slice(0, MAX_ACTIONS), waits };
}

/** `needs`: a grant that would let a failed step succeed (a private repository) */
type Outcome = { ok: boolean; error?: string; detail?: string; needs?: { github: string } };

export interface SetupRunCtx {
  state: () => SetupState;
  classify: () => Promise<Outcome>;
  software: (tool: string, urls: string[]) => Promise<Outcome>;
  groups: () => Promise<Outcome>;
  brief: () => Promise<Outcome>;
  rules: () => Promise<Outcome>;
  census: () => Outcome;
  /** after an action: the derived facts (the stack, the map) catch up */
  settle: () => Promise<void>;
  step: (text: string) => void;
  /** RC6 — one cheap model call before a run that spends: on a failure (an
   *  expired login) the steps that need the model are not run, said once with
   *  the remedy, instead of each failing; the others still run */
  preflight?: () => Promise<{ ok: boolean; error?: string }>;
}

export interface SetupRunResult {
  ok: boolean;
  error?: string;
  ran: Array<{ label: string; detail: string }>;
  failed: Array<{ label: string; error: string; needs?: { github: string } }>;
  waits: string[];
  /** RC6 — the model call failed before the run: why, and the steps held back */
  held?: { error: string; labels: string[] };
}

/** Run every action Claude can take now, or only the selected steps' (the
 *  guide's chips, 2026-10-22), one at a time, in the setup's order. */
export async function runSetup(ctx: SetupRunCtx, opts: { steps?: readonly SetupStepId[] } = {}): Promise<SetupRunResult> {
  if (opts.steps && !opts.steps.length) return { ok: false, error: "no step is selected", ran: [], failed: [], waits: setupActions(ctx.state()).waits };
  const attempted = new Set<string>();
  const ran: SetupRunResult["ran"] = [];
  const failed: SetupRunResult["failed"] = [];
  const first = setupActions(ctx.state()).actions.filter((x) => !opts.steps || opts.steps.includes(x.step));
  let held: SetupRunResult["held"];
  if (ctx.preflight && first.some((x) => x.spends)) {
    ctx.step("checking the model call works");
    const p = await ctx.preflight();
    if (!p.ok) held = { error: p.error ?? "the model call failed", labels: [] };
  }
  for (let i = 0; i < MAX_ACTIONS; i++) {
    const a = setupActions(ctx.state()).actions.find((x) => !attempted.has(x.key) && (!opts.steps || opts.steps.includes(x.step)));
    if (!a) break;
    attempted.add(a.key);
    if (held && a.spends) { held.labels.push(a.label); continue; }
    ctx.step(`${attempted.size}. ${a.label}`);
    let r: Outcome;
    try {
      r = a.kind === "classify" ? await ctx.classify()
        : a.kind === "software" ? await ctx.software(a.tool!, a.urls!)
          : a.kind === "groups" ? await ctx.groups()
            : a.kind === "brief" ? await ctx.brief()
              : a.kind === "rules" ? await ctx.rules()
                : ctx.census();
    } catch (e) { r = { ok: false, error: String((e as Error)?.message ?? e) }; }
    if (r.ok) ran.push({ label: a.label, detail: r.detail ?? "done" });
    else failed.push({ label: a.label, error: r.error ?? "failed", ...(r.needs ? { needs: r.needs } : {}) });
    await ctx.settle();
  }
  const waits = setupActions(ctx.state()).waits;
  if (held && !ran.length && !failed.length) return { ok: false, error: `not run: ${held.error}`, ran, failed, waits, held };
  if (!ran.length && !failed.length) return { ok: false, error: waits.length ? `nothing for Claude to run now: ${waits[0]}` : "nothing for Claude to run: the setup is done", ran, failed, waits };
  return { ok: true, ran, failed, waits, ...(held ? { held } : {}) };
}

/** The run's one-line ending, for the bubble and the guide. */
export function setupRunSummary(r: SetupRunResult): string {
  const parts = [`${r.ran.length} step${r.ran.length === 1 ? "" : "s"} run`];
  if (r.failed.length) parts.push(`${r.failed.length} failed`);
  if (r.held?.labels.length) parts.push(`${r.held.labels.length} not run (the model call failed)`);
  if (r.waits.length) parts.push(`${r.waits.length} wait${r.waits.length === 1 ? "s" : ""} for you`);
  return parts.join(", ");
}
