// Seed `.vibegraph/architecture.json` from the PLAN (2026-10-01): the plan
// already says which processes the project has and which services it talks
// to, so a person need not restate that as hosts and trust zones by hand.
//
// It is a PROPOSAL, never a statement: written to the store's pending
// `proposal` (model label "plan rev N"), ratified or rejected by a person
// with the same Ratify / Reject as a model's draft, and gated by the same
// `proposalGate` (a pending draft is not replaced; ratified groups need
// --force). Zero tokens — every group is read off the plan and plan-check.
//
// What it can wrap is only what the derived map DRAWS (a group wraps real box
// ids): a planned process the code has realised, placed on its real cluster
// by `realisedTargets` (the map's own function, so the seed and the map
// agree); a planned tool the code uses. What is not built has nothing to wrap
// yet, and is listed as refused with that reason rather than invented.
//
//   process   one per placed process: wraps its real cluster.
//   trust     "<project>" around the process groups, and "Outside the
//             project" around the real boxes of the services the plan names
//             (tools with an outside role, processes of kind db / cache /
//             external_http) — only when both sides have members, since one
//             zone alone draws no boundary to cross.

import type { ArchModelRecord } from "../shared/protocol.ts";
import type { Plan, PlanReconcile } from "../shared/plan_types.ts";
import { realisedTargets } from "../webview/system/arch_plan.ts";
import { proposalGate, type ArchStore, type ProposedGroup } from "./arch_store.ts";

const OUTSIDE_ROLES = new Set(["db", "cache", "queue", "model-api", "http-client", "cloud", "platform"]);
const OUTSIDE_KINDS = new Set(["db", "cache", "external_http"]);
const gid = (s: string) => `plan-${s}`.replace(/[^\w.:-]/g, "-").slice(0, 80);

export function seedArchFromPlan(plan: Plan, rec: PlanReconcile, derived: ArchModelRecord, store: ArchStore, opts: { force?: boolean; project?: string } = {}):
  { store?: ArchStore; error?: string; lines: string[] } {
  const gate = proposalGate(store, { force: opts.force });
  if (!gate.allowed) return { error: gate.reason, lines: [] };
  const targets = realisedTargets(plan, rec, derived);
  const groups: ProposedGroup[] = [];
  const refused: Array<{ item: string; reason: string }> = [];
  const inside: string[] = [];
  const outside: Array<{ box: string; why: string }> = [];
  const verdictOf = (section: string, id: string) => rec.findings.find((f) => f.section === section && f.id === id);

  for (const p of plan.processes.filter((x) => x.status !== "dropped")) {
    const box = targets.get(`processes:${p.id}`);
    const v = verdictOf("processes", p.id);
    if (!box) {
      refused.push({ item: `process ${p.id}`, reason: v?.verdict === "realised" ? "realised, but no entry point places it on a box of the map" : `${v?.verdict ?? "not checked"} — nothing in the code to wrap yet` });
      continue;
    }
    if (OUTSIDE_KINDS.has(p.kind)) { outside.push({ box, why: `plan process ${p.id} is a ${p.kind}` }); continue; }
    const g: ProposedGroup = { id: gid(p.id), kind: "process", label: p.label.slice(0, 80), wraps: [box], evidence: [`plan rev ${plan.revision}: process ${p.id} (${p.kind}) — plan check: ${v?.verdict}: ${v?.detail ?? ""}`.slice(0, 240)] };
    groups.push(g);
    inside.push(g.id);
  }
  for (const t of plan.stack.filter((x) => x.status !== "dropped")) {
    if (!OUTSIDE_ROLES.has(t.role)) continue;
    const box = targets.get(`stack:${t.tool}`);
    if (!box) { refused.push({ item: `tool ${t.tool}`, reason: `${verdictOf("stack", t.tool)?.verdict ?? "not checked"} — the code does not use it yet, so the map has no box for it` }); continue; }
    outside.push({ box, why: `plan tool ${t.tool} has the outside role ${t.role}` });
  }
  if (inside.length && outside.length) {
    groups.push({ id: gid("trust-project"), kind: "trust", label: (opts.project ?? "This project").slice(0, 80), wraps: inside, evidence: [`plan rev ${plan.revision}: the planned processes realised in the code`] });
    groups.push({ id: gid("trust-outside"), kind: "trust", label: "Outside the project", wraps: [...new Set(outside.map((o) => o.box))], evidence: outside.map((o) => o.why).slice(0, 12) });
  } else if (outside.length || inside.length) {
    refused.push({ item: "trust zones", reason: `one side is empty (${inside.length} inside, ${outside.length} outside) — a single zone draws no boundary to cross` });
  }
  if (!groups.length) return { error: `nothing to seed: ${refused.map((r) => `${r.item} (${r.reason})`).join("; ") || "the plan has no processes or outside tools"}`, lines: [] };

  const next: ArchStore = {
    ...store,
    proposal: {
      at: new Date().toISOString(), model: `plan rev ${plan.revision}`, groups, names: {}, refused,
      narrative: `Seeded from the plan (revision ${plan.revision}), no model: ${groups.length} group(s) read off its processes and the services it names. Ratify to make them stated.`,
    },
  };
  const lines = [
    `seeded from the plan (rev ${plan.revision}), PENDING in .vibegraph/architecture.json — no model, no tokens:`,
    ...groups.map((g) => `  group ${g.id} (${g.kind}) "${g.label}" wraps ${g.wraps.join(", ")}`),
    ...refused.map((r) => `  not seeded — ${r.item}: ${r.reason}`),
    "decide it: --ratify makes it stated, --reject drops it",
  ];
  return { store: next, lines };
}
