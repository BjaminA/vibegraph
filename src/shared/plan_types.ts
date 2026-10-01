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

/** 2026-10-01 — what any plan item may rest on: the open questions it
 *  ASSUMES the answer to, and the evidence someone recorded for it. */
export interface PlanGrounding {
  assumes?: string[];
  evidence?: PlanEvidence[];
  /** 2026-10-01 — set when an AGENT changed an agreed item: the version a
   *  person agreed to, so `plan review` shows the diff and a rejection
   *  restores it. Cleared when a person agrees. */
  agreedAs?: Record<string, unknown>;
}
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
  stores: 8,
  zones: 12,
  principals: 10,
  flows: 6,
  flowSteps: 10,
  modules: 16,
} as const;

/** 2026-10-01 — a CODE UNIT (a package, a folder), apart from the deployable
 *  that runs it: a pure logic library, an app, a tool. */
export const MODULE_KINDS = ["library", "app", "tool"] as const;
export interface PlanModule extends PlanGrounding {
  id: string;
  /** the folder its code lives in */
  at: string;
  kind: typeof MODULE_KINDS[number];
  label?: string;
  status: PlanStatus;
}

/** 2026-10-01 — one step of a planned flow through a store: "the decider
 *  watches docs/requests (request)". */
export interface PlanFlowStep {
  process: string;
  op: "write" | "read" | "watch";
  /** "store/zone" */
  zone: string;
  family?: string;
}

/** 2026-10-01 — processes that coordinate only through shared documents (A
 *  writes a request, B reacts and writes a verdict A watches) have no edge
 *  between them; the flow that defines the system is these ordered steps. */
export interface PlanFlow extends PlanGrounding {
  id: string;
  serves?: string;
  steps: PlanFlowStep[];
  status: PlanStatus;
}

/** 2026-10-01 — an INDIRECT hop the code shows: one process writes a family
 *  (or zone) of a store that another process watches or reads. */
export interface IndirectHop {
  from: string;
  to: string;
  store: string;
  zone?: string;
  family?: string;
  /** "file:line fn" of the write, and of the read/watch */
  write: string;
  read: string;
}

/** 2026-10-01 — who an identity is: a service's own identity, a human role,
 *  or the owner of a resource. */
export const PRINCIPAL_KINDS = ["service", "human-role", "owner"] as const;
export type PrincipalKind = typeof PRINCIPAL_KINDS[number];

/** 2026-10-01 — an identity the system's access rules are about: "only the
 *  decider service writes verdicts" is `zones[].writers: ["svc-decider"]`
 *  plus `processes[].runsAs: "svc-decider"`. */
export interface PlanPrincipal extends PlanGrounding {
  id: string;
  kind: PrincipalKind;
  label?: string;
  status: PlanStatus;
}

/** 2026-10-01 — what a planned STORE is: a resource processes share, never
 *  a process. Any shared store fits one of these; `other` says so. */
export const STORE_KINDS = ["database", "document-store", "object-store", "queue", "cache", "sync", "kv", "other"] as const;
export type StoreKind = typeof STORE_KINDS[number];

/** A partition of a store where access is enforced (a database, a schema, a
 *  bucket, a topic, a document space): which document families live there. */
export interface PlanZone {
  id: string;
  label?: string;
  /** document families / key patterns that live here ("order", "orders/*") */
  holds: string[];
  /** principal ids allowed to write / read it (the plan's `principals`) */
  writers?: string[];
  readers?: string[];
  /** how the code picks this zone: a literal the code names, or the function
   *  the plan says routes to it (`router: resolveZone`) */
  routedBy?: string;
}

/** 2026-10-01 — a shared store (database, sync service, object store,
 *  queue): a RESOURCE processes reach, not a process. Realised when the code
 *  uses any of the libraries / project modules it is reached through. */
export interface PlanStore extends PlanGrounding {
  id: string;
  kind: StoreKind;
  label?: string;
  serves?: string | null;
  /** the tools (SDK, data library), project funnels (`lib.store`) or project
   *  folders (`packages/store-client/`) the code reaches it THROUGH */
  reachedThrough: string[];
  /** the client's own functions that write / read / watch it (`writeDoc`,
   *  `watchDocs`): a call to one, with literal zone or family arguments, is
   *  where the code touches a zone */
  access?: { write?: string[]; read?: string[]; watch?: string[] };
  zones?: PlanZone[];
  groundedIn?: string | null;
  status: PlanStatus;
}

export interface PlanProcess extends PlanGrounding {
  id: string;
  kind: SubsystemKind;
  label: string;
  /** which part of the objective this is for; null only on a converted plan */
  serves: string | null;
  /** where its code will live (a path prefix) — what lets the plan be checked */
  at?: string;
  /** 2026-10-01 — the principal (identity) it runs as */
  runsAs?: string;
  /** 2026-10-01 — a DEPLOYABLE: the files / entry-point ids it starts from
   *  (a runtime host script may live far from the logic it runs) */
  entryPoints?: string[];
  /** 2026-10-01 — the modules it runs (their files are its files too) */
  uses?: string[];
  /** a quote from the description it came from (greenfield); null = inferred */
  groundedIn?: string | null;
  status: PlanStatus;
}

export interface PlanBoundary extends PlanGrounding {
  id: string;
  from: string;
  /** a planned process id, a planned stack tool, or a planned STORE */
  to: string;
  /** when `to` is a store: the zone of it this boundary writes / reads */
  zone?: string;
  protocol?: string;
  /** the payload's key NAMES, never values */
  carries?: string[];
  groundedIn?: string | null;
  status: PlanStatus;
}

