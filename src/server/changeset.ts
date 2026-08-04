// PLAN-v7 Stage 4 — changeset validation (the pure half).
//
// A changeset is a build increment proposed as one reviewable unit (see
// protocol.ts Changeset). This module owns the boundary SHAPE checks —
// pure, unit-testable without a server. The server owns everything that
// spawns (dry-run create_file, sandbox parse+link, effect scan, check run)
// and the two guards that need server state: project-root containment and
// files-must-not-exist.
//
// 4a shipped CREATE-only; 6c adds MIXED create+edit (op per file, a
// deliberate chokepoint-CLI subset — see ChangesetOp). Paths are
// project-relative .py files with no traversal; the RESERVED check-module
// name can't be a changeset file (it would collide in the sandbox).

import { createHash } from "crypto";
import type { Changeset, ChangesetOp } from "../shared/protocol";

// The ops a changeset may carry (6c). Everything else in the chokepoint CLI
// stays out until a concrete consumer needs it (no-new-abstraction rule).
export const CHANGESET_OPS: ReadonlyArray<ChangesetOp> = ["create_file", "append_end", "replace_node"];

// The sandbox check module's reserved name. The check MUST define
// __vg_check__() inside it (validated structurally after the sandbox parse).
export const CHECK_MODULE = "__vg_check__.py";
export const CHECK_FN_ID = "module/__vg_check__.fn";

// Validate an untrusted value as a Changeset. Returns null when valid, else
// a human-readable reason (surfaced verbatim as the honest decline).
export function validateChangeset(x: unknown): string | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return "changeset must be an object";
  const c = x as Record<string, unknown>;
  if (typeof c.label !== "string" || c.label.trim().length === 0) {
    return "changeset.label must be a non-empty string";
  }
  if (!Array.isArray(c.files) || c.files.length === 0) {
    return "changeset.files must be a non-empty array";
  }
  const seen = new Set<string>();
  for (const [i, raw] of (c.files as unknown[]).entries()) {
    if (typeof raw !== "object" || raw === null) return `files[${i}]: must be an object`;
    const f = raw as Record<string, unknown>;
    if (typeof f.path !== "string" || f.path.length === 0) return `files[${i}]: path must be a non-empty string`;
    const pathErr = validateRelativePyPath(f.path);
    if (pathErr) return `files[${i}]: ${pathErr}`;
    if (f.path === CHECK_MODULE) return `files[${i}]: ${CHECK_MODULE} is reserved for the behavioural check`;
    if (seen.has(f.path)) return `files[${i}]: duplicate path "${f.path}"`;
    seen.add(f.path);
    if (typeof f.content !== "string" || f.content.trim().length === 0) {
      return `files[${i}]: content must be non-empty (empty modules are refused — the M10R lineage)`;
    }
    // 6c — op discipline: whitelist + nodeId pairing. Absent op = create_file.
    if (f.op !== undefined) {
      if (typeof f.op !== "string" || !CHANGESET_OPS.includes(f.op as ChangesetOp)) {
        return `files[${i}]: unknown op "${String(f.op)}" (allowed: ${CHANGESET_OPS.join(", ")})`;
      }
    }
    const op = (f.op ?? "create_file") as ChangesetOp;
    if (op === "replace_node") {
      if (typeof f.nodeId !== "string" || f.nodeId.trim().length === 0) {
        return `files[${i}]: replace_node requires a structural nodeId`;
      }
    } else if (f.nodeId !== undefined) {
      return `files[${i}]: nodeId is only valid with replace_node (got op "${op}")`;
    }
  }
  const check = c.check as Record<string, unknown> | null;
  if (typeof check !== "object" || check === null) return "changeset.check is required (the behavioural floor is not optional)";
  if (typeof check.module !== "string" || check.module.trim().length === 0) {
    return "check.module must be a non-empty python module defining __vg_check__()";
  }
  if (!/(^|\n)\s*def __vg_check__\s*\(/.test(check.module)) {
    return "check.module must define __vg_check__() (textual pre-check; the sandbox parse verifies structurally)";
  }
  if (typeof check.description !== "string" || check.description.trim().length === 0) {
    return "check.description must say what passing proves";
  }
  if (c.drafted !== undefined && typeof c.drafted !== "boolean") return "changeset.drafted must be a boolean when present";
  return null;
}

// PLAN-v7 6b — the consent SCOPE for an effectful behavioural check: the
// "nodeId" half of the SM3 effect-consent token (effect_consent.ts), which
// binds a token to ONE consented thing + ONE offense set. For run-to-node
// that thing is a structural node id; for a changeset it is the changeset
// CONTENT — files + check module — hashed, so editing any file or the check
// between consent and re-propose changes the scope and the stale token is
// rejected (the user re-consents to what actually runs). Pure + deterministic.
export function changesetConsentScope(cs: Changeset): string {
  const canonical = JSON.stringify({
    // 6c: op + nodeId are part of the consented ACTION — the same content
    // as a create vs a replace is a different thing to authorize.
    files: cs.files.map((f) => ({ path: f.path, content: f.content, op: f.op ?? "create_file", nodeId: f.nodeId ?? null })),
    check: cs.check.module,
  });
  return `changeset:${createHash("sha256").update(canonical).digest("hex")}`;
}

// Project-relative, .py, no traversal / no absolute / no scheme tricks.
// (Root CONTAINMENT after resolution is the server's guard — it knows the
// root; this is the shape half.)
export function validateRelativePyPath(p: string): string | null {
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return `path must be project-relative (got absolute: ${p})`;
  if (!p.endsWith(".py")) return `only .py files can be targeted (got: ${p})`;
  const parts = p.split("/");
  if (parts.some((seg) => seg === "" || seg === "." || seg === "..")) {
    return `path must not contain empty, '.' or '..' segments: ${p}`;
  }
  if (p.includes("\\")) return `use forward slashes: ${p}`;
  return null;
}
