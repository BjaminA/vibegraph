// B0 — THE FACTS A BRIEF IS WRITTEN FROM (2026-10-08). Zero tokens. Everything
// the model is shown, and ONLY what it is shown can be cited: each citable item
// has an id and the text a citation's hash is taken from (brief_validate.ts
// stores those hashes; a cited line that changes later goes STALE).
//
//   project     the plan's objective                         plan:objective
//   boxes       every box: label, what it is, In/Process/Out  <box id>
//   edges       every edge with its protocol and basis        <edge id>
//   groups      the groups now (to keep / rename / move)      (not evidence)
//   rules       the stated constraints                        rule:<id>
//   topology    stores and zones, decision structures         topology:<kind>:<id>
//   plan        planned processes / modules / stores          plan:<section>:<id>
//   specs       ratified software specs                       spec:<tool>:…
//   docs        the project's own doc lines                   <file>:<line>
//   silent      boxes the code says little about, with the
//               code around their call sites                  <file>:<line>
//
// What does not fit (more silent boxes than one call carries) is listed as
// left out, never dropped silently; `silentRest` names them for a batch.

import { createHash } from "node:crypto";
import * as path from "node:path";
import type { ArchModelRecord } from "../shared/protocol.ts";
import type { Plan } from "../shared/plan_types.ts";
import type { Topology } from "../shared/topology_types.ts";
import type { SoftwareSpec } from "../shared/software_types.ts";
import type { Constraint } from "./constraint_store.ts";
import { nodeIO, ioLines, CORE_VOCABULARY, type Vocabulary } from "../shared/node_io.ts";
import { scopeDossier } from "./node_scope.ts";
import { docExcerpts, planCitations } from "./arch_propose.ts";

export const BRIEF_FACT_LIMITS = { boxes: 80, edges: 160, docs: 40, silentPerCall: 6, specOps: 12, rules: 30 };

export interface BriefFacts {
  text: string;
  /** citable id → the text its hash is taken from */
  cites: Map<string, string>;
  boxes: Set<string>;
  /** entry point ids (a start-here step may name one) */
  entries: Set<string>;
  /** box id → the entry points it runs */
  boxEntries: Map<string, string[]>;
  groups: Array<{ id: string; label: string; members: string[] }>;
  /** the silent boxes shown with their code, and the ones left for a batch */
  silent: string[];
  silentRest: string[];
  /** a rough token count of `text` (chars / 4) */
  estimate: number;
  leftOut: string[];
}

export const hash16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const isBox = (n: ArchModelRecord["nodes"][number]) => !n.id.startsWith("zone:") && !n.id.startsWith("store:") && n.kind !== "actor";

/** Boxes the code says little about: no process word, or nothing in or out. */
export function silentBoxes(model: ArchModelRecord, vocab: Vocabulary = CORE_VOCABULARY): string[] {
  return model.nodes.filter(isBox).filter((n) => {
    const io = nodeIO(model, n.id, vocab, {});
    return io.process.length === 0 || (io.in.length === 0 && io.out.length === 0);
  }).map((n) => n.id);
}

