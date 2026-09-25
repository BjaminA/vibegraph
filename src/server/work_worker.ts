// M-AGENT3 (PLAN-M-AGENT.md) — the worker-session contract, pure and
// unit-testable: the packet prompt (a D1 bundle re-framed for a WORKER
// that has tools), the required output block, and the line diff the
// evidence gate renders.
//
// The bounds that make a worker "packet-bounded" (the ratified
// amendment of the one-shot rule): ONE packet, ONE session, a turn
// budget, a tool allowlist identical to the GUI chat (raw file tools
// denied — every edit goes through the CST chokepoint), and a remit
// rule that names escalation as the ONLY move outside the thread.

export const WORKER_TURN_BUDGET = 25;

export interface WorkerPromptBundle {
  entryPointId: string;
  qualifiedName: string;
  projection: string;
  skill: string | null;
  blindSpots: string;
  filesReached: string[];
  outsidePlan: { reaches: string[]; reachedBy: string[] };
  // M-CONTRACT.2/.3 — the thread contract (IR fact: what enters, what
  // leaves, what it touches, round trips) and the routed STATED
  // constraints (provenance per line). Both optional + additive so the
  // M-AGENT3 prompt shape is unchanged when absent.
  contract?: string | null;
  constraints?: string | null;
  // M-STACK.3 — the rendered system spec for THIS thread: the tools
  // its files use (IR fact) and the policies stated about them. Sits
  // between the contract and the constraints, so the worker reads what
  // the code does, then what it is built ON, then what it must keep.
  stack?: string | null;
  // M-ORCH — who reviews the packet's evidence. "human" is the M-AGENT
  // gate; "orchestrator" is the human-delegated review (the human
  // confirmed the objective; escalations still return to the human).
  reviewer?: "human" | "orchestrator";
  // M-ORCH.4 — the EDIT SCOPE: the files this worker may change (the
  // brief's declaration, a subset of filesReached). Absent = the whole
  // remit (M-AGENT3 prompt shape unchanged).
  editScope?: string[];
  /** AUTONOMY — the run confirmed its own objective under a recorded ruling; there is no human gate. */
  autonomous?: boolean;
  /** Quality layer — the packet's closing bar, computed at the objective gate; the review reads the same line. */
  closingBar?: string | null;
  /** M-SKILLS.2 — rendered generic direction: the skills a human enabled
   *  for this project whose applies_when fires for this thread, after the
   *  thread skill and inside what it left of the injection budget. */
  genericSkills?: string | null;
}

export interface PacketResult {
  outcome: "done" | "escalate";
  summary: string;
  reason?: string;
}

