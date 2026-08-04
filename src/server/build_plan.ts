// PLAN-v7 Stage 5 — the BuildPlan store: validate / load / persist / advance.
//
// The roadmap is a LABELLED PLAN (drafted → human-ratified → persisted at
// <projectRoot>/.vibegraph/build-plan.json) AND the orchestrator's durable
// state: per-item status is written back here on every transition, so a run
// survives server restarts and webview reloads — resumable from disk.
//
// Validation is hand-rolled (validate-at-boundary): unique ids, needs[]
// reference declared ids, and the dependency graph is a DAG in declared
// order (an item may only need items that appear BEFORE it — foundation-
// first is structural, not advisory).
//
// Mirrors system_plan.ts; keep in sync with schemas/project_ir.schema.json
// $defs/BuildPlan.

import * as fs from "fs";
import * as path from "path";
import type { BuildPlan, BuildPlanItem, BuildItemStatus } from "../shared/protocol";

const STATUSES: BuildItemStatus[] = ["pending", "drafting", "gated", "built", "failed", "skipped"];

export const BUILD_PLAN_RELPATH = path.join(".vibegraph", "build-plan.json");

export function validateBuildPlan(x: unknown): string | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return "build plan must be an object";
  const p = x as Record<string, unknown>;
  if (p.version !== "1") return `unknown build-plan version: ${String(p.version)}`;
  if (typeof p.description !== "string" || p.description.trim().length === 0) {
    return "buildPlan.description must be a non-empty string";
  }
  if (typeof p.drafted !== "boolean") return "buildPlan.drafted must be a boolean";
  if (p.ratifiedAt !== undefined && typeof p.ratifiedAt !== "string") {
    return "buildPlan.ratifiedAt must be a string when present";
  }
  if (!Array.isArray(p.items) || p.items.length === 0) return "buildPlan.items must be a non-empty array";

  const seen = new Set<string>();
  for (const [i, raw] of (p.items as unknown[]).entries()) {
    if (typeof raw !== "object" || raw === null) return `items[${i}]: must be an object`;
    const it = raw as Record<string, unknown>;
    if (typeof it.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(it.id)) {
      return `items[${i}]: id must be a kebab-case slug (got: ${String(it.id)})`;
    }
    if (seen.has(it.id)) return `items[${i}]: duplicate id "${it.id}"`;
    if (typeof it.capability !== "string" || it.capability.trim().length === 0) {
      return `items[${i}]: capability must be a non-empty string`;
    }
    if (it.groundedIn !== null && typeof it.groundedIn !== "string") {
      return `items[${i}]: groundedIn must be a string or null (inferred)`;
    }
    if (!STATUSES.includes(it.status as BuildItemStatus)) {
      return `items[${i}]: status must be one of ${STATUSES.join("|")}`;
    }
    if (!Array.isArray(it.needs)) return `items[${i}]: needs must be an array of item ids`;
    for (const n of it.needs as unknown[]) {
      if (typeof n !== "string") return `items[${i}]: needs entries must be strings`;
      // Foundation-first is STRUCTURAL: an item may only need items declared
      // before it, which makes the graph a DAG by construction.
      if (!seen.has(n)) return `items[${i}]: needs "${n}" which is not declared earlier (order = build order)`;
    }
    seen.add(it.id);
  }
  return null;
}

export function loadBuildPlan(root: string): BuildPlan | null {
  const file = path.join(root, BUILD_PLAN_RELPATH);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    console.warn(`  [BuildPlan] ${file} is not valid JSON — ignoring: ${err.message}`);
    return null;
  }
  const invalid = validateBuildPlan(parsed);
  if (invalid) {
    console.warn(`  [BuildPlan] ${file} failed validation — ignoring: ${invalid}`);
    return null;
  }
  return parsed as BuildPlan;
}

export function persistBuildPlan(
  root: string,
  plan: unknown,
): { plan?: BuildPlan; path?: string; error?: string } {
  const invalid = validateBuildPlan(plan);
  if (invalid) return { error: invalid };
  const p = plan as BuildPlan;
  const stamped: BuildPlan = p.ratifiedAt ? p : { ...p, ratifiedAt: new Date().toISOString() };
  const file = path.join(root, BUILD_PLAN_RELPATH);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stamped, null, 2) + "\n", "utf-8");
    fs.renameSync(tmp, file);
  } catch (err: any) {
    return { error: `could not persist build plan: ${err.message}` };
  }
  return { plan: stamped, path: file };
}

// Transition one item's status (persisted immediately — the artifact IS the
// run state). Returns the updated plan or an error.
export function setItemStatus(
  root: string,
  plan: BuildPlan,
  itemId: string,
  status: BuildItemStatus,
  failReason?: string,
  failOutput?: string,
): { plan?: BuildPlan; error?: string } {
  const items = plan.items.map((it): BuildPlanItem => {
    if (it.id !== itemId) return it;
    // A stage that is no longer failed must not keep carrying its old
    // failure: the previous merge preserved failReason on success, so a
    // retried-and-built stage stayed marked "check failed (exit 1)" in
    // build-plan.json forever.
    if (status !== "failed" && status !== "skipped") {
      const { failReason: _drop, failOutput: _dropOut, ...rest } = it;
      return { ...rest, status };
    }
    return {
      ...it,
      status,
      ...(failReason !== undefined ? { failReason } : {}),
      ...(failOutput !== undefined ? { failOutput } : {}),
    };
  });
  if (!plan.items.some((it) => it.id === itemId)) return { error: `no such item: ${itemId}` };
  const next: BuildPlan = { ...plan, items };
  const persisted = persistBuildPlan(root, next);
  if (persisted.error) return { error: persisted.error };
  return { plan: persisted.plan };
}

// The next item the run may draft: first in declared order that is pending
// and whose needs are ALL built. Items needing a failed/skipped item are
// BLOCKED (honest: their foundation has a hole) — returned separately so the
// caller can surface why the run cannot continue.
export function nextBuildableItem(plan: BuildPlan): {
  item: BuildPlanItem | null;
  blocked: Array<{ id: string; missing: string[] }>;
} {
  const byId = new Map(plan.items.map((it) => [it.id, it]));
  const blocked: Array<{ id: string; missing: string[] }> = [];
  for (const it of plan.items) {
    if (it.status !== "pending") continue;
    const missing = it.needs.filter((n) => byId.get(n)?.status !== "built");
    if (missing.length === 0) return { item: it, blocked };
    blocked.push({ id: it.id, missing });
  }
  return { item: null, blocked };
}
