// PLAN-v7 Stage 3 — the SystemPlan store: validate / load / persist.
//
// A SystemPlan is a LABELLED PLAN (Claude's or a fixture's architecture
// proposal), NEVER honest IR. It rides the project envelope as a SIBLING of
// the honest `system` tier; the webview composes the two only at render.
// Acceptance persists it to <projectRoot>/.vibegraph/plan.json (it was system-plan.json) so the
// ratified plan survives reloads and Stage 4's builder agents can consume it.
//
// Validation is hand-rolled (validate-at-boundary hard rule): WS payloads and
// the on-disk file are both untrusted inputs. Mirrors the shape pinned in
// schemas/project_ir.schema.json $defs/SystemPlan — keep the two in sync.
//
// .ts extensions note: the only relative import is `import type` (erased by
// node's type-stripping, so no runtime resolution) — no .ts extension needed.
// Imported by server.ts (esbuild) and run directly by test:system-plan.

import * as path from "path";
import type { SystemPlan, PlannedSubsystem, PlannedSystemEdge, SubsystemKind } from "../shared/protocol";
import { loadPlan, savePlan, toSystemPlan, fromSystemPlan, PLAN_FILE } from "./plan_store.ts";

const SUBSYSTEM_KINDS: SubsystemKind[] = [
  "frontend", "backend", "db", "cache", "external_http", "library",
];

// The file the architecture plan lives in (plan.json since 2026-09-30).
export const PLAN_RELPATH = PLAN_FILE;

// Validate an untrusted value as a SystemPlan. Returns null when valid, else
// a human-readable reason (the honest decline surfaces it verbatim).
export function validateSystemPlan(x: unknown): string | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return "plan must be an object";
  const p = x as Record<string, unknown>;
  if (p.version !== "1") return `unknown plan version: ${String(p.version)}`;
  if (typeof p.description !== "string" || p.description.trim().length === 0) {
    return "plan.description must be a non-empty string (the plan must trace to the user's words)";
  }
  if (typeof p.drafted !== "boolean") return "plan.drafted must be a boolean";
  if (p.ratifiedAt !== undefined && typeof p.ratifiedAt !== "string") {
    return "plan.ratifiedAt must be a string when present";
  }
  if (!Array.isArray(p.subsystems)) return "plan.subsystems must be an array";
  if (!Array.isArray(p.edges)) return "plan.edges must be an array";

  const ids = new Set<string>();
  for (const [i, raw] of (p.subsystems as unknown[]).entries()) {
    const err = validatePlannedSubsystem(raw);
    if (err) return `subsystems[${i}]: ${err}`;
    const s = raw as PlannedSubsystem;
    if (ids.has(s.id)) return `subsystems[${i}]: duplicate id "${s.id}"`;
    ids.add(s.id);
  }
  for (const [i, raw] of (p.edges as unknown[]).entries()) {
    const err = validatePlannedEdge(raw);
    if (err) return `edges[${i}]: ${err}`;
    // Edge endpoints may name a PLANNED subsystem or an already-honest one
    // (the plan can connect to reality). We can only structurally require
    // that at least the ids are non-empty strings; existence against the
    // honest tier is a render-time concern, not a validity one.
  }
  return null;
}

function validatePlannedSubsystem(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return "must be an object";
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== "string" || s.id.length === 0) return "id must be a non-empty string";
  if (!SUBSYSTEM_KINDS.includes(s.kind as SubsystemKind)) {
    return `kind must be one of ${SUBSYSTEM_KINDS.join("|")} (got ${String(s.kind)})`;
  }
  if (typeof s.label !== "string" || s.label.length === 0) return "label must be a non-empty string";
  if (s.groundedIn !== null && typeof s.groundedIn !== "string") {
    return "groundedIn must be a string (quote from the description) or null (inferred)";
  }
  return null;
}

function validatePlannedEdge(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return "must be an object";
  const e = raw as Record<string, unknown>;
  if (typeof e.from !== "string" || e.from.length === 0) return "from must be a non-empty string";
  if (typeof e.to !== "string" || e.to.length === 0) return "to must be a non-empty string";
  if (e.groundedIn !== null && typeof e.groundedIn !== "string") {
    return "groundedIn must be a string or null (inferred)";
  }
  return null;
}

// 2026-09-30 — the SystemPlan now LIVES in .vibegraph/plan.json (the plan
// mode's file, plan_store.ts): its subsystems are the plan's processes and its
// edges the plan's process→process boundaries. These two functions keep the
// greenfield flow's API unchanged over that file; an old system-plan.json is
// read and converted, and removed on the next save.
export function loadSystemPlan(root: string): SystemPlan | null {
  return toSystemPlan(loadPlan(root));
}

// Persist a ratified plan: validate, stamp ratifiedAt, fold it into plan.json
// (keeping the plan's threads, stack, rules and questions), one revision.
export function persistSystemPlan(
  root: string,
  plan: unknown,
): { plan?: SystemPlan; path?: string; error?: string } {
  const invalid = validateSystemPlan(plan);
  if (invalid) return { error: invalid };
  const stamped: SystemPlan = { ...(plan as SystemPlan), ratifiedAt: new Date().toISOString() };
  const merged = fromSystemPlan(stamped, loadPlan(root));
  merged.revision += 1;
  merged.changelog = [...merged.changelog, {
    rev: merged.revision, at: stamped.ratifiedAt!, by: "human" as const,
    change: `accepted the architecture (${stamped.subsystems.length} subsystems, ${stamped.edges.length} edges)`,
  }].slice(-30);
  const saved = savePlan(root, merged);
  if (saved.error) return { error: saved.error };
  return { plan: stamped, path: saved.path };
}
