// RULES PROPOSED FROM THE ARCHITECTURE — the dossier and the prompt
// (2026-10-19, PLAN-M-RULES M2). The ONE token-spending step for rules; the
// harvest (rule_harvest.ts) and the direction census (project_direction.ts)
// stay zero-token and are INPUTS here, not replaced.
//
// The model is shown, deterministically and capped, the facts a rule-writer
// needs side by side — the processes and stated groups, the tools by role and
// what leaves through each, the project's own funnels, the hops between
// processes, the configuration that fails silently when unset, the unguarded
// data flows, the rule-shaped sentences in the prose, the census's proposals,
// the plan — each an item with an id. A proposed rule must cite those ids
// (rule_draft_gate.ts drops one that cites nothing it was shown) and may use
// only the scope vocabulary listed: entry point ids, folders, tool names.

import { buildCrossingIndex } from "./crossings.ts";
import { archModelForEnvelope } from "./arch_envelope.ts";
import { buildEnvSurface } from "../shared/env_surface.ts";
import { readEnvDeclarations } from "./env_declarations.ts";
import { computeDataflow } from "./dataflow.ts";
import { harvestRules } from "./rule_harvest.ts";
import { census } from "./project_direction.ts";
import { loadPlan } from "./plan_store.ts";
import { loadConstraints, statedRules } from "./constraint_store.ts";
import type { StackIndex } from "./stack.ts";

export type DossierKind = "process" | "group" | "tool" | "funnel" | "boundary" | "crossing" | "env" | "flow" | "harvest" | "direction" | "plan";
export interface DossierItem {
  id: string;
  kind: DossierKind;
  text: string;
  /** a harvest item's verbatim sentence: a rule citing it stores it as its `cite` */
  cite?: { file: string; line: number; quote: string };
}
export interface RuleDossier {
  project: string;
  items: DossierItem[];
  /** the rules already stated (classifications excluded): the model must not restate them;
   *  one with no checkable half may be given one (the reply's `checks`) */
  stated: Array<{ id: string; text: string; checked: boolean }>;
  vocab: { entryPoints: string[]; folders: string[]; tools: string[] };
  counts: { files: number; entryPoints: number; threads: number };
}

interface EnvelopeLike {
  files: Record<string, any>;
  entryPoints?: Array<{ id: string; kind?: string; file?: string; label?: string; framework?: string | null; metadata?: Record<string, unknown> }>;
  threads: any[];
}