export function buildBriefFacts(model: ArchModelRecord, opts: {
  root: string;
  readLines: (file: string) => string[] | null;
  plan?: Plan | null;
  topology?: Topology | null;
  constraints?: Constraint[];
  specs?: SoftwareSpec[];
  vocab?: Vocabulary;
  /** only these silent boxes (a scopes batch); default: the first N */
  silentOnly?: string[];
  /** ratified group labels the facts no longer support (arch_label_drift.ts) */
  staleLabels?: Array<{ group: string; why: string }>;
  /** the source of the functions a rule's check names: part of the rule's
   *  citation hash, so an edit to that code stales a line resting on the rule */
  ruleCode?: (c: Constraint) => string;
}): BriefFacts {
  const vocab = opts.vocab ?? CORE_VOCABULARY;
  const cites = new Map<string, string>();
  const L: string[] = [];
  const leftOut: string[] = [];
  const cite = (id: string, text: string) => { cites.set(id, text); return id; };

  L.push(`PROJECT ${path.basename(opts.root)}`);
  if (opts.plan?.objective) L.push(`- ${cite("plan:objective", opts.plan.objective)}: ${opts.plan.objective}`);

  const boxes = model.nodes.slice(0, BRIEF_FACT_LIMITS.boxes);
  if (model.nodes.length > boxes.length) leftOut.push(`${model.nodes.length - boxes.length} boxes past the first ${boxes.length}`);
  L.push("", "BOXES (cite by id; what each does is the code's own reading, In → Process → Out):");
  for (const n of boxes) {
    const io = ioLines(nodeIO(model, n.id, vocab));
    const text = `"${n.label}" (${n.kind}${n.category ? `, ${n.category}` : ""}): ${n.sublabel} | in: ${io.in} | process: ${io.process} | out: ${io.out}`;
    // the hash rests on what the box DOES, not its label: ratifying a name (or
    // reading the map with the stated layer on it) stales nothing
    cite(n.id, `${n.kind} | in: ${io.in} | process: ${io.process} | out: ${io.out}`);
    L.push(`- ${n.id}: ${text}`);
  }
  const edges = model.edges.slice(0, BRIEF_FACT_LIMITS.edges);
  if (model.edges.length > edges.length) leftOut.push(`${model.edges.length - edges.length} edges past the first ${edges.length}`);
  L.push("", "EDGES (cite by id):");
  for (const e of edges) {
    const text = `${e.from} → ${e.to} · ${e.kind} ${e.protocol ?? ""} — ${e.protocolBasis ?? ""}`.slice(0, 260);
    L.push(`- ${cite(e.id, text)}: ${text}`);
  }

  const groups = (model.groups ?? []).filter((g) => g.source === "stated" || g.source === "proposed").map((g) => ({ id: g.id, label: g.label, members: g.wraps }));
  if (groups.length) {
    L.push("", "GROUPS NOW (keep, rename, add or move members — a group is not evidence; a LABEL STALE line is a fact a rename may cite):");
    const stale = new Map((opts.staleLabels ?? []).map((s) => [s.group, s.why]));
    for (const g of groups) {
      const why = stale.get(g.id);
      L.push(`- ${g.id} "${g.label}": ${g.members.join(", ")}${why ? `\n  ${cite(`label:${g.id}`, why)}: LABEL STALE — the label ${why}` : ""}`);
    }
  }

  const rules = (opts.constraints ?? []).slice(0, BRIEF_FACT_LIMITS.rules);
  if (rules.length) {
    L.push("", "STATED RULES (cite as rule:<id>):");
    for (const c of rules) L.push(`- ${cite(`rule:${c.id}`, `${c.text}\n${opts.ruleCode?.(c) ?? ""}`)}: ${c.text.slice(0, 300)}`);
  }

  const t = opts.topology;
  if (t && ((t.stores ?? []).length || (t.stateMachines ?? []).length || (t.decisionTrees ?? []).length)) {
    L.push("", "DECLARED TOPOLOGY (the project's own declarations):");
    for (const st of t.stores ?? []) {
      const zs = (t.zones ?? []).filter((z) => z.store === st.id);
      const text = `store ${st.id}${st.kind ? ` (${st.kind})` : ""}: ${zs.length} zones (${zs.slice(0, 12).map((z) => z.id).join(", ")}${zs.length > 12 ? ", …" : ""}); ${(t.principals ?? []).length} principals; ${(t.grants ?? []).filter((g) => (t.zones ?? []).some((z) => z.id === g.zone && z.store === st.id)).length} grants`;
      L.push(`- ${cite(`topology:store:${st.id}`, text)}: ${text}`);
    }
    for (const sm of t.stateMachines ?? []) {
      const text = `state machine ${sm.id}: ${sm.transitions.slice(0, 10).map((x) => `${x.from}→${x.to}${x.roles?.length ? ` by ${x.roles.join("/")}` : ""}`).join(", ")}${sm.transitions.length > 10 ? ", …" : ""}`;
      L.push(`- ${cite(`topology:sm:${sm.id}`, text)}: ${text}`);
    }
    for (const d of t.decisionTrees ?? []) {
      const text = `decision tree ${d.id}: ${d.nodes.filter((x) => x.question).slice(0, 6).map((x) => x.question).join(" / ")}`;
      L.push(`- ${cite(`topology:dt:${d.id}`, text)}: ${text}`);
    }
  }

  const planItems = planCitations(opts.plan);
  if (planItems.size) {
    L.push("", "THE PLAN (cite as plan:<section>:<id>):");
    for (const [id, text] of planItems) L.push(`- ${cite(id, text)}: ${text}`);
  }

  for (const s of (opts.specs ?? []).filter((x) => x.status === "ratified")) {
    L.push("", `SOFTWARE SPEC ${s.tool} (ratified):`);
    L.push(`- ${cite(`spec:${s.tool}:definition`, s.definition)}: ${s.definition}`);
    for (const o of s.operations.slice(0, BRIEF_FACT_LIMITS.specOps)) {
      const text = `${o.does}${o.on ? ` ${o.on}` : ""}${o.note ? ` — ${o.note}` : ""}`;
      L.push(`- ${cite(`spec:${s.tool}:op:${o.name}`, text)}: ${text}`);
    }
    for (const r of (s.rules ?? []).filter((x) => x.core).slice(0, 6)) L.push(`- ${cite(`spec:${s.tool}:rule:${r.id}`, r.text)}: ${r.text}`);
  }

  const docs = docExcerpts(opts.root, model, BRIEF_FACT_LIMITS.docs);
  if (docs.length) {
    L.push("", "THE PROJECT'S DOCS (cite as file:line):");
    for (const d of docs) L.push(`- ${cite(`${d.file}:${d.line}`, d.text)}: ${d.text}`);
  }

  const allSilent = silentBoxes(model, vocab);
  const silent = opts.silentOnly ? allSilent.filter((id) => opts.silentOnly!.includes(id)) : allSilent.slice(0, BRIEF_FACT_LIMITS.silentPerCall);
  const silentRest = allSilent.filter((id) => !silent.includes(id));
  if (silent.length) {
    L.push("", "SILENT BOXES — the code says little about what these do; scope them (cite the code lines):");
    for (const id of silent) {
      const d = scopeDossier(model, id, { readLines: opts.readLines, specs: opts.specs, vocab });
      if (!d) continue;
      // the dossier minus its list of other boxes (already listed above)
      const body = d.text.split("\nOTHER BOXES")[0];
      for (const line of body.split("\n")) {
        const m = /^([^\s:]+:\d+): (.*)$/.exec(line);
        if (m) cites.set(m[1], m[2]);
      }
      for (const c of d.cites) if (!cites.has(c)) cites.set(c, c);
      L.push(body, "");
    }
  }
  if (silentRest.length) leftOut.push(`${silentRest.length} silent box(es) not scoped in this call (${silentRest.slice(0, 6).join(", ")}${silentRest.length > 6 ? ", …" : ""}) — \`brief codebase --only scopes\` runs them in batches`);

  const text = L.join("\n");
  return { text, cites, boxes: new Set(model.nodes.map((n) => n.id)), entries: new Set(model.nodes.flatMap((n) => n.entryPoints ?? [])), boxEntries: new Map(model.nodes.filter((n) => n.entryPoints?.length).map((n) => [n.id, n.entryPoints!])), groups, silent, silentRest, estimate: Math.ceil(text.length / 4), leftOut };
}
