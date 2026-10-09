// THE DECISION INBOX (2026-10-06, direction review M11). Agents propose; a
// person decides — and on a project driven from the terminal the decisions
// piled up where nobody looked: plan proposals, rule changes, a rule an agent
// stated, a scope, a groups proposal, a skill draft, a software spec draft.
// Person-only steps stay person-only (refused under CLAUDECODE); what was
// missing was ONE list that comes back to the person. This is it: the same
// list in the CLI (`inbox`), the GUI and the Stop hook's one line.
//
// Each item has a stable id, says what it would change and its evidence, and
// is decided with `agree` / `reject` through the store's own operation — the
// inbox writes nothing itself. Zero tokens.

import { loadPlan, savePlan } from "./plan_store.ts";
import { applyPlanOps } from "./plan_ops.ts";
import { planBacklog } from "./plan_review.ts";
import { loadConstraints, removeConstraint } from "./constraint_store.ts";
import { decideConstraintProposal, ratifyConstraint } from "./constraint_edit.ts";
import { loadArchStore, saveArchStore, ratifyProposal, rejectProposal, type ArchStore, type ArchBaseline } from "./arch_store.ts";
import { decideScope } from "./node_scope.ts";
import { listStoredThreadSkills, ratifyThreadSkill, rejectDraftThreadSkill } from "./thread_skill_store.ts";
import { listSpecs, removeSpec } from "./software_store.ts";
import { ratifySpec } from "./software_server.ts";
import { PLAN_CAPS, proposedObjectiveText, type PlanReconcile, type PlanSection } from "../shared/plan_types.ts";
import type { ArchModelRecord } from "../shared/protocol.ts";
import { planSensors } from "./plan_sensors.ts";
import { scopesNow } from "./operation_vocab.ts";
import { regroupFromFacts } from "./arch_regroup.ts";
import { loadBrief, sectionSummary, allLines, decideBrief } from "./brief_store.ts";
import { BRIEF_SECTIONS, type BriefSection } from "../shared/brief_types.ts";
import { claimChanges, claimLabel, decideClaim, loadClaims } from "./claim_store.ts";
import { linesReader } from "./node_scope.ts";
import { declaredFeeds } from "./topology_feeds.ts";
import { declaredTopology } from "./arch_label_drift.ts";
import { modelSource } from "./model_source.ts";

export type InboxKind = "plan" | "objective" | "decision" | "sensor" | "rule-change" | "rule" | "scope" | "groups" | "skill" | "spec" | "questions" | "drift" | "brief" | "claim";
export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  /** what it changes, its evidence — one line each */
  detail: string[];
  /** false = information only (decided elsewhere, e.g. questions at the cap) */
  decidable: boolean;
}

const ONE: Record<string, string> = { processes: "process", modules: "module", stores: "store", principals: "principal", stack: "tool", boundaries: "boundary", threads: "thread", flows: "flow", policies: "policy" };
// JSON.stringify(undefined) is undefined: a field a change ADDS has no "from"
const short = (v: unknown) => { const s = JSON.stringify(v) ?? "(none)"; return s.length > 140 ? `${s.slice(0, 139)}…` : s; };

/** `model` (the derived map) turns on the sensors that read it — new
 *  processes and identities, placement, groups and scope drift. */
