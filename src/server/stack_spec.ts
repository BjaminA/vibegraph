// M-STACK.3 (PLAN-M-STACK.md) — the SYSTEM SPEC: the one render of the
// stack FACTS together with the stated POLICIES bound to each tool.
//
// The floor this module exists to hold: a fact and a policy never
// overwrite each other. The facts say what the code uses, with evidence;
// the policies say what has been decided, with provenance; and where the
// two DISAGREE the spec says so in its own section — that disagreement is
// the signal the whole milestone is for, not an error to smooth over.
//
// Pure: index + constraints in, string out. Every prompt that needs the
// stack (the brief, the worker, the D1 agent, the chat) reads THIS, so
// they cannot drift into four different summaries.

import { ROLE_LABEL, ROLE_ORDER, toolNote, type StackRole } from "../shared/stack_taxonomy.ts";
import { statedRoleLabel } from "../shared/stack_attribution.ts";
import type { StackIndex, StackTool } from "./stack.ts";
import { policySentence, type Constraint } from "./constraint_store.ts";

const SPEC_BUDGET_CHARS = 3000;
const SUMMARY_BUDGET_CHARS = 400;

/** Roles whose tools carry no architectural decision — rendered last and
 *  collapsed to names so the spec's head stays readable. */
const AMBIENT = new Set<StackRole>(["runtime", "build", "test", "utility"]);

/** Every stated constraint that concerns a tool: one whose structured
 *  policy names it, or one scoped to it. Order preserved (statement order
 *  = priority, as everywhere else in the constraint store). */
export function policiesForTool(constraints: Constraint[], tool: string): Constraint[] {
  return constraints.filter((c) => c.policy?.tool === tool || c.policy?.with === tool || c.scope.stack?.includes(tool));
}

const SOURCE_SHORT: Record<Constraint["source"], string> = {
  human: "human-stated",
  orchestrator: "orchestrator-stated",
  agent: "agent-stated, NOT human-reviewed",
};

function factLine(t: StackTool): string {
  const bits: string[] = [];
  if (t.origin === "project") bits.push(`project funnel${t.wraps?.length ? ` wrapping ${t.wraps.join(", ")}` : ""}`);
  else if (t.origin === "stdlib") bits.push("stdlib");
  // M-TABLES — say the gap rather than call it a dependency. A bash command
  // word is the case: it could be coreutils, a third-party CLI, or a script
  // on the deploy host's PATH, and nothing parsed can tell them apart.
  else if (t.origin === "unknown") bits.push("origin unknown — not the shell's own, and no manifest names it");
  // M-CMD.2 — a role a person supplied is labelled as such, next to the fact.
  if (t.roleSource === "stated" && t.roleStatedBy) bits.push(statedRoleLabel(t.roleStatedBy, t.roleStatedSource));
  if (t.version) bits.push(`v${t.version}`);
  const configOnly = t.evidence.every((e) => e.kind === "config");
  bits.push(configOnly
    ? `${t.evidence.length} manifest/config line(s) — NO code parsed for this tool`
    : `${t.evidence.length} site(s) in ${t.files.length} file(s)`);
  return `${t.tool} (${bits.join("; ")})`;
}

/** Where a stated policy and the observed facts disagree. Deterministic
 *  and narrow on purpose: only a rule that can be checked against a
 *  PRESENCE fact is reported, and `replace-with` exempts the funnel it
 *  names (replacing requests WITH telemetry.http_client cannot mean the
 *  wrapper may not import requests). */