export function buildWorkerPrompt(b: WorkerPromptBundle, packetTask: string): string {
  // M-ORCH.4 — the edit scope narrows the remit when the brief declared
  // one: the rest of the thread's files are read-only context, because
  // another packet may be changing them IN PARALLEL right now.
  const scope = b.editScope?.length ? b.editScope : b.filesReached;
  const readOnly = b.filesReached.filter((f) => !scope.includes(f));
  const parts: string[] = [
    `You are a WORKER AGENT executing ONE packet of a ${b.autonomous ? "work run the orchestrator confirmed under a recorded human ruling (no human gate: an escalation ends your packet as failed, with your reason kept)" : "human-ratified work run"}, scoped to ONE code thread: ${b.qualifiedName} (${b.entryPointId}).`,
    "",
    "RULES (each is load-bearing):",
    `1. REMIT — you may read broadly through the vibegraph tools, but you may EDIT only these files: ${scope.join(", ") || "(none)"}. `
    + (readOnly.length
      ? `The other files this thread reaches (${readOnly.join(", ")}) are READ-ONLY context for you: another packet owns changes there and may be making them in parallel with you — the chokepoint refuses an edit outside your scope. Write your part against their CONTRACT and the handoff below. `
      : "")
    + "A change needed anywhere else means STOP and escalate (rule 4), naming the file and the exact change — never guess across your boundary.",
    "2. EDITS go ONLY through mcp__vibegraph__vibegraph_rewrite_node / mcp__vibegraph__vibegraph_compose_insert — the CST chokepoint verifies and confines every change. "
    + "Raw file tools are denied to you. An edit the chokepoint rejects is a fact to report, not to work around.",
    (b.reviewer === "orchestrator"
      ? "3. The ORCHESTRATOR reviews your work against the objective a human confirmed: the structural diffs and IR delta are collected AUTOMATICALLY — your summary is a self-report ranked below them. "
        + "Keep every data shape named in the thread contract and constraints below intact unless your task says otherwise; escalations and broken output contracts return to the human."
      : "3. A HUMAN reviews your work at a gate: the structural diffs and IR delta are collected AUTOMATICALLY — your summary is a self-report ranked below them. ")
    + "Never claim a verification you did not perform; say what you changed and what a reviewer should check.",
    "4. FINISH with exactly one fenced block, the LAST thing you output:",
    "```vg-packet-result",
    '{"outcome": "done" | "escalate", "summary": "<what you did / found>", "reason": "<escalations only: what you need that is outside this packet>"}',
    "```",
    `5. Budget: you have at most ${WORKER_TURN_BUDGET} turns. Running out means the packet escalates — prefer a small, reviewable change over an unfinished large one.`,
    "",
    "YOUR PACKET TASK:",
    packetTask,
    ...(b.closingBar ? ["", `CLOSING BAR (computed before you started, from the envelope; the review reads the same line): ${b.closingBar}`] : []),
    "",
    "Execution path (compact, honest projection):",
    b.projection || "(no steps)",
    "",
    `Files reached by this thread: ${b.filesReached.join(", ") || "(none)"}`,
  ];
  if (b.outsidePlan.reaches.length || b.outsidePlan.reachedBy.length) {
    parts.push(
      "",
      "THREADS OUTSIDE THIS RUN (your escalation surface — never edit toward them):",
      ...(b.outsidePlan.reaches.length ? [`  reaches: ${b.outsidePlan.reaches.join(", ")}`] : []),
      ...(b.outsidePlan.reachedBy.length ? [`  reached by: ${b.outsidePlan.reachedBy.join(", ")}`] : []),
    );
  }
  if (b.skill) {
    parts.push("", "Human-ratified thread skill (authoritative guidance for this thread):", b.skill.trim());
  }
  // M-SKILLS.2 — generic direction AFTER the thread skill: a ratified
  // per-thread fact outranks direction true of a kind of code, and the
  // constraints below outrank both.
  if (b.genericSkills) parts.push("", b.genericSkills.trim());
  // M-CONTRACT — data in / data out / what the thread touches (IR fact),
  // then the stated constraints with their provenance. The contract comes
  // BEFORE the constraints so the agent reads what the code does before
  // what it must keep doing.
  if (b.contract) {
    parts.push("", b.contract.trim());
  }
  // M-STACK.3 — build with the tools this project already uses; a new
  // dependency is a decision, not a worker's to take.
  if (b.stack) {
    parts.push("", b.stack.trim(), "",
      "Use the tools above. If your task genuinely needs a capability none of them provides, that is an ESCALATION (rule 4) — name the capability and what you would reach for. Never add a dependency, and never introduce a second tool for a job one of these already does.");
  }
  if (b.constraints) {
    parts.push("", b.constraints.trim());
  }
  if (b.blindSpots) {
    parts.push("", b.blindSpots.trim());
  }
  return parts.join("\n");
}

// ── M-ORCH.3 — the SYSTEM packet worker prompt ────────────────────────
// Work no thread owns: a migration, a new module, an integration point.
// Proposed by the brief, CONFIRMED by the human at the objective gate.
// Same session posture as a thread worker (vibegraph MCP only, chokepoint
// edits, turn budget), a different bundle: no projection (there is no
// thread), the CONTRACTS of the threads it integrates with, the
// constraints routed to its files, and vibegraph_create_file for a new
// Python module. The file list is the remit — nothing else is editable.

export interface SystemWorkerBundle {
  packetId: string;
  title: string;
  rationale: string;
  /** Files the worker may edit; the ones NOT in `existing` may be created. */
  files: string[];
  existing: string[];
  integrates: string[];
  /** Quality layer — the packet's closing bar (see WorkerPromptBundle). */
  closingBar?: string | null;
  /** Rendered contract blocks of the integration threads (IR fact). */
  integrationContracts: string[];
  /** M-STACK.3 — the PROJECT spec: a system packet has no thread, and a
   *  new module must be built with the tools the project already uses. */
  stack?: string | null;
  constraints: string | null;
  reviewer?: "human" | "orchestrator";
}

