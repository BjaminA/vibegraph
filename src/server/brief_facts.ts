// B0 — THE FACTS A BRIEF IS WRITTEN FROM (2026-10-08). Zero tokens. Everything
// the model is shown, and ONLY what it is shown can be cited: each citable item
// has an id, the canonical content its hash is taken from, and a ROLE.
//
//   project     the plan's objective                         plan:objective      declare
//   boxes       every box, In/Process/Out                     <box id>            use | verify
//   edges       every edge                                    <edge id>           use | verify
//   data        each zone: partitions, grants, who writes / reads / watches it
//   processes   each process's PRIMARY operations, apart from its secondary ones
//   groups      the groups now: a STATED group (a person's)   group:<g>           declare
//               is citable; a proposed one is not; stale      label:<g> (stale)   declare
//   tools       what each tool box IS (the vendor's docs,     tool-def:<package>  declare
//               kept in the stack taxonomy's TOOL_NOTES)
//   rules       the stated constraints                        rule:<id>           declare
//   applied     where rules are applied (guarded functions,   <file>:<line>       enforce
//               declared grants, grant / admin calls)
//   salient     the mechanisms that matter most               <file>:<line>       use
//   topology    stores, state machines, decision trees        topology:…          declare
//   plan        processes / modules / stores / flows          plan:…              declare
//   specs       ratified software specs                       spec:…              declare
//   docs        the project's own doc lines, ranked           <file>:<line>       doc
//   silent      boxes the code says little about + their code <file>:<line>       use | verify
//   notes       the person's corrections (brief again)        note:<n>            note
//
// B7 — a citation's hash is taken from exactly what it cites: a rule's text,
// check and scope (never its notes, verdict or history); a source line and its
// neighbours; an edge's ends and operation (not the line numbers in its
// basis). A rule's GUARDED CODE is hashed apart (`code`), so the card can say
// "the rule changed" and "the code it guards changed" as two things. `legacy`
// holds how 0.29.0 hashed each item, so a brief ratified then is not marked
// stale by the upgrade. And every `file:line` the printed facts mention is
// citable: the prompt and the allow-list come from one source.

import { createHash } from "node:crypto";
import * as path from "node:path";
import type { ArchModelRecord } from "../shared/protocol.ts";
import type { Plan } from "../shared/plan_types.ts";
import type { Topology } from "../shared/topology_types.ts";
import type { SoftwareSpec } from "../shared/software_types.ts";
import type { SdkCall } from "../shared/data_arch_types.ts";
import type { EvidenceRole } from "../shared/brief_types.ts";
import type { Constraint } from "./constraint_store.ts";
import type { ModelSource } from "./model_source.ts";
import { nodeIO, ioLines, CORE_VOCABULARY, type Vocabulary } from "../shared/node_io.ts";
import { scopeDossier } from "./node_scope.ts";
import { planCitations } from "./arch_propose.ts";
import { briefData, zoneLine, isVerifyFile, verifyEdge, type BriefData, type FeedDecl } from "./brief_data.ts";
import { toolNote } from "../shared/stack_taxonomy.ts";
import { briefDocs, humanRules, salientFiles, type RuleSite, type SalientFile } from "./brief_salience.ts";

export const BRIEF_FACT_LIMITS = { boxes: 80, edges: 160, docs: 40, silentPerCall: 6, specOps: 12, rules: 30, enforce: 24, salient: 5 };

/** What a rule's check guards: the code (hashed apart) and where it is. */
export interface RuleCode { code: string; legacy: string; names: string[]; sites: RuleSite[] }