const PROTOCOL = new Set(["http-client", "model-api", "platform", "agent-protocol", "db", "cache", "queue", "cloud", "remote", "process", "device"]);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildRuleDossier(root: string, env: EnvelopeLike, stack: StackIndex, opts: { model?: ReturnType<typeof archModelForEnvelope> } = {}): RuleDossier {
  const items: DossierItem[] = [];
  const add = (kind: DossierKind, id: string, text: string, cite?: DossierItem["cite"]) => items.push({ id, kind, text: cut(text, 300), ...(cite ? { cite } : {}) });
  const crossings = buildCrossingIndex(env as never);
  const model = opts.model ?? archModelForEnvelope(env as never, stack, crossings, root);

  // processes and the groups a person stated
  for (const n of model.nodes.filter((x) => x.kind === "cluster").slice(0, 30)) {
    add("process", `process:${n.id}`, `${n.label} (${n.category})${n.root ? ` under ${n.root}/` : ""} — ${n.entryPoints?.length ?? 0} entry point(s), ${n.files ?? 0} file(s)`);
  }
  const label = new Map(model.nodes.map((n) => [n.id, n.label]));
  for (const g of (model.groups ?? []).filter((x) => x.source === "stated")) {
    add("group", `group:${g.id}`, `${g.kind} "${g.label}" holds ${g.wraps.map((w) => label.get(w) ?? w).join(", ")}`);
  }

  // tools by role; what leaves through each; the project's own funnels
  const tools = [...stack.tools].sort((a, b) => (b.calledOn?.length ?? 0) - (a.calledOn?.length ?? 0) || b.threads.length - a.threads.length);
  for (const t of tools.filter((x) => x.origin !== "project" && PROTOCOL.has(x.role)).slice(0, 50)) {
    add("tool", `tool:${t.tool}`, `${t.tool} — ${t.role}${t.origin === "stdlib" ? " (standard library)" : ""}${t.version ? ` ${t.version}` : ""}; in files on ${t.threads.length} thread(s), leaves the project through it on ${t.calledOn?.length ?? 0}; used in ${t.files.length} file(s)${t.files.length <= 4 ? `: ${t.files.join(", ")}` : ""}`);
    const called = t.calledOn ?? [];
    if (called.length) add("boundary", `boundary:${t.tool}`, `threads leaving through ${t.tool}: ${called.slice(0, 8).join(", ")}${called.length > 8 ? `, +${called.length - 8}` : ""}`);
  }
  for (const t of tools.filter((x) => x.origin === "project").slice(0, 30)) {
    add("funnel", `funnel:${t.tool}`, `${t.home ?? t.tool} is the project's own module${t.wraps?.length ? ` wrapping ${t.wraps.join(", ")}` : ""}; imported in ${t.files.length} file(s), on ${t.threads.length} thread(s)`);
  }

  // hops between processes
  crossings.all.filter((c) => c.confidence !== "unmatched" && c.targets.length).slice(0, 30).forEach((c, i) => {
    add("crossing", `crossing:${i + 1}`, `${c.entryPointId} → ${c.kind ?? "http"} ${c.method ? `${c.method} ` : ""}${c.path} → ${c.targets.map((t) => t.entryPointId).join(" | ")} (${c.confidence})`);
  });

  // configuration that fails silently, then the rest read and set nowhere
  const surface = buildEnvSurface(env as never, readEnvDeclarations(root));
  const byName = new Map(surface.vars.map((v) => [v.name, v]));
  const envs = [...surface.vars.filter((v) => v.ifUnset === "silent"), ...surface.undeclared.map((n) => byName.get(n)!).filter((v) => v.ifUnset !== "silent")].slice(0, 25);
  for (const v of envs) {
    const r = v.readers[0];
    add("env", `env:${v.name}`, `${v.name} read in ${r.file}:${r.line}${v.readers.length > 1 ? ` (+${v.readers.length - 1})` : ""}; if unset: ${v.ifUnset}; ${v.declared.length ? `set by ${[...new Set(v.declared.map((d) => d.file))].join(", ")}` : "set by nothing that reaches a host"}${v.buildTime ? "; build-time" : ""}`);
  }

  // untrusted input reaching a sink with no check on the way
  for (const f of computeDataflow(env as never).findings.filter((x) => x.severity === "high").slice(0, 15)) {
    add("flow", `flow:${f.sink.file}:${f.sink.line ?? 0}`, `${f.kind} sink \`${cut(f.sink.text, 90)}\` in ${f.sink.fn} from ${f.source.what}`);
  }

  // what the project's own prose and the census already say
  for (const c of harvestRules(root, env as never, stack).candidates.slice(0, 25)) {
    add("harvest", `harvest:${c.file}:${c.line}`, `"${c.quote}" (${c.where}${c.under ? ` under "${cut(c.under, 50)}"` : ""})`, { file: c.file, line: c.line, quote: c.quote });
  }
  const plan = (() => { try { return loadPlan(root); } catch { return null; } })();
  for (const d of census({ stack, model, files: env.files, plan }).slice(0, 15)) {
    add("direction", `direction:${d.basis}`, `${d.text} — ${d.why}`);
  }
  if (plan?.objective) add("plan", "plan:objective", `the objective: ${plan.objective}`);
  for (const p of (plan?.policies ?? []).filter((x: any) => x.status === "agreed").slice(0, 10)) add("plan", `plan:policies:${p.id}`, `${p.text}${p.why ? ` — ${p.why}` : ""}`);

  // the vocabulary a scope may use
  const files = Object.keys(env.files);
  const folders = new Map<string, number>();
  for (const f of files) { const p = f.split("/"); for (let i = 1; i < Math.min(p.length, 3); i++) { const d = `${p.slice(0, i).join("/")}/`; folders.set(d, (folders.get(d) ?? 0) + 1); } }
  let stated: RuleDossier["stated"] = [];
  try { stated = statedRules(loadConstraints(root)).map((c) => ({ id: c.id, text: cut(c.text, 200), checked: !!(c.check || c.checks?.length) })); } catch { stated = []; }
  return {
    project: root.split(/[\\/]/).filter(Boolean).pop() ?? root,
    items,
    stated,
    vocab: {
      entryPoints: (env.entryPoints ?? []).map((e) => e.id).slice(0, 400),
      folders: [...folders].filter(([, n]) => n >= 2).map(([d]) => d).sort(),
      tools: stack.tools.filter((t) => t.origin === "project" || PROTOCOL.has(t.role)).map((t) => t.tool).sort(),
    },
    counts: { files: files.length, entryPoints: env.entryPoints?.length ?? 0, threads: env.threads.length },
  };
}

export const MAX_DRAFT_RULES = 12;

/** Proposals already waiting for a person: agent-stated rules and open rule changes.
 *  M3: three presses on one tree left thirty unreviewed proposals — each press may add
 *  twelve, and a person's attention, not the model, is what runs out. A draft is refused
 *  while a press's worth already waits. */
