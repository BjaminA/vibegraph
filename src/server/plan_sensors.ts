// DRIFT SENSORS (2026-10-06, direction review M9). Deterministic, zero
// tokens, and they WRITE NOTHING: each reads the plan, the code's map and the
// project's own records, and says what a decision would be — a finding with
// its evidence and the plan edits it implies. The inbox lists them; a person
// agreeing one records it in the decisions ledger (plan_decisions.ts) and its
// edits apply; rejecting one records that too, so it does not come back.
//
//   contradicted   a question an item ASSUMES says it is not needed
//                  ("Likely not needed: …") → supersede the item
//   answered       an open question whose text begins ANSWERED → record the
//                  decision (agreeing closes the question)
//   new-process    a running process (arch_model `runtime`) no planned
//                  process names → add it, with its entry point
//   new-identity   a process that creates its own identity per run, which no
//                  planned principal stands for → add the principal
//   located        a planned process placed by `at` only, while a running
//                  process named like it runs elsewhere → set its entryPoints
//   unbuilt        an item not built 30+ revisions after it was planned, while
//                  half the processes are → supersede, or keep (reject)
//   outside        a commit message or a doc line that records a decision
//                  ("decided", "user decision", "answers q11") → a decision
//
// And information that waits on a person's next step (never decided here):
// groups drifted from the code, a stale declared topology, stale scopes.

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { ArchModelRecord } from "../shared/protocol.ts";
import type { Plan, PlanReconcile } from "../shared/plan_types.ts";
import { PLAN_SECTIONS, planItemId, sectionItems, looksAnswered } from "../shared/plan_types.ts";
import { loadArchStore, applyArchStore } from "./arch_store.ts";
import { archDrift } from "./arch_drift.ts";
import { readInfraManifests } from "./infra_manifests.ts";
import { loadSources, sourceStatus } from "./topology_store.ts";

export interface SensorFinding {
  key: string;
  kind: "contradicted" | "answered" | "new-process" | "new-identity" | "located" | "unbuilt" | "outside";
  said: string;
  /** where the decision comes from, as the ledger records it */
  from: string;
  effects: Array<Record<string, unknown>>;
  evidence: string[];
}
export interface SensorNote { key: string; kind: "groups" | "topology" | "scopes"; title: string; detail: string[] }

