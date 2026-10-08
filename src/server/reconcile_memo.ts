// One plan-vs-code reconcile per state, not per message (2026-10-08). An Agree
// in the Inbox reconciled the plan four times — before the decision, after
// it, and again for each panel that asks for fresh state on the broadcast —
// at ~400 ms each on a 116-file repository, so a click took 1.5 s. The result
// depends on the plan, the parsed code (the threads and the stack index, both
// replaced on every derive) and the stated files reconcile reads; the key is
// exactly those, so a cached answer is never one a fresh run would not give.

import * as fs from "fs";
import * as path from "path";
import type { Plan, PlanReconcile } from "../shared/plan_types.ts";
import type { StackIndex } from "./stack.ts";
import { reconcilePlan } from "./plan_reconcile.ts";

type Env = Parameters<typeof reconcilePlan>[1];

/** The stated files a reconcile reads, by modification time. */
const STATED = ["constraints.json", "architecture.json", "topology", "software", "operations.json", "docs.json"];

function statedKey(root: string): string {
  const at = (p: string) => { try { return String(fs.statSync(p).mtimeMs); } catch { return "-"; } };
  return STATED.map((f) => {
    const p = path.join(root, ".vibegraph", f);
    // a directory's own time does not move when a file inside it is edited
    let inside: string[] = [];
    try { if (fs.statSync(p).isDirectory()) inside = fs.readdirSync(p).sort().map((x) => `${x}@${at(path.join(p, x))}`); } catch { inside = []; }
    return `${at(p)}${inside.length ? `[${inside.join(",")}]` : ""}`;
  }).join("|");
}

let memo: { root: string; plan: string; stated: string; threads: unknown; stack: unknown; rec: PlanReconcile } | null = null;

export function reconcilePlanMemo(plan: Plan, env: Env, stack: StackIndex, root: string): PlanReconcile {
  const key = { root, plan: JSON.stringify(plan), stated: statedKey(root), threads: (env as { threads?: unknown }).threads, stack };
  if (memo && memo.root === key.root && memo.plan === key.plan && memo.stated === key.stated && memo.threads === key.threads && memo.stack === key.stack) return memo.rec;
  const rec = reconcilePlan(plan, env, stack, root);
  memo = { ...key, rec };
  return rec;
}