export function stackConflicts(index: StackIndex, constraints: Constraint[]): string[] {
  const out: string[] = [];
  const byName = new Map(index.tools.map((t) => [t.tool, t]));
  for (const c of constraints) {
    const p = c.policy;
    if (!p) continue;
    const used = byName.get(p.tool);
    const label = `[${c.id} · ${SOURCE_SHORT[c.source]}] ${policySentence(p)}`;
    // M-CMD.3 — a description decides nothing, so nothing can contradict it.
    if (p.rule === "describe") continue;
    if (p.rule === "require" && !used) {
      out.push(`${label} — but no evidence of ${p.tool} anywhere in the project.`);
      continue;
    }
    if (p.rule !== "forbid" && p.rule !== "replace-with") {
      if (p.rule === "prefer" && p.with && byName.has(p.with)) {
        const alt = byName.get(p.with)!;
        out.push(`${label} — but ${p.with} is still used in ${alt.files.join(", ")}.`);
      }
      continue;
    }
    if (!used) continue;
    const exempt = new Set<string>();
    if (p.rule === "replace-with" && p.with) {
      const funnel = byName.get(p.with);
      if (funnel?.origin === "project") for (const f of funnel.files) exempt.add(f);
    }
    const offending = used.evidence.filter((e) => !exempt.has(e.file));
    if (!offending.length) continue;
    const where = [...new Set(offending.map((e) => `${e.file}${e.line ? `:${e.line}` : ""}`))];
    out.push(`${label} — but ${p.tool} appears at ${where.join(", ")}.`);
  }
  return out;
}

/** One line for a project map (the chat's turn-1 framing). Names the
 *  deciding roles only; ambient plumbing is left out and said to be. */
export function stackSummaryLine(index: StackIndex): string | null {
  if (!index.tools.length) return null;
  const parts: string[] = [];
  for (const role of ROLE_ORDER) {
    if (AMBIENT.has(role) || role === "unknown") continue;
    const list = index.tools.filter((t) => t.role === role);
    if (!list.length) continue;
    parts.push(`${ROLE_LABEL[role]}: ${list.map((t) => t.tool + (t.wraps?.length ? `(wraps ${t.wraps.join("/")})` : "")).join(", ")}`);
  }
  if (!parts.length) return null;
  let line = `Stack (IR fact, from imports/calls/manifests): ${parts.join("; ")}.`;
  if (line.length > SUMMARY_BUDGET_CHARS) line = line.slice(0, SUMMARY_BUDGET_CHARS - 30) + "… (full list: vibegraph_stack)";
  return line;
}

export interface SystemSpecOpts {
  /** Restrict the facts to one thread's tools (the worker / D1 block). */
  entryPointId?: string;
  budget?: number;
  /**
   * M-CMD.1 — where a truncated spec's reader should go next.
   *
   * The default names an MCP tool, which is right for the prompts this was
   * written for and wrong for every other consumer: rendered to a FILE for a
   * plain reader it told them to call `vibegraph_stack`, which they do not
   * have. Measured on a real codebase, where the resulting system_spec.md
   * was 3080 bytes of truncated React components and never reached the db,
   * HTTP, cloud or runtime sections at all (field review B10).
   */
  truncationHint?: string;
}

/**
 * The system spec. Project level with no `entryPointId`; one thread's
 * slice with it. Facts first (with evidence), then the policies bound to
 * those tools (with provenance), then the disagreements.
 */
