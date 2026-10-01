// THE PLAN in the running app (2026-09-30): the WebSocket messages the Plan
// panel sends, and the two MCP tools. Everything here goes through the store,
// the ops and the checker the CLI uses — one set of rules for every door.
//
// Who is who is decided by the DOOR, never by the payload: a WebSocket message
// comes from the person at the Plan panel (human), an MCP call from a model
// (agent). An agent's edits are proposals; agreeing, closing and promoting are
// refused to it.

import type { Plan, PlanReconcile } from "../shared/plan_types.ts";
import type { StackIndex } from "./stack.ts";
import { loadPlan, savePlan, demoteOrphanedPromotions } from "./plan_store.ts";
import { loadConstraints } from "./constraint_store.ts";
import { applyPlanOps, parsePlanOp, type PlanOp } from "./plan_ops.ts";
import { formatPlanMd } from "./plan_render.ts";
import { reconcilePlan } from "./plan_reconcile.ts";
import { promotePolicy } from "./plan_promote.ts";

export interface PlanEnv { files: Record<string, any>; entryPoints: any[]; threads: any[] }
export interface PlanReply { plan: Plan | null; reconcile: PlanReconcile | null; error?: string; message?: string }

function stateOf(root: string, env: PlanEnv | null, stack: StackIndex | null, extra: Partial<PlanReply> = {}): PlanReply {
  // A rule promoted into a constraint that has since gone is demoted first.
  demoteOrphanedPromotions(root, new Set(loadConstraints(root).map((c) => c.id)));
  const plan = loadPlan(root);
  let reconcile: PlanReconcile | null = null;
  if (plan && env && stack) {
    try { reconcile = reconcilePlan(plan, env, stack, root); } catch (e: any) { extra.error ??= `plan vs code failed: ${e.message}`; }
  }
  return { plan, reconcile, ...extra };
}

function applyAndSave(root: string, ops: PlanOp[], by: "human" | "agent"): { error?: string; message?: string } {
  const r = applyPlanOps(loadPlan(root), ops, by);
  if (r.error || !r.plan) return { error: r.error ?? "nothing applied" };
  const saved = savePlan(root, r.plan);
  if (saved.error) return { error: saved.error };
  return { message: `rev ${r.plan.revision}: ${r.changes.join("; ")}` };
}

/** WS: plan-get | plan-op {ops} | plan-promote {id}. The sender is a person. */
export function handlePlanMessage(root: string, msg: { type: string; payload?: any }, env: PlanEnv | null, stack: StackIndex | null): { reply: PlanReply; changed: boolean } {
  if (msg.type === "plan-get") return { reply: stateOf(root, env, stack), changed: false };
  if (msg.type === "plan-op") {
    const raw = Array.isArray(msg.payload?.ops) ? msg.payload.ops : [msg.payload?.op];
    const ops: PlanOp[] = [];
    for (const x of raw) {
      const p = parsePlanOp(x);
      if (!p.ok) return { reply: stateOf(root, env, stack, { error: p.error }), changed: false };
      ops.push(p.op);
    }
    const r = applyAndSave(root, ops, "human");
    return { reply: stateOf(root, env, stack, r), changed: !r.error };
  }
  if (msg.type === "plan-promote") {
    const plan = loadPlan(root);
    if (!plan) return { reply: stateOf(root, env, stack, { error: "no plan" }), changed: false };
    const r = promotePolicy(root, plan, typeof msg.payload?.id === "string" ? msg.payload.id : undefined);
    return { reply: stateOf(root, env, stack, r.error ? { error: r.error } : { message: r.message }), changed: !r.error };
  }
  return { reply: stateOf(root, env, stack, { error: `unknown message ${msg.type}` }), changed: false };
}

/** MCP read: the plan, and how the code measures up. */
export function planToolText(root: string, env: PlanEnv | null, stack: StackIndex | null): string {
  const s = stateOf(root, env, stack);
  if (!s.plan) return "No plan (.vibegraph/plan.json). A person starts one with `vibegraph-knowledge plan init \"<objective>\"`; you may then propose items with vibegraph_plan_edit.";
  return formatPlanMd(s.plan, s.reconcile);
}

/** MCP write: a model's edits — always proposals. */
export function planToolEdit(root: string, rawOps: unknown): { text: string; error?: string } {
  const list = Array.isArray(rawOps) ? rawOps : [rawOps];
  const ops: PlanOp[] = [];
  for (const x of list) {
    const p = parsePlanOp(x);
    if (!p.ok) return { text: "", error: p.error };
    ops.push(p.op);
  }
  const r = applyAndSave(root, ops, "agent");
  return r.error ? { text: "", error: `refused: ${r.error}` } : { text: `${r.message} — recorded as PROPOSED; a person agrees or drops it (the Plan panel, or \`vibegraph-knowledge plan agree\`).` };
}