export function buildSystemWorkerPrompt(b: SystemWorkerBundle, packetTask: string): string {
  const creatable = b.files.filter((f) => !b.existing.includes(f));
  const parts: string[] = [
    `You are a WORKER AGENT executing ONE SYSTEM PACKET of a confirmed work run: "${b.title}" (${b.packetId}). A system packet is cross-cutting work no single code thread owns — the orchestrator proposed it and a human confirmed it.`,
    "",
    "RULES (each is load-bearing):",
    `1. REMIT — you may read broadly through the vibegraph tools, but you may EDIT only these files: ${b.files.join(", ")}. `
    + (creatable.length
      ? `Of these, ${creatable.join(", ")} do NOT exist yet: create them with mcp__vibegraph__vibegraph_create_file (Python only — the chokepoint parses and formats the module). `
      : "")
    + "Anything needed elsewhere means STOP and escalate (rule 4) — never guess across the boundary.",
    "2. EDITS to existing files go ONLY through mcp__vibegraph__vibegraph_rewrite_node / mcp__vibegraph__vibegraph_compose_insert; NEW files only through vibegraph_create_file. Raw file tools are denied. A refusal from the chokepoint is a fact to report, not to work around.",
    (b.reviewer === "orchestrator"
      ? "3. The ORCHESTRATOR reviews your work against the objective a human confirmed: the structural diffs and IR delta are collected AUTOMATICALLY — your summary is a self-report ranked below them. Keep every data shape named in the integration contracts and constraints below intact."
      : "3. A HUMAN reviews your work at a gate: the structural diffs and IR delta are collected AUTOMATICALLY — your summary is a self-report ranked below them.")
    + " Never claim a verification you did not perform.",
    "4. FINISH with exactly one fenced block, the LAST thing you output:",
    "```vg-packet-result",
    '{"outcome": "done" | "escalate", "summary": "<what you did / found>", "reason": "<escalations only: what you need that is outside this packet>"}',
    "```",
    `5. Budget: you have at most ${WORKER_TURN_BUDGET} turns. Running out means the packet escalates — prefer a small, reviewable change over an unfinished large one.`,
    "",
    "YOUR PACKET TASK:",
    packetTask,
    ...(b.closingBar ? ["", `CLOSING BAR (computed before you started, from the envelope; the review reads the same line): ${b.closingBar}`] : []),
    "",
    `Why this is a system packet: ${b.rationale || "(no rationale recorded)"}`,
    `Files in your remit: ${b.files.join(", ")}${creatable.length ? ` (to create: ${creatable.join(", ")})` : ""}`,
    `Integration points (threads whose contracts you must honour): ${b.integrates.join(", ") || "(none named)"}`,
  ];
  for (const c of b.integrationContracts) parts.push("", c.trim());
  if (b.stack) {
    parts.push("", b.stack.trim(), "",
      "Build with the tools above — a new module that reaches for a second HTTP client or a second database driver is a decision nobody took. A capability none of them provides is an ESCALATION.");
  }
  if (b.constraints) parts.push("", b.constraints.trim());
  return parts.join("\n");
}

/** Parse the LAST ```vg-packet-result fenced block. null = the worker
 *  broke the contract; the caller records that honestly rather than
 *  inventing an outcome. */
export function parsePacketResult(text: string | null): PacketResult | null {
  if (!text) return null;
  const re = /```vg-packet-result\s*\n([\s\S]*?)```/g;
  let last: string | null = null;
  for (const m of text.matchAll(re)) last = m[1];
  if (!last) return null;
  try {
    const parsed = JSON.parse(last.trim()) as Record<string, unknown>;
    const outcome = parsed.outcome === "escalate" ? "escalate" : parsed.outcome === "done" ? "done" : null;
    if (!outcome) return null;
    return {
      outcome,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    };
  } catch {
    return null;
  }
}

/** Head/tail-anchored line diff for the evidence card (the same shape
 *  the rewriters' confinement module renders — reimplemented here in
 *  TS because server.ts cannot import the frontend .mjs). */
export function lineDiff(pre: string, post: string, cap = 60): string {
  const a = pre.split("\n");
  const b = post.split("\n");
  let h = 0;
  while (h < a.length && h < b.length && a[h] === b[h]) h++;
  let t = 0;
  while (t < a.length - h && t < b.length - h && a[a.length - 1 - t] === b[b.length - 1 - t]) t++;
  const out: string[] = [];
  for (const l of a.slice(h, a.length - t)) out.push(`-${l}`);
  for (const l of b.slice(h, b.length - t)) out.push(`+${l}`);
  return out.slice(0, cap).join("\n");
}