export interface BriefFacts {
  text: string;
  /** citable id → the canonical content its hash is taken from */
  cites: Map<string, string>;
  /** citable id → what the evidence IS (B8) */
  roles: Map<string, EvidenceRole>;
  /** rule citation → the hash of the code its check guards, and the functions */
  code: Map<string, { hash: string; names: string[] }>;
  /** citable id → how 0.29.0 hashed it (a record written then is checked against these) */
  legacy: Map<string, string[]>;
  boxes: Set<string>;
  labels: Map<string, string>;
  /** entry point ids (a start-here step may name one) */
  entries: Set<string>;
  /** box id → the entry points it runs */
  boxEntries: Map<string, string[]>;
  groups: Array<{ id: string; label: string; members: string[] }>;
  data: BriefData;
  rules: Array<{ id: string; text: string; human: boolean }>;
  salient: SalientFile[];
  notes: string[];
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

/** A rule's canonical content: what it says and how it is checked, nothing else. */
export const ruleBasis = (c: Pick<Constraint, "text" | "check" | "checks" | "scope">) =>
  `${c.text}\n${JSON.stringify(c.check ?? null)}\n${JSON.stringify(c.checks ?? null)}\n${JSON.stringify(c.scope ?? null)}`;

const FILE_LINE = /([\w@][\w@./-]*\.(?:tsx?|mjs|cjs|jsx?|py|sh|rs|cpp|cc|hpp|h|json|md|ya?ml|toml)):(\d+)\b/g;
const FILE_AT_LINE = /([\w@][\w@./-]*\.(?:tsx?|mjs|cjs|jsx?|py|sh|rs|cpp|cc|hpp|h)):[^()\n]{0,120}?\bat line (\d+)/g;

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
  /** what each rule's check guards (brief_inputs.ts reads it from the IR) */
  ruleCode?: (c: Constraint) => RuleCode | null;
  /** the parsed code behind the model (threads, for salience) */
  source?: ModelSource | null;
  /** grant / admin calls the code makes (where an access rule is applied) */
  grantCalls?: SdkCall[];
  /** doc paths a project leaves out of the brief */
  docExclude?: string[];
  /** the person's corrections, for "brief again with notes" */
  notes?: string[];
  /** person-ratified claims whose lines still hold (claim_store.ts) */
  claims?: Array<{ id: string; subject: string; verb: string; object: string }>;
  /** what the project's topology declares a process reaches at run time (topology_feeds.ts) */
  feeds?: FeedDecl[];
}): BriefFacts {
  const vocab = opts.vocab ?? CORE_VOCABULARY;
  const cites = new Map<string, string>();
  const roles = new Map<string, EvidenceRole>();
  const legacy = new Map<string, string[]>();
  const code = new Map<string, { hash: string; names: string[] }>();
  const L: string[] = [];
  const leftOut: string[] = [];
  const cite = (id: string, basis: string, role: EvidenceRole, old?: string[]) => {
    cites.set(id, basis); if (!roles.has(id)) roles.set(id, role); if (old?.length) legacy.set(id, old); return id;
  };
  const tag = (r: EvidenceRole) => (r === "verify" || r === "enforce" ? ` [${r}]` : "");
  // a source line with its neighbours: what `file:line` cites
  const window = (file: string, line: number, fallback: string) => {
    const lines = opts.readLines(file);
    if (!lines || line < 1 || line > lines.length) return fallback;
    return lines.slice(Math.max(0, line - 2), line + 1).join("\n");
  };
  const fileRole = (file: string): EvidenceRole => (isVerifyFile(file) ? "verify" : "use");
  const labels = new Map(model.nodes.map((n) => [n.id, n.label]));
  const data = briefData(model, { plan: opts.plan, topology: opts.topology, claims: opts.claims, feeds: opts.feeds });
  for (const f of opts.feeds ?? []) cites.set(f.cite, `feed ${f.process} ${f.op} ${f.family}`), roles.set(f.cite, "declare");
  for (const k of opts.claims ?? []) cites.set(`claim:${k.id}`, `${k.subject} ${k.verb} ${k.object}`), roles.set(`claim:${k.id}`, "declare");

  L.push(`PROJECT ${path.basename(opts.root)}`);
  if (opts.plan?.objective) L.push(`- ${cite("plan:objective", opts.plan.objective, "declare")}: ${opts.plan.objective}`);

  const boxes = model.nodes.slice(0, BRIEF_FACT_LIMITS.boxes);
  if (model.nodes.length > boxes.length) leftOut.push(`${model.nodes.length - boxes.length} boxes past the first ${boxes.length}`);
  L.push("", "BOXES (cite by id; what each does is the code's own reading, In → Process → Out; [verify] = it only tests or demonstrates):");
  for (const n of boxes) {
    const io = ioLines(nodeIO(model, n.id, vocab));
    const role: EvidenceRole = data.verifyBoxes.has(n.id) ? "verify" : n.id.startsWith("zone:") ? "declare" : "use";
    // the hash rests on what the box DOES, not its label: a name stales nothing
    const basis = `${n.kind} | in: ${io.in} | process: ${io.process} | out: ${io.out}`;
    cite(n.id, basis, role, [basis]);
    L.push(`- ${n.id}${tag(role)}: "${n.label}" (${n.kind}${n.category ? `, ${n.category}` : ""}): ${n.sublabel} | in: ${io.in} | process: ${io.process} | out: ${io.out}`);
  }
  const edges = model.edges.slice(0, BRIEF_FACT_LIMITS.edges);
  if (model.edges.length > edges.length) leftOut.push(`${model.edges.length - edges.length} edges past the first ${edges.length}`);
  L.push("", "EDGES (cite by id; [verify] = a refused attempt or a test's call):");
  for (const e of edges) {
    const text = `${e.from} → ${e.to} · ${e.kind} ${e.protocol ?? ""}${e.details?.length ? ` (${e.details.slice(0, 6).join(", ")})` : ""} — ${e.protocolBasis ?? ""}`.slice(0, 260);
    const role: EvidenceRole = verifyEdge(e, data.verifyBoxes) ? "verify" : "use";
    cite(e.id, `${e.from}→${e.to}|${e.kind}|${e.protocol ?? ""}`, role, [text]);
    L.push(`- ${e.id}${tag(role)}: ${text}`);
  }

  if (data.zones.size) {
    L.push("", "DATA — each zone, who the code shows writing / watching / reading it, and how it is PARTITIONED (a claim about a zone is checked against this):");
    for (const z of data.zones.values()) L.push(`- ${z.id}: ${zoneLine(z, data, labels)}`);
  }
  if (data.processes.length) {
    L.push("", "PROCESSES — each one's PRIMARY operation (its main job) and its secondary ones; a line about a process states the primary, never a secondary one as its main job:");
    const op = (o: { op: string; zone: string; source: string }) => `${o.op} ${o.zone.slice("zone:".length)}${o.source === "declared" ? " (declared)" : ""}`;
    for (const p of data.processes) L.push(`- ${p.box} "${p.label}": primary ${p.primary.map(op).join(", ")} (from ${p.why})${p.secondary.length ? `; secondary ${p.secondary.map(op).join(", ")}` : ""}`);
  }

  // What each tool box IS, from the vendor's docs (the stack taxonomy's
  // TOOL_NOTES): a box says what the code does with a tool, never what the
  // tool is — without this a brief can only call a platform "one client".
  const defs = boxes.filter((n) => n.id.startsWith("tool:")).map((n) => ({ n, def: toolNote(n.id.slice("tool:".length)) })).filter((x) => x.def);
  if (defs.length) {
    L.push("", "WHAT THE TOOLS ARE (from the vendors' docs, kept in VibeGraph's tool table; cite as tool-def:<package> beside the box — a definition says what a tool CAN do, the box's edges say what this code does with it):");
    for (const { n, def } of defs) L.push(`- ${cite(`tool-def:${n.id.slice("tool:".length)}`, def!, "declare", [def!])} (${n.id}): ${def}`);
  }

  // 2026-10-09 — a STATED group is a person's statement (ratified, or written
  // in architecture.json): a line may cite it for WHERE something runs and what
  // trust zone it sits in. A proposed group is still only a suggestion.
  const groups = (model.groups ?? []).filter((g) => g.source === "stated" || g.source === "proposed").map((g) => ({ id: g.id, label: g.label, members: g.wraps, stated: g.source === "stated", kind: g.kind }));
  if (groups.length) {
    L.push("", "GROUPS NOW (a STATED group is a person's statement — cite it as group:<id> for where a box runs or which trust zone it is in, never as a mechanism; a proposed group is not evidence; a LABEL STALE line is a fact a rename may cite):");
    const stale = new Map((opts.staleLabels ?? []).map((s) => [s.group, s.why]));
    for (const g of groups) {
      const why = stale.get(g.id);
      const head = g.stated && !why ? `${cite(`group:${g.id}`, `${g.kind ?? "group"} ${g.label}: ${g.members.join(", ")}`, "declare")} [stated${g.kind ? ` ${g.kind}` : ""}]` : g.stated ? g.id : `${g.id} [proposed]`;
      L.push(`- ${head} "${g.label}": ${g.members.join(", ")}${why ? `\n  ${cite(`label:${g.id}`, why, "declare", [why])}: LABEL STALE — the label ${why}` : ""}`);
    }
  }

  const rules = (opts.constraints ?? []).slice(0, BRIEF_FACT_LIMITS.rules);
  const sites = new Map<string, RuleSite[]>();
  if (rules.length) {
    L.push("", "STATED RULES (cite as rule:<id>; [human] = a person stated it — every one must be covered by a line or named in omitted):");
    for (const c of rules) {
      const rc = opts.ruleCode?.(c) ?? null;
      const id = `rule:${c.id}`;
      cite(id, ruleBasis(c), "declare", [`${c.text}\n${rc?.legacy ?? ""}`, `${c.text}\n`]);
      if (rc?.code) code.set(id, { hash: hash16(rc.code), names: rc.names });
      if (rc?.sites.length) sites.set(c.id, rc.sites);
      L.push(`- ${id}${c.source === "human" ? " [human]" : ` [${c.source}]`}: ${c.text.slice(0, 300)}`);
    }
  }

  // B8 — where rules are APPLIED: what a mechanism line must cite
  const applied: string[] = [];
  for (const c of rules) for (const s of sites.get(c.id) ?? []) {
    if (isVerifyFile(s.file)) continue;
    applied.push(`- ${cite(`${s.file}:${s.line}`, window(s.file, s.line, s.name), "enforce")} [enforce]: function ${s.name} — where rule ${c.id} is applied`);
  }
  for (const g of opts.topology?.grants ?? []) {
    const m = /^(.+):(\d+)$/.exec(g.cite ?? "");
    if (!m || isVerifyFile(m[1]) || applied.length >= BRIEF_FACT_LIMITS.enforce) continue;
    applied.push(`- ${cite(g.cite!, window(m[1], Number(m[2]), `grant ${g.access} ${g.zone} ${g.who}`), "enforce")} [enforce]: grants ${g.access} on ${g.zone} to ${g.who}`);
  }
  for (const s of opts.grantCalls ?? []) {
    if (isVerifyFile(s.file) || applied.length >= BRIEF_FACT_LIMITS.enforce) continue;
    applied.push(`- ${cite(`${s.file}:${s.line}`, window(s.file, s.line, s.callee), "enforce")} [enforce]: ${s.callee} (${s.effect}) — the code applying access`);
  }
  if (applied.length) L.push("", "WHERE RULES ARE APPLIED (enforce evidence — what a mechanism line cites; a test that a rule holds is [verify], never the mechanism):", ...[...new Set(applied)].slice(0, BRIEF_FACT_LIMITS.enforce));

  const salient = salientFiles(opts.source ?? null, rules, sites, BRIEF_FACT_LIMITS.salient);
  if (salient.length) {
    L.push("", "SALIENT MECHANISMS (ranked from the facts — the brief must cover each: cite one of its lines, or a rule that names it):");
    for (const s of salient) {
      const at = s.sites.map((x) => cite(`${x.file}:${x.line}`, window(x.file, x.line, x.name), roles.get(`${x.file}:${x.line}`) ?? "use")).join(", ");
      L.push(`- ${s.file} — ${s.why}${at ? `; at ${at} (${s.sites.map((x) => x.name).join(", ")})` : ""}`);
    }
  }

  const t = opts.topology;
  if (t && ((t.stores ?? []).length || (t.stateMachines ?? []).length || (t.decisionTrees ?? []).length)) {
    L.push("", "DECLARED TOPOLOGY (the project's own declarations):");
    for (const st of t.stores ?? []) {
      const zs = (t.zones ?? []).filter((z) => z.store === st.id);
      const text = `store ${st.id}${st.kind ? ` (${st.kind})` : ""}: ${zs.length} zones (${zs.slice(0, 12).map((z) => z.id).join(", ")}${zs.length > 12 ? ", …" : ""}); ${(t.principals ?? []).length} principals; ${(t.grants ?? []).filter((g) => (t.zones ?? []).some((z) => z.id === g.zone && z.store === st.id)).length} grants`;
      L.push(`- ${cite(`topology:store:${st.id}`, text, "declare", [text])}: ${text}`);
    }
    for (const sm of t.stateMachines ?? []) {
      const text = `state machine ${sm.id}: ${sm.transitions.slice(0, 10).map((x) => `${x.from}→${x.to}${x.roles?.length ? ` by ${x.roles.join("/")}` : ""}`).join(", ")}${sm.transitions.length > 10 ? ", …" : ""}`;
      L.push(`- ${cite(`topology:sm:${sm.id}`, text, "declare", [text])}: ${text}`);
    }
    for (const d of t.decisionTrees ?? []) {
      const text = `decision tree ${d.id}: ${d.nodes.filter((x) => x.question).slice(0, 6).map((x) => x.question).join(" / ")}`;
      L.push(`- ${cite(`topology:dt:${d.id}`, text, "declare", [text])}: ${text}`);
    }
  }

  const planItems = planCitations(opts.plan);
  for (const f of opts.plan?.flows ?? []) if (f.status !== "dropped") planItems.set(`plan:flows:${f.id}`, `flow ${f.id}: ${f.steps.map((s) => `${s.process} ${s.op} ${s.zone}`).join(" → ")} (${f.status})`);
  if (planItems.size) {
    L.push("", "THE PLAN (cite as plan:<section>:<id>):");
    for (const [id, text] of planItems) L.push(`- ${cite(id, text, "declare", [text])}: ${text}`);
  }

  for (const s of (opts.specs ?? []).filter((x) => x.status === "ratified")) {
    L.push("", `SOFTWARE SPEC ${s.tool} (ratified):`);
    L.push(`- ${cite(`spec:${s.tool}:definition`, s.definition, "declare", [s.definition])}: ${s.definition}`);
    for (const o of s.operations.slice(0, BRIEF_FACT_LIMITS.specOps)) {
      const text = `${o.does}${o.on ? ` ${o.on}` : ""}${o.note ? ` — ${o.note}` : ""}`;
      L.push(`- ${cite(`spec:${s.tool}:op:${o.name}`, text, "declare", [text])}: ${text}`);
    }
    for (const r of (s.rules ?? []).filter((x) => x.core).slice(0, 6)) L.push(`- ${cite(`spec:${s.tool}:rule:${r.id}`, r.text, "declare", [r.text])}: ${r.text}`);
  }

  const docs = briefDocs(opts.root, model, rules, opts.plan, { exclude: opts.docExclude, max: BRIEF_FACT_LIMITS.docs });
  if (docs.length) {
    L.push("", "THE PROJECT'S DOCS (ranked by how much they talk about this code; cite as file:line):");
    for (const d of docs) L.push(`- ${cite(`${d.file}:${d.line}`, window(d.file, d.line, d.text), "doc", [d.text])}: ${d.text}`);
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
        const m = /^([^\s:]+):(\d+): (.*)$/.exec(line);
        if (m && !cites.has(`${m[1]}:${m[2]}`)) cite(`${m[1]}:${m[2]}`, window(m[1], Number(m[2]), m[3]), fileRole(m[1]), [m[3]]);
      }
      for (const c of d.cites) if (!cites.has(c)) cite(c, c, "use", [c]);
      L.push(body, "");
    }
  }
  if (silentRest.length) leftOut.push(`${silentRest.length} silent box(es) not scoped in this call (${silentRest.slice(0, 6).join(", ")}${silentRest.length > 6 ? ", …" : ""}) — \`brief codebase --only scopes\` runs them in batches`);

  const notes = (opts.notes ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 12);
  if (notes.length) {
    L.push("", "NOTES FROM THE PERSON (stated input — reconcile EACH one: a line that follows it cites note:<n>, or `omitted` says why not):");
    notes.forEach((n, i) => L.push(`- ${cite(`note:${i + 1}`, n, "note")}: ${n}`));
  }

  // one source for the prompt and the allow-list: every file:line the facts print is citable
  const text = L.join("\n");
  for (const re of [FILE_LINE, FILE_AT_LINE]) {
    for (const m of text.matchAll(re)) {
      const id = `${m[1]}:${m[2]}`;
      if (cites.has(id) || !opts.readLines(m[1])) continue;
      cite(id, window(m[1], Number(m[2]), id), fileRole(m[1]));
    }
  }
  const humans = new Set(humanRules(rules).map((c) => c.id));
  return {
    text, cites, roles, code, legacy, labels, data, salient, notes,
    rules: rules.map((c) => ({ id: c.id, text: c.text, human: humans.has(c.id) })),
    boxes: new Set(model.nodes.map((n) => n.id)), entries: new Set(model.nodes.flatMap((n) => n.entryPoints ?? [])),
    boxEntries: new Map(model.nodes.filter((n) => n.entryPoints?.length).map((n) => [n.id, n.entryPoints!])),
    groups, silent, silentRest, estimate: Math.ceil(text.length / 4), leftOut,
  };
}