export function pendingReview(root: string): number {
  try {
    return statedRules(loadConstraints(root)).reduce((n, c) => n + (c.source !== "human" ? 1 : 0) + ((c.proposals ?? []).length), 0);
  } catch { return 0; }
}
export function pendingReviewRefusal(n: number): string {
  return `${n} proposals already wait for a person (agent-stated rules and open rule changes) — ratify, accept or remove them first, so a new draft does not bury them`;
}

export function buildRuleDraftPrompt(d: RuleDossier): string {
  const byKind = (k: DossierKind) => d.items.filter((i) => i.kind === k);
  const section = (title: string, k: DossierKind) => (byKind(k).length ? [``, `## ${title}`, ...byKind(k).map((i) => `- [${i.id}] ${i.text}`)] : []);
  return [
    `You are proposing the RULES a codebase must keep — for the project "${d.project}" (${d.counts.files} parsed files, ${d.counts.entryPoints} entry points). A person will read each proposal and ratify or remove it; nothing you write is applied without them.`,
    "",
    "A rule states a decision the code alone does not reveal and a future change could break: a path every call must take, a module that is the only door to a tool, a payload that must keep its shape, a process that must not reach another, a setting a deploy must provide, an input that must be checked before it reaches a shell or a query. NOT a description of what the code does, NOT style, NOT something every project says.",
    "",
    "Rules you propose MUST rest on the facts below. Each fact has an id in [brackets]; every rule cites at least one id it rests on. A rule that cites nothing shown is discarded — say it under withoutEvidence instead.",
    ...section("Processes", "process"), ...section("Groups a person stated", "group"),
    ...section("Tools by role (what leaves the project, and through what)", "tool"), ...section("Which threads leave through each tool", "boundary"),
    ...section("The project's own modules that wrap a tool (funnels)", "funnel"), ...section("Hops between processes", "crossing"),
    ...section("Configuration: read by the code, and what an unset value does", "env"), ...section("Untrusted input reaching a sink with no check on the way", "flow"),
    ...section("Rule-shaped sentences in the project's own prose", "harvest"), ...section("Habits the code already has (a census)", "direction"),
    ...section("The plan", "plan"),
    "",
    "## Rules already stated — do NOT restate or reword these",
    ...(d.stated.length ? d.stated.map((s) => `- ${s.id}${s.checked ? "" : " (no check yet)"}: ${s.text}`) : ["- none"]),
    ...(d.stated.some((s) => !s.checked) ? ["For a stated rule marked (no check yet), you may propose the checkable half it lacks, under `checks` in the reply — only where a shape below fits it exactly."] : []),
    "",
    "## Scope vocabulary — use these spellings exactly; anything else is dropped",
    `- entryPointIds (one thread each): ${d.vocab.entryPoints.join(", ") || "none"}`,
    `- files (a folder ends in /; a parsed file path also works): ${d.vocab.folders.join(", ") || "none"}`,
    `- stack (every thread that uses the tool): ${d.vocab.tools.join(", ") || "none"}`,
    "- or {\"all\": true} for a project-wide rule (use sparingly)",
    "",
    "## A checkable half, when the rule fits one exactly (otherwise omit `check`)",
    "- {\"rule\":\"import-only\",\"tool\":\"<tool>\",\"files\":[\"<file>\"]} — only these files may import the tool",
    "- {\"rule\":\"callers-only\",\"target\":\"<function or module.function>\",\"files\":[\"<file>\"]} — only these files may call it",
    "- {\"rule\":\"calls-through\",\"target\":\"<function>\",\"through\":\"<function>\"} — every function calling target also calls through",
    "- {\"rule\":\"payload-keys\",\"target\":\"<function called>\",\"require\":[\"<key>\"]} or with \"forbid\":[\"<key>\"] — the keys a call must / must not send",
    "A `target` is a function as the code calls it (`insert_readings`, `requests.post`, `postIngest`) — never a URL or a route path. Leave out a list you would leave empty.",
    "A check is run against the code before anything is stored: one that cannot be decided is removed and said.",
    "",
    `## Reply with JSON only, at most ${MAX_DRAFT_RULES} rules, the strongest first:`,
    "{\"rules\":[{\"kind\":\"invariant|proxy|payload-schema|backend-call|perf-lever|objective\",\"text\":\"<the rule, one sentence>\",\"why\":\"<why it exists, from the facts>\",\"scope\":{\"entryPointIds\":[],\"files\":[],\"stack\":[]},\"cites\":[\"<fact id>\"],\"check\":{}}],\"checks\":[{\"for\":\"<a stated rule id marked (no check yet)>\",\"check\":{},\"cites\":[\"<fact id>\"]}],\"withoutEvidence\":[\"<a rule you suspect but no fact above supports>\"]}",
  ].join("\n");
}
