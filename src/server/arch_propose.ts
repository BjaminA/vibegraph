// M-ARCH.4 (PLAN-M-ARCH.md) — the PROPOSED stratum: a model reads the
// derived architecture, the deployment facts (infra_manifests.ts) and the
// project's own docs, and proposes ONLY what the code cannot say —
// deployment/trust groupings, display names, the primary path, a narrative.
//
// What it may not do, enforced here rather than asked for: add a node or an
// edge (a `wraps` naming an id the model was not shown is refused), label a
// protocol or a payload (there is no field for it), position anything (there
// is no field for it). Every item must CITE its evidence, and a citation is
// checked against what the model was shown — a `file:line` of a manifest
// fact or a doc excerpt, or a node / edge id. An item whose citations all
// fail is kept as INFERRED (evidence: []) and drawn as a ghost: the
// system_draft.ts enforceGrounding precedent — never let the model
// manufacture its own evidence.
//
// Pure except `docExcerpts` (reads the project's markdown). No spawn here:
// the server and the CLI run the model their own way.
//
// 2026-10-05 — a group states WHO BELONGS by rule (`match`, src/shared/
// arch_rules.ts), so code added later joins it with no model; the model is
// shown the PLAN (objective, planned processes and modules, where their code
// will live) and may anchor a group to a planned item before its code exists
// (`planned`, cited as `plan:processes:<id>`); and an UPDATE pass, offered
// when the map drifted from the ratified groups (arch_drift.ts), is shown
// those groups as fixed and extends them for what changed.

import * as fs from "fs";
import * as path from "path";
import type { ArchModelRecord } from "../shared/protocol.ts";
import { GROUP_KINDS, type ArchProposal, type ProposedGroup, type ProposedName, type StatedGroup } from "./arch_store.ts";
import type { ArchDrift } from "../shared/protocol.ts";
import type { Plan } from "../shared/plan_types.ts";
import { describeRule, resolveMembers, validateRule, type GroupRule } from "../shared/arch_rules.ts";
import { factCitation, type InfraFact } from "./infra_manifests.ts";
import { docFiles } from "./stack_classify.ts";

export interface DocExcerpt { file: string; line: number; text: string }

/** A proposed label, bounded: a model's words are capped, but at a WORD
 *  boundary and with an ellipsis. A hard slice stored labels cut mid-word
 *  ("…ingest, classifica") as if that were the name (2026-09-25). */