export function buildInbox(root: string, opts: { rec?: PlanReconcile | null; model?: ArchModelRecord | null; git?: boolean; briefStale?: string[]; briefReview?: string[] } = {}): InboxItem[] {
  const out: InboxItem[] = [];
  const plan = loadPlan(root);
  let constraints: ReturnType<typeof loadConstraints> = [];
  try { constraints = loadConstraints(root); } catch { constraints = []; }
  if (plan) {
    const b = planBacklog(plan, opts.rec ?? null, constraints as never);
    for (const p of b.proposals) out.push({
      id: `plan:${p.section}:${p.id}`, kind: "plan", decidable: true,
      title: `${p.kind === "new" ? "new" : "changed"} plan ${ONE[p.section] ?? p.section} ${p.id}`,
      detail: [...(p.kind === "change" ? p.diff.map((d) => `${d.field}: ${short(d.from)} → ${short(d.to)}`) : [short(p.item)]), ...p.evidence.slice(0, 3)],
    });
    for (const q of b.objective) out.push({ id: `objective:${q.id}`, kind: "objective", decidable: true, title: "a proposed objective", detail: [q.text.slice("Proposed objective:".length).trim()] }); // the citation stays visible here
    // the decisions ledger: what a model proposed, with the edits it implies
    for (const d of (plan.decisions ?? []).filter((x) => x.status === "proposed")) out.push({
      id: `decision:${d.id}`, kind: "decision", decidable: true, title: `decision ${d.id}: ${d.said}`,
      detail: [...d.effects.map((e) => `effect: ${short(e)}`), ...(d.from ? [`from ${d.from}`] : []), ...d.evidence.slice(0, 3)],
    });
    // drift sensors (plan_sensors.ts): findings to decide, notes to act on
    const sensed = planSensors(root, plan, { model: opts.model ?? null, rec: opts.rec ?? null, git: opts.git });
    for (const f of sensed.findings) out.push({
      id: `sensor:${f.key}`, kind: "sensor", decidable: true, title: f.said,
      detail: [...f.effects.map((e) => `effect: ${short(e)}`), ...f.evidence.slice(0, 3)],
    });
    for (const n of sensed.notes) out.push({ id: `drift:${n.key}`, kind: "drift", decidable: false, title: n.title, detail: n.detail });
    // M12: groups that drifted can be re-formed from facts, here, for zero tokens
    if (opts.model && sensed.notes.some((n) => n.key === "groups")) {
      const rg = regroupFromFacts(opts.model, loadArchStore(root), { drifted: true });
      if (rg.store) out.push({ id: "regroup", kind: "groups", decidable: true, title: `re-form the groups from facts (zero tokens): ${rg.groups.length} group${rg.groups.length === 1 ? "" : "s"} replace the drifted ones`, detail: rg.groups.slice(0, 6).map((g) => `${g.label} — ${g.wraps.length} box${g.wraps.length === 1 ? "" : "es"}`) });
    }
    const open = plan.open.length;
    if (open >= PLAN_CAPS.open) out.push({ id: "questions:cap", kind: "questions", decidable: false, title: `${open} open questions — at the cap`, detail: ["close the answered ones: `vibegraph-knowledge plan close open <qN> --note …` or the Plan panel"] });
  }
  for (const c of constraints) {
    for (const p of (c.proposals ?? []).filter((x: any) => !x.status || x.status === "open")) {
      out.push({ id: `rule-change:${c.id}:${p.id}`, kind: "rule-change", decidable: true, title: `a change to rule ${c.id}`, detail: [`${p.by ?? "agent"}: ${p.why}`, ...("patch" in p ? [short((p as any).patch)] : [])] });
    }
    if (c.source !== "human") out.push({ id: `rule:${c.id}`, kind: "rule", decidable: true, title: `rule ${c.id}, stated by ${c.source}`, detail: [c.text, ...(c.check ? [`check: ${short(c.check)}`] : [])] });
  }
  const store = loadArchStore(root);
  if (store.proposal) out.push({
    id: "groups", kind: "groups", decidable: true, title: `${store.proposal.mode === "update" ? "an update to" : "proposed"} architecture groups (${store.proposal.model})`,
    detail: [...store.proposal.groups.map((g) => `${g.id} "${g.label}" — ${g.evidence.length ? `cites ${g.evidence.slice(0, 2).join(", ")}` : "INFERRED"}`).slice(0, 6), ...(store.proposal.refused.length ? [`${store.proposal.refused.length} refused by the gate`] : [])],
  });
  if (opts.model) {
    const stale = Object.values(scopesNow(root, opts.model) ?? {}).filter((r) => r.ratified?.stale || r.proposed?.stale).map((r) => r.node);
    if (stale.length) out.push({ id: "drift:scopes", kind: "drift", decidable: false, title: `${stale.length} scope${stale.length === 1 ? " is" : "s are"} STALE — the code under ${stale.length === 1 ? "it" : "them"} changed`, detail: [...stale.slice(0, 6), "re-scope: `vibegraph-knowledge scope <box>` or the inspector's Re-scope"] });
  }
  for (const [node, r] of Object.entries(store.scopes ?? {})) if (r.proposed) out.push({
    id: `scope:${node}`, kind: "scope", decidable: true, title: `a scope of ${node} (${r.proposed.model})`,
    detail: [r.proposed.summary, `words: ${r.proposed.words.map((w) => `${w.word}${w.evidence.length ? "" : " (INFERRED)"}`).join(", ")}`, ...(r.proposed.refused.length ? [`${r.proposed.refused.length} refused by the gate`] : [])].filter(Boolean),
  });
  for (const s of listStoredThreadSkills(root)) if (s.status === "draft") out.push({ id: `skill:${s.entryPointId}`, kind: "skill", decidable: true, title: `a skill draft for ${s.entryPointId}`, detail: [`drafted ${s.generatedAt.slice(0, 10)}`] });
  let specs: ReturnType<typeof listSpecs> = [];
  try { specs = listSpecs(root); } catch { specs = []; }
  for (const s of specs) if (s.status !== "ratified") out.push({ id: `spec:${s.tool}`, kind: "spec", decidable: true, title: `a software spec draft for ${s.tool}`, detail: [s.definition.slice(0, 140), `${s.operations.length} operations · ${s.rules.length} rules`] });
  // 2026-10-08 — the Brief, one item per pending section (brief_store.ts)
  const brief = loadBrief(root);
  if (brief.proposed) {
    for (const s of BRIEF_SECTIONS) {
      const t = sectionSummary(brief.proposed, s);
      if (!t) continue;
      // the spec's review sheet first (B13): what to look at before ratifying
      const lines = s === "spec" ? [...(opts.briefReview ?? []), ...allLines(brief.proposed.spec).slice(0, 4).map((l) => `${l.text}${l.cites.length ? "" : " (INFERRED)"}`)] : [];
      out.push({ id: `brief:${s}`, kind: "brief", decidable: true, title: `Brief (PROPOSED, ${brief.proposed.model}): ${t}`, detail: lines });
    }
  }
  // 2026-10-08 — a feed the project declares, naming code that is gone (topology_feeds.ts)
  if (opts.model) {
    let feeds: ReturnType<typeof declaredFeeds> = [];
    try { feeds = declaredFeeds(declaredTopology(root).topology, opts.model, plan, modelSource(opts.model)?.files ?? null); } catch { feeds = []; }
    for (const f of feeds.filter((x) => x.stale)) out.push({ id: `drift:feed:${f.index}`, kind: "drift", decidable: false, title: `declared feed ${f.index} (${f.process} ${f.op}s ${f.family}) is STALE: ${f.stale}`, detail: ["regenerate the topology (`vibegraph-knowledge topology run`), or fix the declaration in its generator"] });
  }
  // 2026-10-08 — claims about what the code does at run time (claim_store.ts)
  const readLines = linesReader(root);
  for (const k of loadClaims(root).claims) {
    const stale = claimChanges(k, readLines);
    if (k.status === "proposed") out.push({
      id: `claim:${k.id}`, kind: "claim", decidable: true, title: `a claim (${k.by}): ${claimLabel(k)}`,
      detail: [...(k.why ? [k.why] : []), ...k.cites.map((c) => `${c}: ${k.basis[c] ?? ""}`).slice(0, 4), `the map says: ${k.verdict ?? "unverifiable"}${k.verdict === "declared" ? " — the plan declares it, the code does not show it" : ""}`, ...stale.map((s) => `STALE: ${s}`)],
    });
    else if (k.status === "ratified" && stale.length) out.push({ id: `drift:claim:${k.id}`, kind: "drift", decidable: false, title: `ratified claim ${claimLabel(k)} is STALE — a line it cites changed`, detail: [...stale, "propose it again with the lines as they are now, or reject it"] });
  }
  if (opts.briefStale?.length) out.push({ id: "drift:brief", kind: "drift", decidable: false, title: `${opts.briefStale.length} line${opts.briefStale.length === 1 ? " of the ratified Brief is" : "s of the ratified Brief are"} STALE — code they cite changed`, detail: [...opts.briefStale.slice(0, 4), "re-brief only those: `vibegraph-knowledge brief codebase --stale` (a small call)"] });
  return out;
}

