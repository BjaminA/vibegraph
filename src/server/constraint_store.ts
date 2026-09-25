// M-CONTRACT.3 (PLAN-M-CONTRACT.md) — STATED constraints: the architecture
// facts no IR can see — which proxy fronts that URL, what schema a payload
// must keep, what a backend call requires, which performance lever to pull
// (batch vs. round-trip) — stated by a HUMAN, by an ORCHESTRATOR brief the
// human confirmed, or by an AGENT over MCP; ROUTED to threads by scope;
// injected with their PROVENANCE on every line.
//
// The IR-derived contract (thread_contract.ts) says what the code DOES; a
// constraint says what it must KEEP doing. The two never blur: a constraint
// is never presented as IR fact, and IR fact never carries a source label.
//
// Store: <analyzedRoot>/.vibegraph/constraints.json (out of the IR, rule
// X5, beside thread-skills). Pure node builtins, validated at the boundary.

import * as fs from "fs";
import * as path from "path";
// Wire shapes live in protocol.ts (the board renders the same record the
// store persists); re-exported here so server code has one import point.
import type {
  ConstraintRecord, ConstraintKind, ConstraintScope, ConstraintSource, StackPolicy,
} from "../shared/protocol.ts";
import { ROLE_LABEL, STACK_ROLES, isSafeToolName, type StackRole } from "../shared/stack_taxonomy.ts";
import { isConstraintCheck, type ConstraintCheck } from "./constraint_grammar.ts";
// Quality layer — the five Run 1 verbs, validated by their own operand checks.
import { isRun1Check, type Run1Check } from "./quality/verbs/index.ts";
export type AnyConstraintCheck = ConstraintCheck | Run1Check;

export type Constraint = ConstraintRecord;
export type { ConstraintKind, ConstraintScope, ConstraintSource, StackPolicy };

export const CONSTRAINTS_FILE = path.join(".vibegraph", "constraints.json");
/** Prompt budget for the routed block — mirrors the skill-injection idea:
 *  a constraint that cannot ride a prompt is named as omitted, never
 *  silently dropped. */
export const CONSTRAINT_BUDGET_CHARS = 6000;

/** Pinned against the protocol union: a kind added there without a
 *  validator entry here is a type error, not a silent pass-through. */
export const CONSTRAINT_KINDS: readonly ConstraintKind[] = [
  "payload-schema", "proxy", "backend-call", "perf-lever", "invariant", "objective",
  // M-STACK.2 — the only kind that carries a structured `policy`.
  "stack-policy",
];

/** M-STACK.2 — the rules a stack policy can state. `replace-with` is the
 *  only one that REQUIRES `with`. */
export const STACK_RULES: readonly StackPolicy["rule"][] = ["require", "prefer", "forbid", "replace-with",
  // M-CMD.3 — a CLASSIFICATION: names the tool's role (required) and
  // decides nothing about its use. What the classify pass writes.
  "describe"];

export interface ConstraintInput {
  kind: ConstraintKind;
  text: string;
  scope: ConstraintScope;
  note?: string;
  policy?: StackPolicy;
  /** M-GRAMMAR — the CHECKABLE half, on ANY kind. `text` stays the sentence
   *  a worker reads; this is what the pre-checks evaluate against the IR. */
  check?: AnyConstraintCheck;
  /** M-SWEEP W6 — several clauses of one constraint, each checkable. */
  checks?: AnyConstraintCheck[];
}

const MAX_TEXT = 1200;

// ── boundary validation (WS payloads / MCP args / orchestrator output land here) ──