const NOT_NEEDED = /\b(likely not needed|not needed|unnecessary|not required|no longer needed|will not be built|won't be built|out of scope|superseded)\b/i;
// no trailing \b: "decision:" ends on a colon, and a boundary after it needs a word character
const DECIDED = /\b(?:user decision|we decided|decided:|decision:|answers? q\d+\b|q\d+ (?:is )?answered)/i;
const UNBUILT_AFTER = 30;
const OUTSIDE_CAP = 8;
const clip = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const slug = (s: string) => s.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "process";
const fileOf = (ep: string) => ep.replace(/:[^:]*$/, "");

export function planSensors(root: string, plan: Plan, opts: { model?: ArchModelRecord | null; rec?: PlanReconcile | null; git?: boolean; docs?: boolean } = {}): { findings: SensorFinding[]; notes: SensorNote[] } {
  const findings: SensorFinding[] = [];
  const notes: SensorNote[] = [];
  const seen = new Set((plan.decisions ?? []).map((d) => d.from).filter(Boolean));
  const add = (f: SensorFinding) => { if (!seen.has(f.from) && !findings.some((x) => x.from === f.from)) findings.push(f); };
  const questions = [...plan.open.map((q) => ({ ...q, state: "open" as const })), ...(plan.resolved ?? [])];

  // contradicted: an item rests on a question that says it is not needed
  for (const q of questions) {
    const said = `${q.text} ${"note" in q && q.note ? q.note : ""}`;
    if (!NOT_NEEDED.test(said)) continue;
    for (const section of PLAN_SECTIONS) for (const it of sectionItems(plan, section) as any[]) {
      if (it.status === "dropped" || !(it.assumes ?? []).includes(q.id)) continue;
      const id = planItemId(section, it);
      add({ key: `contradicted:${section}:${id}`, kind: "contradicted", from: `sensor:contradicted:${section}:${id}`,
        said: clip(`supersede ${section} ${id}: it assumes ${q.id}, which says it is not needed`),
        effects: [{ op: "supersede", section, id, why: clip(`${q.id}: ${q.text}`, 600) }],
        evidence: [`${q.id} (${"state" in q ? q.state : "open"}): ${clip(q.text, 240)}`, `${section} ${id} assumes ${q.id}`] });
    }
  }
  // answered: an open question that carries its answer
  for (const q of plan.open) {
    if (looksAnswered(q) !== "answered") continue;
    add({ key: `answered:${q.id}`, kind: "answered", from: `open:${q.id}`,
      said: clip(q.text.replace(/^answered\b[^:]*:\s*/i, "").trim() || q.text),
      effects: [], evidence: [`${q.id}: ${clip(q.text, 240)}`, "agreeing records the decision and closes the question; add the plan edits it implies to it first if any (plan edit decide …)"] });
  }
  // the code's map: running processes, identities, placement
  const model = opts.model;
  if (model) {
    const procs = plan.processes.filter((p) => p.status !== "dropped");
    const covers = (p: (typeof procs)[number], file: string) =>
      (p.entryPoints ?? []).some((e) => e === file || fileOf(e) === file) || (!!p.at && (file === p.at.replace(/\/$/, "") || file.startsWith(p.at.replace(/\/?$/, "/"))));
    for (const n of model.nodes.filter((x) => x.kind === "cluster" && x.runtime && x.entryPoints?.length)) {
      const ep = n.entryPoints![0], file = fileOf(ep);
      const base = file.split("/").pop()!.replace(/\.[^.]+$/, "");
      // located: a planned process named like this one, placed elsewhere by `at`
      const named = procs.find((p) => !(p.entryPoints ?? []).length && p.at && !covers(p, file) && (slug(p.id) === slug(base) || slug(p.label ?? "") === slug(base)));
      if (named) {
        add({ key: `located:${named.id}`, kind: "located", from: `sensor:located:${named.id}`,
          said: clip(`${named.id} is planned at ${named.at}, but the code runs it from ${file}: anchor it there`),
          effects: [{ op: "update", section: "processes", id: named.id, fields: { entryPoints: [ep] } }],
          evidence: [`plan: ${named.id} at ${named.at}, no entryPoints`, `code: ${file} ${n.runtime!.how.join(", ")}${n.runtime!.by?.length ? ` (started by ${n.runtime!.by.join(", ")})` : ""}`] });
      } else if (!procs.some((p) => covers(p, file))) {
        add({ key: `new-process:${file}`, kind: "new-process", from: `sensor:new-process:${file}`,
          said: clip(`the code runs a process the plan does not name: ${file}`),
          effects: [{ op: "add", section: "processes", item: { id: slug(base), kind: "backend", label: base, serves: "found running in the code — say what it serves", at: file, entryPoints: [ep] } }],
          evidence: [`${file} ${n.runtime!.how.join(", ")}${n.runtime!.by?.length ? ` (started by ${n.runtime!.by.join(", ")})` : ""}`] });
      }
      const created = n.identity?.find((i) => i.kind === "created");
      const pid = `${slug(base)}-run`;
      if (created && !(plan.principals ?? []).some((p) => p.id === pid && p.status !== "dropped")) {
        add({ key: `new-identity:${file}`, kind: "new-identity", from: `sensor:new-identity:${file}`,
          said: clip(`${file} runs as its own identity, created for each run — the plan has no principal for it`),
          effects: [{ op: "add", section: "principals", item: { id: pid, kind: "service", label: `own identity per run of ${base}` } }],
          evidence: [created.evidence] });
      }
    }
  }
  // unbuilt for long, while the rest is built
  if (opts.rec) {
    const firstRev = (id: string) => plan.changelog.find((c) => c.change.includes(` ${id}`))?.rev ?? plan.revision;
    const procFindings = opts.rec.findings.filter((f) => f.section === "processes");
    const built = procFindings.filter((f) => f.verdict === "realised").length;
    if (procFindings.length && built * 2 >= procFindings.length) {
      for (const f of opts.rec.findings.filter((x) => x.verdict === "not-built")) {
        if (plan.revision - firstRev(f.id) < UNBUILT_AFTER) continue;
        add({ key: `unbuilt:${f.section}:${f.id}`, kind: "unbuilt", from: `sensor:unbuilt:${f.section}:${f.id}`,
          said: clip(`${f.section} ${f.id} is still not built ${plan.revision - firstRev(f.id)} revisions after it was planned, while ${built} of ${procFindings.length} processes are: supersede it, or reject this to keep it`),
          effects: [{ op: "supersede", section: f.section, id: f.id, why: "not built while the rest of the plan was" }],
          evidence: [`plan check: not-built — ${clip(f.detail, 200)}`] });
      }
    }
  }
  // decisions recorded outside the plan: commit messages and the project's docs
  let outside = 0;
  const outsideAdd = (from: string, text: string, where: string) => {
    // "q10 answered" in a commit is the same decision as q10's own answered
    // text: one finding, with the commit as more evidence
    const qs = [...text.matchAll(/\bq(\d+)\b/gi)].map((m) => `q${m[1]}`);
    const same = findings.filter((f) => f.kind === "answered" && qs.includes(f.key.slice("answered:".length)));
    if (same.length) { for (const f of same) if (f.evidence.length < 6) f.evidence.splice(1, 0, `also ${where}: ${clip(text.trim(), 160)}`); return; }
    if (outside >= OUTSIDE_CAP || seen.has(from)) return;
    outside++;
    add({ key: from, kind: "outside", from, said: clip(text.trim()), effects: [], evidence: [where, "a decision recorded outside the plan: agree to record it in the ledger (add the plan edits it implies first, if any)"] });
  };
  if (opts.git !== false) {
    const r = spawnSync("git", ["log", "-n", "60", "--format=%h%x09%s"], { cwd: root, encoding: "utf-8" });
    for (const l of (r.status === 0 ? r.stdout : "").split("\n")) {
      const [sha, subject] = l.split("\t");
      if (sha && subject && DECIDED.test(subject)) outsideAdd(`commit:${sha}`, subject, `commit ${sha}`);
    }
  }
  if (opts.docs !== false) {
    const docs = ["HANDOVER.md", "DECISIONS.md", "docs/decisions.md"].filter((f) => fs.existsSync(path.join(root, f)));
    for (const f of docs) {
      const lines = fs.readFileSync(path.join(root, f), "utf-8").split(/\r?\n/);
      lines.forEach((l, i) => { if (DECIDED.test(l) && l.trim().length > 12) outsideAdd(`doc:${f}:${i + 1}`, l.replace(/^[\s>*#-]+/, ""), `${f}:${i + 1}`); });
    }
  }

  // information: what drifted, waiting on a person's next step
  const store = loadArchStore(root);
  if (model) {
    let facts: ReturnType<typeof readInfraManifests>["facts"] = [];
    try { facts = readInfraManifests(root).facts; } catch { facts = []; }
    const d = archDrift(applyArchStore(model, store), store, facts, plan);
    if (d && d.level === "substantial") notes.push({ key: "groups", kind: "groups", title: `the ratified groups have drifted from the code (since ${d.since})`, detail: [...d.reasons.slice(0, 4), "re-form them: `vibegraph-knowledge architecture --update` (a model extends them) — or the map's Update groups"] });
  }
  for (const s of loadSources(root)) {
    const st = sourceStatus(root, s);
    if (st.state !== "fresh") notes.push({ key: `topology:${s.id}`, kind: "topology", title: `the declared topology ${s.id} is ${st.state}`, detail: [st.detail] });
  }
  return { findings, notes };
}
