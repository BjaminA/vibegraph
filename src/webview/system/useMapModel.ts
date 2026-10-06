// The architecture map's model for Real / Plan / Overlay at the lens's LEVEL
// (2026-10-06, system views; moved out of SystemView). Real is the derived
// model said in the plan's and the topology's words (arch_real.ts); Overlay
// is that same model with the plan on it, matched by identity (arch_plan.ts);
// every mode is simplified to the level the lens reads as (arch_levels.ts).

import { useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { ArchModelRecord } from "../../shared/protocol";
import type { PlanState } from "../usePlanState";
import type { Topology } from "../../shared/topology_types";
import { enrichReal, type RealFlow } from "./arch_real";
import { atLevel, levelOf } from "./arch_levels";
import { planModel, overlayModel, ghostPlannedEdges, type PlanView } from "./arch_plan";
import { buildArchLayout, ARCH_LENSES, type ArchLens } from "./archLayout";

interface ThreadLike { entryPointId: string | null; nodes: any[] }

export function useMapModel(opts: {
  on: boolean; architecture: ArchModelRecord | null; lens: string; planView: PlanView; planState: PlanState;
  planOpen: ReadonlySet<string>; topology: Topology | null; threads: ThreadLike[];
}) {
  const { on, architecture, lens, planView, planState, planOpen, topology, threads } = opts;
  const { plan, reconcile } = planState;
  const level = levelOf(lens);
  const real = useMemo(() => (on && architecture ? enrichReal(architecture, { plan, rec: reconcile, topology, threads }) : null),
    [on, architecture, plan, reconcile, topology, threads]);
  const planMapModel = useMemo(() => {
    if (!on || planView === "real" || !plan) return null;
    return planView === "plan" || !real
      ? planModel(plan, reconcile, { expanded: planOpen })
      : overlayModel(real, plan, reconcile, { expanded: planOpen });
  }, [on, planView, plan, reconcile, real, planOpen]);
  const drawn = useMemo(() => (planMapModel ? atLevel(planMapModel, level, { plan: planView === "plan" }) : real ? atLevel(real, level) : null),
    [planMapModel, real, level, planView]);
  const flows: RealFlow[] = planView === "plan" ? [] : real?.realFlows ?? [];
  return { real, planMapModel, drawn, level, flows };
}

/** The archLayout lens a map-model lens draws through. */
const asArchLens = (lens: string): ArchLens => (ARCH_LENSES.includes(lens as ArchLens) ? (lens as ArchLens) : "overview");

/** Lay out the drawn model: the Plan view keeps every edge (its own picture);
 *  Real and Overlay go through the lens like the derived map always has. */
export function layoutMap(drawn: ArchModelRecord, lens: string, planView: PlanView): { nodes: Node[]; edges: Edge[]; hiddenTools?: string[]; hiddenClusters?: string[] } {
  if (planView === "plan") {
    const laid = buildArchLayout(drawn, "payloads", { keepPlannedTools: true });
    return { ...laid, edges: ghostPlannedEdges(laid.edges, drawn) };
  }
  const laid = buildArchLayout(drawn, asArchLens(lens), { keepPlannedTools: planView === "overlay" });
  return planView === "overlay" ? { ...laid, edges: ghostPlannedEdges(laid.edges, drawn) } : laid;
}