export function validateConstraintInput(x: unknown): { ok: true; value: ConstraintInput } | { ok: false; error: string } {
  if (!x || typeof x !== "object") return { ok: false, error: "constraint must be an object" };
  const r = x as Record<string, unknown>;
  if (!CONSTRAINT_KINDS.includes(r.kind as ConstraintKind)) {
    return { ok: false, error: `kind must be one of ${CONSTRAINT_KINDS.join(", ")}` };
  }
  if (typeof r.text !== "string" || !r.text.trim()) return { ok: false, error: "text must be a non-empty string" };
  if (r.text.length > MAX_TEXT) return { ok: false, error: `text over ${MAX_TEXT} chars` };
  const scopeRaw = (r.scope ?? { all: true }) as Record<string, unknown>;
  if (typeof scopeRaw !== "object") return { ok: false, error: "scope must be an object" };
  const scope: ConstraintScope = {};
  if (scopeRaw.all === true) scope.all = true;
  const strList = (v: unknown): string[] | null =>
    Array.isArray(v) && v.every((s) => typeof s === "string" && s.trim()) ? (v as string[]).map((s) => s.trim()) : null;
  if (scopeRaw.entryPointIds !== undefined) {
    const ids = strList(scopeRaw.entryPointIds);
    if (!ids) return { ok: false, error: "scope.entryPointIds must be a list of non-empty strings" };
    if (ids.length) scope.entryPointIds = ids;
  }
  if (scopeRaw.files !== undefined) {
    const files = strList(scopeRaw.files);
    if (!files) return { ok: false, error: "scope.files must be a list of non-empty strings" };
    if (files.length) scope.files = files;
  }
  // M-STACK.2 — scope by TOOL. Names ride prompts and are compared against
  // the stack index, so they take the taxonomy's charset, not free text.
  if (scopeRaw.stack !== undefined) {
    const tools = strList(scopeRaw.stack);
    if (!tools) return { ok: false, error: "scope.stack must be a list of non-empty tool names" };
    const bad = tools.filter((t) => !isSafeToolName(t));
    if (bad.length) return { ok: false, error: `scope.stack has invalid tool name(s): ${bad.join(", ")}` };
    if (tools.length) scope.stack = tools;
  }
  if (!scope.all && !scope.entryPointIds && !scope.files && !scope.stack) {
    return { ok: false, error: "scope must name threads (entryPointIds), files, tools (stack), or all: true" };
  }
  const value: ConstraintInput = { kind: r.kind as ConstraintKind, text: r.text.trim(), scope };
  if (typeof r.note === "string" && r.note.trim()) value.note = r.note.trim().slice(0, 300);

  // M-GRAMMAR — a malformed check is REFUSED at the boundary, never dropped
  // silently and never coerced. Storing a constraint whose check does not
  // parse would leave a rule that LOOKS enforced and is not, which is the
  // exact failure this grammar exists to end.
  if (r.check !== undefined) {
    if (!isConstraintCheck(r.check) && !isRun1Check(r.check)) {
      return {
        ok: false,
        error: "check must be one of: {rule:\"callers-only\", target, files?/functions?}, "
          + "{rule:\"import-only\", tool, files}, {rule:\"calls-through\", target, through}, "
          + "{rule:\"guards\", target, guard}, {rule:\"not-in-loop\", target?/role?, except?}, "
          + "{rule:\"handles-failure\", scope}, {rule:\"annotated\", at}, {rule:\"co-changes\", when, require}",
      };
    }
    value.check = r.check;
  }
  // M-SWEEP W6 — the plural form, validated the same way: one malformed
  // clause refuses the whole constraint rather than silently storing a
  // rule that looks enforced and is not.
  if (r.checks !== undefined) {
    if (!Array.isArray(r.checks) || !r.checks.length) {
      return { ok: false, error: "checks must be a non-empty array of check objects" };
    }
    const bad = r.checks.findIndex((c) => !isConstraintCheck(c) && !isRun1Check(c));
    if (bad >= 0) {
      return { ok: false, error: `checks[${bad}] is not a valid check (see the check field's shapes)` };
    }
    value.checks = r.checks as AnyConstraintCheck[];
  }

  // M-STACK.2 — the structured policy: what a deterministic check reads,
  // beside the human sentence in `text`. REQUIRED on kind stack-policy
  // (the kind exists for it); ALLOWED on any other kind, because an
  // existing `proxy` constraint stating "HTTP leaves through the wrapper"
  // is the same decision with a different label — the checks read
  // `policy` wherever it appears, so none is ever silently unenforced.
  const policyRaw = r.policy;
  if (r.kind === "stack-policy" && (!policyRaw || typeof policyRaw !== "object")) {
    return { ok: false, error: "kind stack-policy needs a policy { tool, rule, with?, role?, reason? }" };
  }
  if (policyRaw !== undefined) {
    if (!policyRaw || typeof policyRaw !== "object") return { ok: false, error: "policy must be an object" };
    const p = policyRaw as Record<string, unknown>;
    if (!isSafeToolName(p.tool)) return { ok: false, error: "policy.tool must be a tool name" };
    if (!STACK_RULES.includes(p.rule as StackPolicy["rule"])) {
      return { ok: false, error: `policy.rule must be one of ${STACK_RULES.join(", ")}` };
    }
    const policy: StackPolicy = { tool: p.tool as string, rule: p.rule as StackPolicy["rule"] };
    if (p.rule === "replace-with") {
      if (!isSafeToolName(p.with)) return { ok: false, error: "policy.rule replace-with needs `with` (the tool to use instead)" };
      policy.with = p.with as string;
    } else if (isSafeToolName(p.with)) {
      policy.with = p.with as string;
    }
    if (p.role !== undefined) {
      if (!STACK_ROLES.includes(p.role as StackRole)) return { ok: false, error: `policy.role must be one of ${STACK_ROLES.join(", ")}` };
      policy.role = p.role as StackRole;
    }
    // M-CMD.3 — a description without a role classifies nothing, and
    // `unknown` is not a classification.
    if (p.rule === "describe" && (!policy.role || policy.role === "unknown")) {
      return { ok: false, error: "policy.rule describe needs a `role` other than unknown (it classifies the tool)" };
    }
    if (typeof p.reason === "string" && p.reason.trim()) policy.reason = p.reason.trim().slice(0, 300);
    value.policy = policy;
  }
  return { ok: true, value };
}