export interface PlanTool extends PlanGrounding {
  tool: string;
  role: StackRole;
  /** 2026-10-01 — the client libraries the code reaches it THROUGH: a store
   *  (`docstore`) used via its client (`yjs`). Code that uses a `via` library
   *  realises the tool — not "drifted, the code uses yjs". */
  via?: string[];
  why?: string;
  /** a verified quote from the documents it came from; null = inferred */
  groundedIn?: string | null;
  status: PlanStatus;
}

export interface PlanThread extends PlanGrounding {
  /** how the entry point will read: "POST /readings", "cli:nightly", a function name */
  id: string;
  entry: string;
  /** 2026-10-01 — the real entry point it is, when its human id does not read
   *  like one: an entry-point id (`bin/provision.ts:module`) or a file path
   *  (`bin/provision.ts`, matched to that file's one entry). Matched first. */
  entryPoint?: string;
  process?: string;
  serves: string;
  /** primary steps only; `b1:insert` names the boundary the step crosses */
  primary: string[];
  groundedIn?: string | null;
  status: PlanStatus;
}

export interface PlanPolicy extends PlanGrounding {
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
  /** 2026-10-01 — the planned item it concerns (a process, thread, boundary
   *  or tool id): where the map shows it. Absent = the whole project. */
  about?: string;
}

/** 2026-10-01 — a check someone RAN that bears on a plan item or an open
 *  question: the command, what it should show, when, and — once run — what it
 *  showed. Recorded, never run by VibeGraph (running is a person's step). */
export interface PlanEvidence {
  command: string;
  expect: string;
  /** when it was run, or recorded (ISO date) */
  at: string;
  /** what running it showed; absent = not run yet */
  result?: "confirmed" | "refuted";
  note?: string;
}

export interface PlanQuestion {
  id: string;
  text: string;
  /** as PlanPolicy.about */
  about?: string;
  /** 2026-10-01 — what has been run to answer it; the LATEST run decides
   *  whether it stands confirmed, refuted, or unverified */
  evidence?: PlanEvidence[];
}

/** 2026-10-01 — what an assumption (an open question an item `assumes`) stands as. */
export type AssumptionState = "unverified" | "confirmed" | "refuted";

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
  /** 2026-10-01 — OPTIONAL sections: absent in a plan written before them,
   *  and left out of the file again while empty (`sectionItems` reads them). */
  stores?: PlanStore[];
  principals?: PlanPrincipal[];
  flows?: PlanFlow[];
  modules?: PlanModule[];
}

export type PlanSection = "processes" | "boundaries" | "stack" | "threads" | "policies" | "open" | "stores" | "principals" | "flows" | "modules";
export const PLAN_SECTIONS: readonly PlanSection[] = ["processes", "boundaries", "stack", "threads", "policies", "open", "stores", "principals", "flows", "modules"];
/** Sections a plan may omit (added after plan.json v1 shipped). */
export const PLAN_OPTIONAL_SECTIONS: readonly PlanSection[] = ["stores", "principals", "flows", "modules"];

/** A section's items; [] for an optional section the plan does not have. */
export function sectionItems(plan: Plan, section: PlanSection): any[] {
  return ((plan as any)[section] as any[] | undefined) ?? [];
}

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
  | "orphaned"      // a boundary whose end is a DROPPED process: it can never be built as written
  | "pass" | "violated" | "unverifiable"  // a planned rule's check, as ADVICE
  | "prose";        // a planned rule with no check

export interface PlanFinding {
  section: PlanSection;
  id: string;
  verdict: PlanVerdict;
  detail: string;
  /** a real entry point the planned thread matched, to open it */
  entryPointId?: string;
  /** a drifted thread: the primary steps not found on it (the map marks them) */
  missing?: string[];
  /** a drifted thread: WHY each missing step is missing, where the IR says */
  missingWhy?: Record<string, string>;
  /** an unmatched thread: the closest real entry points ("did you mean …") */
  suggestions?: string[];
  /** a realised process: the entry points in its files (≤ 50) — how the map
   *  finds the real box the planned process became */
  entryPoints?: string[];
  /** a planned thread: the process it belongs to — named, or found from the
   *  entry point it starts from */
  process?: string;
  /** 2026-10-01 — the assumptions it rests on and where each stands */
  assumptions?: Array<{ id: string; state: AssumptionState }>;
  /** a flow: each step's verdict, in order */
  steps?: Array<{ step: string; found: boolean; at?: string }>;
}

/** 2026-10-01 — one cell of the derived write matrix: may this principal
 *  write this zone (the plan's `writers`), and does the code (an access site
 *  in a process that runs as it)? */
export interface WriteCell {
  principal: string;
  /** "store/zone" */
  zone: string;
  /** the plan lets it write (it is in `writers`) */
  allowed: boolean;
  /** where the code writes it: "file:line fn" */
  writes: string[];
}

export interface PlanReconcile {
  revision: number;
  /** principal × zone: allowed by the plan, written by the code */
  writeMatrix?: WriteCell[];
  /** processes the code joins THROUGH a store (a write one reads/watches) */
  indirectHops?: IndirectHop[];
  findings: PlanFinding[];
  counts: Partial<Record<PlanVerdict, number>>;
  limits: string[];
  /** processes and threads whose `serves` shares no meaningful word with the
   *  objective — a word-match GUESS, said as one, never a verdict */
  offObjective?: Array<{ section: PlanSection; id: string; serves: string }>;
}

export type { SystemPlan };
