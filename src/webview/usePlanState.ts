// The HYPOTHETICAL plan in the webview (2026-09-30): `.vibegraph/plan.json`
// and its plan-vs-code verdicts, as the server sends them (plan-state). Asked
// for on mount and again after every re-derive (project-update), because a
// code change moves the verdicts and a CLI or MCP edit moves the plan.
// The map's Plan / Overlay views and the Plan panel read the same state.

import { useEffect, useState } from "react";
import { bridge, type ExtensionMessage } from "./types";
import type { Plan, PlanReconcile } from "../shared/plan_types";

export interface PlanState { plan: Plan | null; reconcile: PlanReconcile | null; error?: string; message?: string }

export function usePlanState(): PlanState {
  const [state, setState] = useState<PlanState>({ plan: null, reconcile: null });
  useEffect(() => {
    const ask = () => bridge.postMessage({ type: "plan-get" } as never);
    const handler = (msg: ExtensionMessage) => {
      const t = (msg as { type: string }).type;
      if (t === "plan-state") setState((msg as unknown as { payload: PlanState }).payload);
      else if (t === "project-update") ask();
    };
    bridge.onMessage(handler);
    ask();
    return () => bridge.removeListener(handler);
  }, []);
  return state;
}

// ── software specs (2026-09-30): listed, ratified, put into the plan ──

import type { SoftwareSpec } from "../shared/software_types";

export interface SoftwareState { specs: SoftwareSpec[]; error?: string; message?: string }

export function useSoftwareState(): SoftwareState {
  const [state, setState] = useState<SoftwareState>({ specs: [] });
  useEffect(() => {
    const ask = () => bridge.postMessage({ type: "software-list" } as never);
    const handler = (msg: ExtensionMessage) => {
      const t = (msg as { type: string }).type;
      if (t === "software-state") setState((msg as unknown as { payload: SoftwareState }).payload);
      else if (t === "project-update") ask();
    };
    bridge.onMessage(handler);
    ask();
    return () => bridge.removeListener(handler);
  }, []);
  return state;
}

export function sendSoftware(type: "software-ratify" | "software-plan", tool: string): void {
  bridge.postMessage({ type, payload: { tool } } as never);
}

/** A person's edit from the panel: agree, drop, close, reopen, promote. */
export function sendPlanOp(op: Record<string, unknown>): void {
  bridge.postMessage({ type: "plan-op", payload: { ops: [op] } } as never);
}
/** Several ops applied together, or not at all. */
export function sendPlanOps(ops: Array<Record<string, unknown>>): void {
  bridge.postMessage({ type: "plan-op", payload: { ops } } as never);
}
export function promotePlanRule(id: string): void {
  bridge.postMessage({ type: "plan-promote", payload: { id } } as never);
}