// ── persistence ──────────────────────────────────────────────────────────

function fileFor(root: string): string {
  return path.join(root, CONSTRAINTS_FILE);
}

export function loadConstraints(root: string): Constraint[] {
  const file = fileFor(root);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as { version?: unknown; constraints?: unknown };
    if (raw.version !== "1" || !Array.isArray(raw.constraints)) return [];
    const out: Constraint[] = [];
    for (const c of raw.constraints as Record<string, unknown>[]) {
      const v = validateConstraintInput(c);
      if (!v.ok || typeof c.id !== "string") continue; // a mangled entry is dropped, never half-loaded
      const source: ConstraintSource = c.source === "orchestrator" || c.source === "agent" ? c.source : "human";
      out.push({ id: c.id, ...v.value, source, createdAt: typeof c.createdAt === "string" ? c.createdAt : "" });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveConstraints(root: string, list: Constraint[]): void {
  const file = fileFor(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: "1", constraints: list }, null, 2) + "\n", "utf-8");
}

function nextId(list: Constraint[]): string {
  let max = 0;
  for (const c of list) {
    const m = /^c(\d+)$/.exec(c.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `c${max + 1}`;
}

export function addConstraint(
  root: string, input: ConstraintInput, source: ConstraintSource, now: () => Date = () => new Date(),
): Constraint {
  const list = loadConstraints(root);
  const c: Constraint = { id: nextId(list), ...input, source, createdAt: now().toISOString() };
  list.push(c);
  saveConstraints(root, list);
  return c;
}

export function removeConstraint(root: string, id: string): boolean {
  const list = loadConstraints(root);
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  saveConstraints(root, next);
  return true;
}

/** H2H #2 finding (2026-09-07): the brief RESTATED the five human
 *  constraints it had been shown as "global constraints", and the
 *  objective gate persisted them again as orchestrator-stated — twelve
 *  entries for five facts, and the human's authoritative copy now had
 *  an unreviewed twin. A duplicate is a constraint whose normalised text
 *  contains, or is contained by, an existing one's. */
export function findDuplicate(list: Constraint[], text: string): Constraint | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
  const candidate = norm(text);
  if (candidate.length < 20) return null;
  for (const c of list) {
    const existing = norm(c.text);
    if (existing.length < 20) continue;
    if (candidate.includes(existing) || existing.includes(candidate)) return c;
  }
  return null;
}

// ── routing ──────────────────────────────────────────────────────────────

export interface RoutableThread {
  entryPointId: string | null;
  filesReached: string[];
  /** M-STACK.2 — the tool names this thread's files use (the stack index's
   *  byThread slice). Absent = no stack index; stack scopes then match
   *  nothing, which is honest: no facts, no routing. */
  stack?: string[];
}

/** Deterministic: a constraint reaches a thread when its scope names the
 *  thread, a file the thread reaches (or a directory prefix of one), a
 *  TOOL the thread's stack uses, or everything. Order preserved
 *  (statement order = priority). */
export function routeConstraints(list: Constraint[], thread: RoutableThread): Constraint[] {
  return list.filter((c) => {
    if (c.scope.all) return true;
    if (thread.entryPointId && c.scope.entryPointIds?.includes(thread.entryPointId)) return true;
    for (const f of c.scope.files ?? []) {
      if (f.endsWith("/") ? thread.filesReached.some((r) => r.startsWith(f)) : thread.filesReached.includes(f)) return true;
    }
    // The dynamic half: a stack scope follows the FACTS, so a file added
    // tomorrow that imports the tool is inside this scope with no edit.
    for (const t of c.scope.stack ?? []) {
      if (thread.stack?.includes(t)) return true;
    }
    return false;
  });
}

const SOURCE_LABEL: Record<ConstraintSource, string> = {
  human: "human-stated — authoritative",
  orchestrator: "orchestrator-stated from the objective the human confirmed — verify against the code before relying on it",
  agent: "agent-stated over MCP — NOT reviewed by a human",
};

/** Render the routed constraints for a prompt, provenance on every line,
 *  under a budget that names what it drops. null when nothing routes. */
/** M-STACK.2 — the policy as an imperative a reader (and a deterministic
 *  check) can act on, ahead of the human sentence. */
export function policySentence(p: StackPolicy): string {
  switch (p.rule) {
    case "require": return `require ${p.tool}`;
    case "prefer": return `prefer ${p.tool}${p.with ? ` over ${p.with}` : ""}`;
    case "forbid": return `forbid ${p.tool}${p.with ? ` in favour of ${p.with}` : ""}`;
    case "replace-with": return `replace ${p.tool} with ${p.with}`;
    case "describe": return `${p.tool} is classified as ${p.role ? ROLE_LABEL[p.role] : "a tool"}`;
  }
}

export function formatConstraintsBlock(routed: Constraint[], budget: number = CONSTRAINT_BUDGET_CHARS): string | null {
  if (routed.length === 0) return null;
  const lines = ["## Constraints for this thread (STATED — not IR fact; the source of each line is named)"];
  let used = lines[0].length;
  let omitted = 0;
  for (const c of routed) {
    // A stack policy leads with its imperative; the human sentence follows.
    const head = c.policy ? `${policySentence(c.policy)} — ` : "";
    const reason = c.policy?.reason ? ` (reason: ${c.policy.reason})` : "";
    const line = `- [${c.kind} · ${SOURCE_LABEL[c.source]}] ${head}${c.text}${reason}${c.note ? ` (${c.note})` : ""}`;
    if (used + line.length > budget) { omitted++; continue; }
    lines.push(line);
    used += line.length + 1;
  }
  if (omitted) lines.push(`- [${omitted} more constraint(s) omitted — over the ${budget}-char budget; read .vibegraph/constraints.json]`);
  return lines.join("\n");
}