export interface DecideOpts { who?: string; now?: Date; archBaseline?: (store: ArchStore) => ArchBaseline | undefined; model?: ArchModelRecord | null; rec?: PlanReconcile | null }

/** A person's decision on one inbox item, through the store's own operation. */
export function decideInbox(root: string, id: string, decision: "agree" | "reject", opts: DecideOpts = {}): { ok: boolean; detail: string } {
  const [kind, ...rest] = id.split(":");
  const arg = rest.join(":");
  const fail = (detail: string) => ({ ok: false, detail });
  const plan = () => loadPlan(root);
  const applyPlan = (ops: any[]) => {
    const r = applyPlanOps(plan(), ops, "human", opts.now ?? new Date());
    if (r.error || !r.plan) return fail(r.error ?? "the plan did not change");
    const saved = savePlan(root, r.plan);
    return saved.error ? fail(saved.error) : { ok: true, detail: r.changes.join("; ") };
  };
  switch (kind) {
    case "plan": {
      const [section, ...ids] = arg.split(":");
      return applyPlan([{ op: decision === "agree" ? "agree" : "reject", section: section as PlanSection, id: ids.join(":") }]);
    }
    case "regroup": {
      if (decision === "reject") return fail("nothing to reject: the drift note stays until the groups match the code (re-form them, or --update with a model)");
      if (!opts.model) return fail("re-forming the groups needs the code's map");
      const rg = regroupFromFacts(opts.model, loadArchStore(root), { drifted: true });
      if (!rg.store) return fail(rg.error ?? "nothing to regroup");
      const ratified = ratifyProposal(rg.store);
      const baseline = opts.archBaseline?.(ratified);
      saveArchStore(root, baseline ? { ...ratified, baseline } : ratified);
      return { ok: true, detail: `groups re-formed from facts: ${rg.groups.map((g) => g.label).join("; ")}` };
    }
    case "decision":
      return applyPlan([{ op: decision === "agree" ? "agree-decision" : "reject-decision", id: arg }]);
    case "sensor": {
      const p = plan();
      if (!p) return fail("there is no plan");
      const f = planSensors(root, p, { model: opts.model ?? null, rec: opts.rec ?? null }).findings.find((x) => x.key === arg);
      if (!f) return fail(`no sensor finding ${arg} now (it may have been decided, or the code moved)`);
      return applyPlan([{ op: "decide", from: f.from, said: f.said, effects: f.effects, evidence: f.evidence, ...(decision === "reject" ? { status: "rejected" } : {}) }]);
    }
    case "objective": {
      const q = plan()?.open.find((x) => x.id === arg);
      if (!q) return fail(`no open question ${arg}`);
      return decision === "agree"
        ? applyPlan([{ op: "set-objective", text: proposedObjectiveText(q.text) }, { op: "close-question", id: arg, note: "adopted as the objective" }])
        : applyPlan([{ op: "drop-question", id: arg, note: "not adopted" }]);
    }
    case "rule-change": {
      const [cid, pid] = arg.split(":");
      const r: any = decideConstraintProposal(root, cid, pid, decision === "agree", { who: opts.who });
      return r?.error ? fail(r.error) : { ok: true, detail: `${decision === "agree" ? "accepted" : "rejected"} ${pid} on ${cid}` };
    }
    case "rule": {
      if (decision === "agree") { const r = ratifyConstraint(root, arg, { who: opts.who }); return r.error ? fail(r.error) : { ok: true, detail: `${arg} is now human-stated` }; }
      return removeConstraint(root, arg) ? { ok: true, detail: `${arg} removed` } : fail(`no rule ${arg}`);
    }
    case "groups": {
      const store = loadArchStore(root);
      if (!store.proposal) return fail("no architecture proposal is pending");
      if (decision === "reject") { saveArchStore(root, rejectProposal(store)); return { ok: true, detail: "the groups proposal is dropped" }; }
      const next = ratifyProposal(store);
      const baseline = opts.archBaseline?.(next);
      if (baseline) next.baseline = baseline;
      saveArchStore(root, next);
      return { ok: true, detail: `ratified the groups from ${store.proposal.model}` };
    }
    case "scope": {
      const store = loadArchStore(root);
      const r = decideScope(store.scopes ?? {}, arg, decision === "agree" ? "ratify" : "reject", opts.now);
      if (r.error) return fail(r.error);
      store.scopes = r.scopes;
      if (!Object.keys(store.scopes).length) delete store.scopes;
      saveArchStore(root, store);
      return { ok: true, detail: `${decision === "agree" ? "ratified" : "rejected"} the scope of ${arg}` };
    }
    case "skill":
      if (decision === "agree") return ratifyThreadSkill(root, arg) ? { ok: true, detail: `ratified the skill of ${arg}` } : fail(`no skill for ${arg}`);
      return rejectDraftThreadSkill(root, arg) ? { ok: true, detail: `dropped the draft skill of ${arg}` } : fail(`no draft skill for ${arg}`);
    case "spec": {
      if (decision === "agree") { const r = ratifySpec(root, arg, opts.now ?? new Date()); return r.error ? fail(r.error) : { ok: true, detail: r.message ?? `ratified ${arg}` }; }
      return removeSpec(root, arg) ? { ok: true, detail: `removed the draft spec ${arg}` } : fail(`no spec ${arg}`);
    }
    case "brief": {
      if (!BRIEF_SECTIONS.includes(arg as BriefSection)) return fail(`no brief section ${arg}`);
      return decideBrief(root, arg as BriefSection, decision === "agree" ? "ratify" : "reject", opts.who ?? "a person", opts.now ?? new Date());
    }
    case "claim": return decideClaim(root, arg, decision, opts.who ?? "a person", opts.now ?? new Date());
    case "questions": return fail("open questions are closed one by one: `plan close open <qN> --note …` or the Plan panel");
    default: return fail(`not an inbox item: ${id}`);
  }
}

/** The Stop hook's one line, or null when nothing waits. */
export function inboxLine(items: InboxItem[]): string | null {
  const n = items.filter((i) => i.decidable).length;
  // 2026-10-08 — what the run-time ladder holds that no longer matches the code
  const stale = items.filter((i) => /^drift:(feed|claim):/.test(i.id)).length;
  const staleNote = stale ? ` · ${stale} declaration${stale === 1 ? "" : "s"} or claim${stale === 1 ? "" : "s"} STALE (a line or function they name changed)` : "";
  if (!n) return stale ? `Nothing to decide${staleNote}: \`vibegraph-knowledge inbox\` lists them.` : null;
  const kinds = new Map<string, number>();
  for (const i of items.filter((x) => x.decidable)) kinds.set(i.kind, (kinds.get(i.kind) ?? 0) + 1);
  return `${n} decision${n === 1 ? "" : "s"} await the person (${[...kinds].map(([k, c]) => `${c} ${k}`).join(", ")})${staleNote}: \`vibegraph-knowledge inbox\` in a terminal outside Claude Code, or the Inbox in \`vibegraph-knowledge view\`. Do not decide them yourself — say they are waiting.`;
}
