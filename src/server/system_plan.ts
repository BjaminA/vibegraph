// PLAN-v7 Stage 3 — the SystemPlan store: validate / load / persist.
//
// A SystemPlan is a LABELLED PLAN (Claude's or a fixture's architecture
// proposal), NEVER honest IR. It rides the project envelope as a SIBLING of
// the honest `system` tier; the webview composes the two only at render.
// Acceptance persists it to <projectRoot>/.vibegraph/system-plan.json so the
// ratified plan survives reloads and Stage 4's builder agents can consume it.
//
// Validation is hand-rolled (validate-at-boundary hard rule): WS payloads and
// the on-disk file are both untrusted inputs. Mirrors the shape pinned in
// schemas/project_ir.schema.json $defs/SystemPlan — keep the two in sync.
//
// .ts extensions note: the only relative import is `import type` (erased by
// node's type-stripping, so no runtime resolution) — no .ts extension needed.
// Imported by server.ts (esbuild) and run directly by test:system-plan.

import * as fs from "fs";
import * as path from "path";
import type { SystemPlan, PlannedSubsystem, PlannedSystemEdge, SubsystemKind } from "../shared/protocol";

const SUBSYSTEM_KINDS: SubsystemKind[] = [
  "frontend", "backend", "db", "cache", "external_http", "library",
];

export const PLAN_RELPATH = path.join(".vibegraph", "system-plan.json");

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

// Load a previously-ratified plan from <root>/.vibegraph/system-plan.json.
// Missing file → null (no plan). Invalid file → null + warn (an on-disk plan
// that fails validation is IGNORED, never half-loaded — the honest choice).
export function loadSystemPlan(root: string): SystemPlan | null {
  const file = path.join(root, PLAN_RELPATH);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return null; // no plan persisted
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    console.warn(`  [SystemPlan] ${file} is not valid JSON — ignoring: ${err.message}`);
    return null;
  }
  const invalid = validateSystemPlan(parsed);
  if (invalid) {
    console.warn(`  [SystemPlan] ${file} failed validation — ignoring: ${invalid}`);
    return null;
  }
  return parsed as SystemPlan;
}

// Persist a ratified plan. Validates first (never write an invalid artifact),
// stamps ratifiedAt, writes atomically-enough for a single consumer (tmp +
// rename). Returns the stamped plan or an error.
export function persistSystemPlan(
  root: string,
  plan: unknown,
): { plan?: SystemPlan; path?: string; error?: string } {
  const invalid = validateSystemPlan(plan);
  if (invalid) return { error: invalid };
  const stamped: SystemPlan = { ...(plan as SystemPlan), ratifiedAt: new Date().toISOString() };
  const file = path.join(root, PLAN_RELPATH);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stamped, null, 2) + "\n", "utf-8");
    fs.renameSync(tmp, file);
  } catch (err: any) {
    return { error: `could not persist plan: ${err.message}` };
  }
  return { plan: stamped, path: file };
}