export const LABEL_MAX = 80;
export function boundLabel(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= LABEL_MAX) return t;
  const cut = t.slice(0, LABEL_MAX - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > LABEL_MAX / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:·—-]+$/, "")}…`;
}

const DOC_TERMS = /\b(deploy|deployed|host|hosted|server|region|subnet|vpc|network|relay|process|pm2|docker|container|kubernetes|k8s|service|gateway|proxy|cdn|browser|client|worker|queue|database|cluster|environment|production|staging)\b/i;

/** Lines of the project's own docs that talk about where things run, plus
 *  any line naming a cluster root or a tool. Capped. */
export function docExcerpts(root: string, model: ArchModelRecord, max = 80): DocExcerpt[] {
  const names = new Set<string>();
  for (const n of model.nodes) {
    if (n.kind === "tool" && n.tool) names.add(n.tool.toLowerCase());
    if (n.root) names.add(n.root.toLowerCase());
  }
  const out: DocExcerpt[] = [];
  for (const abs of docFiles(root, { maxFiles: 60, depth: 2 })) {
    let text: string;
    try {
      if (fs.statSync(abs).size > 512 * 1024) continue;
      text = fs.readFileSync(abs, "utf-8");
    } catch { continue; }
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && out.length < max; i++) {
      const l = lines[i].trim();
      if (l.length < 12 || l.length > 400) continue;
      const lower = l.toLowerCase();
      if (DOC_TERMS.test(l) || [...names].some((n) => n.length > 3 && lower.includes(n))) {
        out.push({ file: rel, line: i + 1, text: l.slice(0, 240) });
      }
    }
    if (out.length >= max) break;
  }
  return out;
}

export interface ReviseInput {
  /** the pending proposal being modified. */
  previous: Pick<ArchProposal, "groups" | "names" | "primaryPath" | "narrative">;
  /** what the person asked for, verbatim. */
  guidance: string;
}

/** An UPDATE after drift: the ratified groups (fixed) and what changed. */
export interface UpdateInput { groups: readonly StatedGroup[]; drift: ArchDrift }

/** The plan items a group may anchor to, as citations (`plan:processes:api`). */
export function planCitations(plan: Plan | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!plan || plan.closed) return out;
  for (const pr of plan.processes) if (pr.status !== "dropped") out.set(`plan:processes:${pr.id}`, `process ${pr.id} "${pr.label}"${pr.at ? ` — code at ${pr.at}` : ""}${pr.serves ? ` — serves: ${pr.serves}` : ""} (${pr.status})`);
  for (const m of plan.modules ?? []) if (m.status !== "dropped") out.set(`plan:modules:${m.id}`, `module ${m.id} (${m.kind}) — code at ${m.at} (${m.status})`);
  for (const st of plan.stores ?? []) if (st.status !== "dropped") out.set(`plan:stores:${st.id}`, `store ${st.id} (${st.kind}) reached through ${(st.reachedThrough ?? []).join(", ")} (${st.status})`);
  return out;
}

export function buildProposePrompt(model: ArchModelRecord, facts: InfraFact[], docs: DocExcerpt[], revise?: ReviseInput, opts: { plan?: Plan | null; update?: UpdateInput } = {}): string {
  const L: string[] = [];
  L.push(
    "You are proposing the DEPLOYMENT and TRUST grouping of a software architecture that was derived from code.",
    "The boxes and arrows below are facts: you may not add, remove or rename-away any of them, and you may not describe protocols or payloads — those were read from the code already.",
    "You propose ONLY: (1) groups — deployment/trust boundaries (kinds: " + GROUP_KINDS.join(", ") + ") that wrap existing node ids, nestable by `parent`; (2) display names for existing nodes, when the evidence names them better; (3) the primary path — the entry points a newcomer should walk first; (4) a narrative of at most two sentences.",
    "EVERY group, name and path must cite evidence: `file:line` of a deployment fact or doc line listed below, or a node / edge id listed below. Cite only what is listed. If nothing listed supports an item, leave its evidence empty — it will be shown as INFERRED, which is better than a citation that does not hold.",
    "",
    "GROUPS MUST OUTLAST THE CODE THEY SEE TODAY. The project will grow; a group that only lists today's boxes holds nothing that is added later. So give each group a `match`: rules a box joins it by, checked by code on every change. A rule is an object whose fields must ALL hold; a group's `match` is a list of rules, ANY of which admits a box. Fields: `kind` (cluster | tool | hub), `rootPrefix` (the package root starts with this folder; \"\" = the project root), `pathPrefix` (an entry point's file starts with this), `family` (list: web, api, mcp, scripts, cli, model, library), `framework` (list), `role` (a tool's role, list), `tool` (tool names; \"@scope/\" matches a package scope). Prefer folder- and package-shaped rules (`rootPrefix`, `pathPrefix`, `tool` scopes) that describe WHY a box belongs, not a list of today's ids. Keep `wraps` for a box no rule describes. `exclude` lists box ids a rule must not bring in.",
    "",
    "## Nodes (derived)",
  );
  for (const n of model.nodes) {
    const bits = [n.label, n.sublabel];
    if (n.kind === "cluster" && n.entryPoints?.length) bits.push(`e.g. ${n.entryPoints.slice(0, 3).join(", ")}`);
    const facts2 = [n.root !== undefined ? `root ${n.root === "." ? "\"\"" : n.root}` : "", n.family ? `family ${n.family}` : "", n.frameworks?.length ? `frameworks ${n.frameworks.join("|")}` : "", n.tool ? `tool ${n.tool}` : "", n.role ? `role ${n.role}` : ""].filter(Boolean).join(", ");
    L.push(`- ${n.id}: ${bits.join(" — ")}${facts2 ? ` [${facts2}]` : ""}`);
  }
  L.push("", "## Edges (derived)");
  for (const e of model.edges) L.push(`- ${e.id}: ${e.from} → ${e.to} (${e.protocol}${e.count > 1 ? ` ×${e.count}` : ""})`);
  L.push("", "## Deployment facts (read line by line from compose / Dockerfile / k8s / terraform / pm2 / Procfile / systemd / .env.example)");
  if (!facts.length) L.push("(none found — say so through INFERRED items rather than inventing hosts)");
  for (const f of facts) L.push(`- ${factCitation(f)}: ${f.kind} ${f.name}${f.detail ? ` = ${f.detail}` : ""}`);
  L.push("", "## The project's own documentation (lines about where things run)");
  if (!docs.length) L.push("(none)");
  for (const d of docs) L.push(`- ${d.file}:${d.line}: ${d.text}`);
  const planned = planCitations(opts.plan);
  if (opts.plan && planned.size) {
    L.push(
      "", "## The project's plan (where it is heading — hypothetical, agreed or proposed by a person; not the code)",
      `Objective: ${opts.plan.objective}`,
      "Organise the groups so they stay true as this plan is built: a planned process's code will appear under its `at` folder, so a rule on that folder groups it the day it lands. A group may be anchored to a planned item with `planned` (its citation below) even when no code exists yet; it is drawn once a box matches its rules. Cite a plan item as evidence only for what the plan says.",
    );
    for (const [cite, text] of planned) L.push(`- ${cite}: ${text}`);
  }
  if (opts.update) {
    L.push(
      "", "## UPDATE — a person ratified the groups below; the map has moved since",
      "These groups are FIXED: do not rename, re-kind, re-parent or remove them, and do not move a box out of one. You may EXTEND a group (repeat its id with the members or rules to ADD) or propose a NEW group for what no group fits. Propose nothing for what did not change. Names and a primary path are optional here.",
    );
    for (const g of opts.update.groups) L.push(`- ${g.id} (${g.kind}) "${g.label}"${g.parent ? ` in ${g.parent}` : ""}: names ${g.wraps.join(", ") || "nothing"}${g.match?.length ? `; rules: ${g.match.map(describeRule).join(" OR ")}` : ""}${g.planned ? `; planned: ${g.planned}` : ""}`);
    L.push("", "What changed:");
    for (const r of opts.update.drift.reasons) L.push(`- ${r}`);
    if (opts.update.drift.unplaced.length) L.push(`Clusters in no group: ${opts.update.drift.unplaced.join(", ")}`);
  }
  if (revise) {
    L.push(
      "",
      "## The person asked you to revise your previous proposal",
      `Their words: ${JSON.stringify(revise.guidance.slice(0, 2000))}`,
      "Your previous proposal (revise it; the same grounding rules apply to every item):",
      JSON.stringify({ groups: revise.previous.groups, names: revise.previous.names, primaryPath: revise.previous.primaryPath, narrative: revise.previous.narrative }),
    );
  }
  L.push(
    "",
    "Reply with JSON only:",
    '{"groups":[{"id":"g-<slug>","kind":"host|region|subnet|trust|network|process|account|zone","label":"<≤60 chars>","match":[{"rootPrefix":"<folder>","kind":"cluster"}],"wraps":["<node id or group id, for boxes no rule describes>"],"exclude":["<node id, optional>"],"parent":"<group id, optional>","planned":"<plan:processes:<id>, optional>","evidence":["<file:line, node/edge id or plan citation>"]}],"names":{"<node id>":{"label":"<≤60 chars>","evidence":["..."]}},"primaryPath":{"entryPoints":["<entry point id>"],"evidence":["..."]},"narrative":"<≤2 sentences>"}',
  );
  return L.join("\n");
}

function jsonOf(text: string): Record<string, unknown> | null {
  let body = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(body);
  if (fence) body = fence[1].trim();
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

/** Validate a reply against what the model was shown. Nothing is coerced:
 *  an unknown id is refused and named; an unsupported citation is dropped. */
export function parseProposal(
  text: string, model: ArchModelRecord, facts: InfraFact[], docs: DocExcerpt[],
  meta: { model: string; now?: () => Date; plan?: Plan | null; update?: { groups: readonly StatedGroup[] } },
): { proposal: ArchProposal | null; error?: string } {
  const obj = jsonOf(text);
  if (!obj) return { proposal: null, error: "the reply contained no JSON object" };
  const nodeIds = new Set(model.nodes.map((n) => n.id));
  const edgeIds = new Set(model.edges.map((e) => e.id));
  const entryIds = new Set(model.nodes.flatMap((n) => n.entryPoints ?? []));
  const planned = planCitations(meta.plan);
  const cites = new Set<string>([...facts.map(factCitation), ...docs.map((d) => `${d.file}:${d.line}`), ...nodeIds, ...edgeIds, ...planned.keys()]);
  const statedIds = new Set((meta.update?.groups ?? []).map((g) => g.id));
  const refused: ArchProposal["refused"] = [];
  // CIRCULAR citations are dropped too (found on a private production codebase, the first real
  // run: three names cited only the node they named). A node's own id proves
  // it exists, not what it should be called or where it runs; an EDGE or a
  // manifest line about it is evidence.
  const keepEvidence = (raw: unknown, item: string, subject: ReadonlySet<string> = new Set()): string[] => {
    const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").map((c) => c.trim()) : [];
    const bad = list.filter((c) => !cites.has(c));
    const circular = list.filter((c) => cites.has(c) && subject.has(c));
    if (bad.length) refused.push({ item, reason: `citation(s) not among what was shown, dropped: ${bad.slice(0, 4).join(", ")}` });
    if (circular.length) refused.push({ item, reason: `circular citation(s) — the thing described is not evidence about itself, dropped: ${circular.slice(0, 4).join(", ")}` });
    return list.filter((c) => cites.has(c) && !subject.has(c));
  };

  const groups: ProposedGroup[] = [];
  const rawGroups = Array.isArray(obj.groups) ? obj.groups : [];
  const proposedIds = new Set(rawGroups.map((g) => (g && typeof g === "object" ? String((g as Record<string, unknown>).id ?? "") : "")));
  for (const raw of rawGroups) {
    const g = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const id = typeof g.id === "string" ? g.id.trim() : "";
    const label = typeof g.label === "string" ? boundLabel(g.label) : "";
    const kind = typeof g.kind === "string" ? g.kind.trim() : "";
    if (!/^[A-Za-z][\w.:-]{0,79}$/.test(id) || !label) { refused.push({ item: `group ${id || "?"}`, reason: "needs an id and a label" }); continue; }
    if (!(GROUP_KINDS as readonly string[]).includes(kind)) { refused.push({ item: `group ${id}`, reason: `kind "${kind}" is not one of ${GROUP_KINDS.join(", ")}` }); continue; }
    const wrapsRaw = Array.isArray(g.wraps) ? g.wraps.filter((w): w is string => typeof w === "string") : [];
    const wraps = wrapsRaw.filter((w) => nodeIds.has(w) || ((proposedIds.has(w) || statedIds.has(w)) && w !== id));
    const unknown = wrapsRaw.filter((w) => !wraps.includes(w));
    if (unknown.length) refused.push({ item: `group ${id}`, reason: `wraps id(s) the model was not shown — a model may not add nodes: ${unknown.slice(0, 4).join(", ")}` });
    // Rules: each validated as written; a malformed one is refused, never coerced.
    const match: GroupRule[] = [];
    for (const raw of Array.isArray(g.match) ? g.match : []) {
      const v = validateRule(raw);
      if (v.rule) match.push(v.rule);
      else refused.push({ item: `group ${id}`, reason: `rule refused: ${v.error}` });
    }
    const exclude = (Array.isArray(g.exclude) ? g.exclude : []).filter((w): w is string => typeof w === "string" && nodeIds.has(w));
    const plannedRaw = typeof g.planned === "string" ? g.planned.trim() : "";
    const plannedAt = plannedRaw && planned.has(plannedRaw) ? plannedRaw : undefined;
    if (plannedRaw && !plannedAt) refused.push({ item: `group ${id}`, reason: `planned "${plannedRaw}" is not a plan item that was shown` });
    const byRule = match.length ? resolveMembers([{ id, wraps: [], match, exclude }], model).get(id)!.byRule : [];
    if (!wraps.length && !byRule.length && !plannedAt && !(meta.update && statedIds.has(id) && match.length)) {
      refused.push({ item: `group ${id}`, reason: match.length ? "its rules match nothing in the map and it anchors to no planned item" : "wraps nothing that exists" });
      continue;
    }
    const parent = typeof g.parent === "string" && (proposedIds.has(g.parent) || statedIds.has(g.parent)) && g.parent !== id ? g.parent : undefined;
    groups.push({
      id, kind, label, wraps, ...(parent ? { parent } : {}),
      ...(match.length ? { match } : {}), ...(exclude.length ? { exclude } : {}), ...(plannedAt ? { planned: plannedAt } : {}),
      evidence: keepEvidence(g.evidence, `group ${id}`, new Set([...wraps, ...byRule])),
    });
  }

  const names: Record<string, ProposedName> = {};
  for (const [id, raw] of Object.entries((obj.names && typeof obj.names === "object" ? obj.names : {}) as Record<string, unknown>)) {
    if (!nodeIds.has(id)) { refused.push({ item: `name ${id}`, reason: "names a node the model was not shown" }); continue; }
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const label = typeof r.label === "string" ? boundLabel(r.label) : typeof raw === "string" ? boundLabel(raw as string) : "";
    if (!label) continue;
    names[id] = { label, evidence: keepEvidence(r.evidence, `name ${id}`, new Set([id])) };
  }

  let primaryPath: ArchProposal["primaryPath"];
  const pp = (obj.primaryPath && typeof obj.primaryPath === "object" ? obj.primaryPath : null) as Record<string, unknown> | null;
  if (pp) {
    const eps = (Array.isArray(pp.entryPoints) ? pp.entryPoints : []).filter((x): x is string => typeof x === "string");
    const ok = eps.filter((e) => entryIds.has(e));
    if (eps.length !== ok.length) refused.push({ item: "primaryPath", reason: `entry point(s) not in the model: ${eps.filter((e) => !ok.includes(e)).slice(0, 4).join(", ")}` });
    if (ok.length) primaryPath = { entryPoints: ok.slice(0, 8), evidence: keepEvidence(pp.evidence, "primaryPath") };
  }
  const narrative = typeof obj.narrative === "string" ? obj.narrative.trim().slice(0, 400) : undefined;

  return {
    proposal: {
      at: (meta.now ?? (() => new Date()))().toISOString(),
      model: meta.model,
      groups, names, ...(primaryPath ? { primaryPath } : {}), ...(narrative ? { narrative } : {}), refused,
      ...(meta.update ? { mode: "update" as const } : {}),
    },
  };
}