export function formatSystemSpec(
  index: StackIndex,
  constraints: Constraint[],
  opts: SystemSpecOpts = {},
): string | null {
  const scopedNames = opts.entryPointId ? new Set(index.byThread[opts.entryPointId] ?? []) : null;
  const tools = scopedNames ? index.tools.filter((t) => scopedNames.has(t.tool)) : index.tools;
  if (!tools.length) {
    return opts.entryPointId
      ? "## Stack for this thread (IR fact)\nNo third-party or project-funnel tools on this thread's files — it is plain language code as far as the imports show."
      : null;
  }

  const lines: string[] = [
    opts.entryPointId
      ? "## Stack for this thread (IR fact — what its files import/call; a DECISION about a tool is stated separately below)"
      : "## Project stack (IR fact — derived from imports, calls, includes and manifests; a DECISION about a tool is stated separately below)",
  ];

  // M-BOUNDARY.2 — in a THREAD slice, mark the tools the thread actually
  // calls. The project-level spec stays a presence list: "called" is only
  // meaningful against one thread's boundaries.
  const called = opts.entryPointId ? new Set(index.byThreadCalled?.[opts.entryPointId] ?? []) : null;
  const markCalled = (t: StackTool): string =>
    called && index.byThreadCalled
      ? `${factLine(t)}${called.has(t.tool) ? " — CALLED here" : " — present, not called on this thread"}`
      : factLine(t);

  const ambient: StackTool[] = [];
  for (const role of ROLE_ORDER) {
    const list = tools.filter((t) => t.role === role);
    if (!list.length) continue;
    if (AMBIENT.has(role)) { ambient.push(...list); continue; }
    const label = role === "unknown"
      ? "unclassified (no taxonomy entry — named, never guessed)"
      : ROLE_LABEL[role];
    lines.push(`- ${label}: ${list.map(markCalled).join("; ")}`);
  }
  if (ambient.length) {
    lines.push(`- standard library / build / test / in-process utility: ${ambient.map((t) => t.tool).join(", ")}`);
  }

  // M-CMD.3 — DEFINITIONS for the tools whose role bucket under-describes
  // them (the taxonomy's TOOL_NOTES): what the boundary IS, one line each,
  // only for tools present here. Documentation beside the facts, never a
  // fact — nothing below derives from it.
  const defined: string[] = [];
  const noted = new Set<string>();
  for (const t of tools) {
    if (t.origin === "project") continue;
    const note = toolNote(t.tool);
    if (!note || noted.has(t.tool)) continue;
    noted.add(t.tool);
    defined.push(`- ${t.tool}: ${note}`);
  }
  if (defined.length) lines.push("", "Definitions (from the taxonomy's notes — what these tools ARE; a role above is what they do here):", ...defined);

  // The policies bound to the tools above — STATED, with provenance.
  const bound: Constraint[] = [];
  const seen = new Set<string>();
  for (const t of tools) {
    for (const c of policiesForTool(constraints, t.tool)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      bound.push(c);
    }
  }
  if (bound.length) {
    lines.push("", "Stated policies about these tools (NOT IR fact — the source of each is named):");
    for (const c of bound) {
      const head = c.policy ? `${policySentence(c.policy)} — ` : "";
      lines.push(`- [${c.id} · ${c.kind} · ${SOURCE_SHORT[c.source]}] ${head}${c.text}${c.policy?.reason ? ` (reason: ${c.policy.reason})` : ""}`);
    }
  } else {
    lines.push("", "Stated policies about these tools: none. Nothing has been decided about them beyond what the code does.");
  }

  // Where the two disagree — shown, never reconciled.
  const conflicts = stackConflicts({ ...index, tools }, bound);
  if (conflicts.length) {
    lines.push("", "WHERE THE FACTS AND A STATED POLICY DISAGREE (both are shown; the disagreement is the signal):");
    for (const c of conflicts) lines.push(`- ${c}`);
  }

  const text = lines.join("\n");
  const budget = opts.budget ?? SPEC_BUDGET_CHARS;
  const hint = opts.truncationHint ?? "read the whole index with vibegraph_stack";
  return text.length > budget
    ? text.slice(0, budget) + `\n[spec truncated at ${budget} chars — ${hint}]`
    : text;
}

/**
 * The compact per-packet line the orchestrator brief carries.
 *
 * M-BOUNDARY.2 — CALLED and PRESENT are said apart. `byThread` is
 * presence: every tool imported anywhere in the files this thread walks,
 * which is the right key for routing a policy but tells a planner nothing
 * about what the thread actually reaches. `byThreadCalled` is use: a
 * boundary of this thread attributes to the tool. Present ⊇ called, and a
 * tool present but never called is a dead dependency or a resolution gap —
 * worth seeing, never worth hiding behind one word.
 */
export function packetStackLine(index: StackIndex, entryPointId: string): string {
  const tools = index.byThread[entryPointId] ?? [];
  if (!tools.length) return "Stack: (no third-party or project-funnel tools on this thread's files)";
  const called = new Set(index.byThreadCalled?.[entryPointId] ?? []);
  const byName = new Map(index.tools.map((t) => [t.tool, t]));
  const render = (n: string) => {
    const t = byName.get(n);
    const head = t
      ? `${n} [${t.role}${t.origin === "project" ? `, project funnel wrapping ${t.wraps?.join(", ") ?? "?"}` : ""}]`
      : n;
    // No `byThreadCalled` at all (an index built without thread nodes)
    // means the question was never asked — say nothing rather than
    // reporting every tool as uncalled.
    if (!index.byThreadCalled) return head;
    return called.has(n) ? `${head} CALLED` : `${head} present in the files, not called on this thread`;
  };
  return `Stack: ${tools.map(render).join("; ")}`;
}
