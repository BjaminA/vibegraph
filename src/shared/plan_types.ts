// THE PLAN — a hypothetical project, kept apart from the real one
// (2026-09-30, Ben: "planned .json architecture and hypothetical primary node
// threads with hypothetical software stack and data boundaries … treated
// differently to the real as they are more malleable").
//
// A fourth stratum beside DERIVED (read from the code), STATED (a person's
// decision) and PROPOSED (a model's draft): PLANNED — what we intend to build,
// expected to change. It uses the real layer's own vocabulary (subsystem
// kinds, stack roles, the constraint grammar, the thread view's "primary"
// rank) so the same views can draw it ghosted, and it NEVER enters the IR.
//
// Deliberately small: the caps below are enforced by the validator (a plan
// that outgrows them is refused, never trimmed), every process and thread
// says which part of the objective it `serves`, and a thread carries its
// PRIMARY steps only. Webview-safe: types and constants, no I/O.

import type { SubsystemKind, SystemPlan } from "./protocol";
import type { StackRole } from "./stack_taxonomy.ts";

export type PlanStatus = "proposed" | "agreed" | "dropped";
/** A planned rule may also be PROMOTED: copied into constraints.json, where it
 *  is real and may gate. A planned rule never blocks anything by itself. */
export type PlanPolicyStatus = PlanStatus | "promoted";
export type PlanActor = "human" | "agent";

export const PLAN_CAPS = {
  processes: 12,
  boundaries: 16,
  stack: 12,
  threads: 7,
  primarySteps: 8,
  policies: 10,
  open: 10,
  /** one line: labels, `serves`, `why`, a step, a question */
  line: 160,
  objective: 240,
  /** the user's own words, when the plan came from a description */
  description: 4000,
  changelog: 30,
} as const;

export interface PlanProcess {
  id: string;
  kind: SubsystemKind;
  label: string;
  /** which part of the objective this is for; null only on a converted plan */
  serves: string | null;
  /** where its code will live (a path prefix) — what lets the plan be checked */
  at?: string;
  /** a quote from the description it came from (greenfield); null = inferred */
  groundedIn?: string | null;
  status: PlanStatus;
}

export interface PlanBoundary {
  id: string;
  from: string;
  /** a planned process id, or a planned stack tool */
  to: string;
  protocol?: string;
  /** the payload's key NAMES, never values */
  carries?: string[];
  groundedIn?: string | null;
  status: PlanStatus;
}

export interface PlanTool {
  tool: string;
  role: StackRole;
  why?: string;
  /** a verified quote from the documents it came from; null = inferred */
  groundedIn?: string | null;
  status: PlanStatus;
}

export interface PlanThread {
  /** how the entry point will read: "POST /readings", "cli:nightly", a function name */
  id: string;
  entry: string;
  process?: string;
  serves: string;
  /** primary steps only; `b1:insert` names the boundary the step crosses */
  primary: string[];
  groundedIn?: string | null;
  status: PlanStatus;
}

export interface PlanPolicy {
  id: string;
  text: string;
  why: string;
  /** the checkable half, in the constraint grammar (checked as advice only) */
  check?: Record<string, unknown>;
  /** path prefixes it is about; absent = the whole project */
  files?: string[];
  /** a verified quote from the documents it came from; null = inferred */
  groundedIn?: string | null;
  /** the software spec rule it came from ("synapse s1") */
  source?: string;
  status: PlanPolicyStatus;
  /** set when promoted: the constraints.json id it became */
  constraintId?: string;
}

export interface PlanQuestion { id: string; text: string }

export interface PlanChange { rev: number; at: string; by: PlanActor; change: string }

export interface Plan {
  version: "1";
  revision: number;
  objective: string;
  description?: string;
  /** closed: kept on disk, no longer sent to sessions */
  closed?: boolean;
  /** greenfield carry-over: drafted by a model, and when a person ratified it */
  drafted?: boolean;
  ratifiedAt?: string;
  processes: PlanProcess[];
  boundaries: PlanBoundary[];
  stack: PlanTool[];
  threads: PlanThread[];
  policies: PlanPolicy[];
  open: PlanQuestion[];
  changelog: PlanChange[];
}

export type PlanSection = "processes" | "boundaries" | "stack" | "threads" | "policies" | "open";
export const PLAN_SECTIONS: readonly PlanSection[] = ["processes", "boundaries", "stack", "threads", "policies", "open"];

/** The id an item of a section is addressed by. */
export function planItemId(section: PlanSection, item: any): string {
  return section === "stack" ? String(item?.tool ?? "") : String(item?.id ?? "");
}

// ── plan vs code ─────────────────────────────────────────────────────────

export type PlanVerdict =
  | "realised"      // the code has it
  | "drifted"       // the code has something, and it differs — see detail
  | "not-built"     // nothing in the code yet
  | "unanchored"    // the plan gives nothing to look for (add `at`)
  | "unverified"    // both ends exist; the thing between them is not checked
  | "pass" | "violated" | "unverifiable"  // a planned rule's check, as ADVICE
  | "prose";        // a planned rule with no check

export interface PlanFinding {
  section: PlanSection;
  id: string;
  verdict: PlanVerdict;
  detail: string;
  /** a real entry point the planned thread matched, to open it */
  entryPointId?: string;
}

export interface PlanReconcile {
  revision: number;
  findings: PlanFinding[];
  counts: Partial<Record<PlanVerdict, number>>;
  limits: string[];
  /** processes and threads whose `serves` shares no meaningful word with the
   *  objective — a word-match GUESS, said as one, never a verdict */
  offObjective?: Array<{ section: PlanSection; id: string; serves: string }>;
}

export type { SystemPlan };
