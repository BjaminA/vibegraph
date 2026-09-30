// The architecture map's PLAN views (2026-09-30): the hypothetical project
// drawn with the real map's own boxes and router, as GHOSTS — `source:
// "planned"`, dashed, chipped "planned". GUI only, like the Configuration and
// Journeys lenses: the model is built here from `.vibegraph/plan.json` (served
// with its plan-vs-code verdicts by plan-state) and drawn through the Tools
// lens's layout.
//
//   Plan     — the plan alone: planned processes, planned tools, boundaries.
//   Overlay  — the real map, plus the planned items the code does not have
//              yet (not built / drifted / unanchored). A planned item that is
//              realised is not drawn twice: the real box already stands for it.

import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord } from "../../shared/protocol";
import type { ArchCategory } from "../../shared/arch_protocol";
import type { Plan, PlanReconcile, PlanSection } from "../../shared/plan_types";

export type PlanView = "real" | "plan" | "overlay";
export const PLAN_ID = "plan:";

const PROCESS_CATEGORY: Record<string, ArchCategory> = {
  frontend: "frontend", backend: "backend", db: "database", cache: "cache", external_http: "external", library: "backend",
};
const ROLE_CATEGORY: Record<string, ArchCategory> = {
  db: "database", cache: "cache", queue: "queue", "model-api": "model", "http-client": "external", cloud: "cloud",
  platform: "platform", "web-framework": "backend", frontend: "frontend", "agent-protocol": "agent", data: "pipeline",
};
const EMPTY_UNPLACED: ArchModelRecord["unplaced"] = { tests: 0, unmatchedHops: 0, toolsPresentNotCalled: [], unattributedBoundaries: 0 };

function verdict(rec: PlanReconcile | null, section: PlanSection, id: string) {
  return rec?.findings.find((f) => f.section === section && f.id === id);
}

/** The plan as map records. `onlyUnrealised`: skip what the code already has. */
export function planRecords(plan: Plan, rec: PlanReconcile | null, onlyUnrealised = false): { nodes: ArchNodeRecord[]; edges: ArchEdgeRecord[] } {
  const keep = (section: PlanSection, id: string) => !onlyUnrealised || verdict(rec, section, id)?.verdict !== "realised";
  const status = (s: string) => (s === "agreed" ? "agreed" : "proposed");
  const nodes: ArchNodeRecord[] = [];
  const ids = new Map<string, string>();
  for (const p of plan.processes) {
    if (p.status === "dropped") continue;
    ids.set(p.id, `${PLAN_ID}${p.id}`);
    if (!keep("processes", p.id)) continue;
    const v = verdict(rec, "processes", p.id);
    nodes.push({
      id: `${PLAN_ID}${p.id}`, kind: "cluster", label: p.label, source: "planned",
      sublabel: `planned ${p.kind} · ${status(p.status)}${v ? ` · ${v.verdict}` : ""}${p.at ? ` · ${p.at}` : ""}`,
      category: PROCESS_CATEGORY[p.kind] ?? "unknown", threads: [], refs: [],
      notes: [p.serves ? `serves: ${p.serves}` : "serves: (not said)", ...(v ? [`${v.verdict}: ${v.detail}`] : [])],
    });
  }
  for (const t of plan.stack) {
    if (t.status === "dropped") continue;
    ids.set(t.tool, `${PLAN_ID}tool:${t.tool}`);
    if (!keep("stack", t.tool)) continue;
    const v = verdict(rec, "stack", t.tool);
    nodes.push({
      id: `${PLAN_ID}tool:${t.tool}`, kind: "tool", label: t.tool, tool: t.tool, role: t.role, source: "planned",
      sublabel: `planned ${t.role} · ${status(t.status)}${v ? ` · ${v.verdict}` : ""}`,
      category: ROLE_CATEGORY[t.role] ?? "unknown", threads: [], refs: [],
      notes: [...(t.why ? [`why: ${t.why}`] : []), ...(v ? [`${v.verdict}: ${v.detail}`] : [])],
    });
  }
  const drawn = new Set(nodes.map((n) => n.id));
  const edges: ArchEdgeRecord[] = [];
  for (const b of plan.boundaries) {
    if (b.status === "dropped" || !keep("boundaries", b.id)) continue;
    const from = ids.get(b.from), to = ids.get(b.to);
    // An end the plan does not hold (existing code) or does not draw here has
    // nothing to attach to: the boundary is listed in the Plan panel instead.
    if (!from || !to || !drawn.has(from) || !drawn.has(to)) continue;
    const v = verdict(rec, "boundaries", b.id);
    edges.push({
      id: `${PLAN_ID}${b.id}`, from, to, kind: plan.processes.some((p) => p.id === b.to) ? "http" : "uses",
      protocol: `${b.protocol ?? "planned"}${b.carries?.length ? ` {${b.carries.join(", ")}}` : ""}`,
      protocolBasis: `planned boundary ${b.id} (${status(b.status)})${v ? ` — ${v.verdict}: ${v.detail}` : ""}`,
      count: 1, threads: [], confidence: "path", refs: [], source: "planned",
    });
  }
  return { nodes, edges };
}

export function planModel(plan: Plan, rec: PlanReconcile | null): ArchModelRecord {
  const { nodes, edges } = planRecords(plan, rec);
  return { version: "1", nodes, edges, groups: [], unplaced: EMPTY_UNPLACED, notes: [`the plan, revision ${plan.revision} — hypothetical, not the code`] };
}

/** The real model plus the planned items the code does not have yet. */
export function overlayModel(real: ArchModelRecord, plan: Plan, rec: PlanReconcile | null): ArchModelRecord {
  const extra = planRecords(plan, rec, true);
  return { ...real, nodes: [...real.nodes, ...extra.nodes], edges: [...real.edges, ...extra.edges], notes: [...(real.notes ?? []), `plus ${extra.nodes.length} planned item(s) the code does not have yet (dashed)`] };
}

/** Dashed, quieter edges for the planned ones (the layout styles by kind),
 *  labelled with the planned protocol and keys (the Payloads lens they are
 *  drawn through labels by parsed payload, which a plan does not have). */
export function ghostPlannedEdges<E extends { id: string; style?: any; label?: any; data?: any }>(edges: E[], model: ArchModelRecord): E[] {
  const proto = new Map(model.edges.filter((e) => e.id.startsWith(PLAN_ID)).map((e) => [e.id, e.protocol]));
  return edges.map((e) => {
    if (!e.id.startsWith(PLAN_ID)) return e;
    // The protocol on the line (the router sized the label spot for a short
    // text); the keys it carries on hover.
    const full = proto.get(e.id) ?? String(e.label ?? "");
    const label = full.split(" {")[0];
    return { ...e, label, data: { ...e.data, fullLabel: full }, style: { ...e.style, strokeDasharray: "6 4", opacity: 0.75 } };
  });
}
