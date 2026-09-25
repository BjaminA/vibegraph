// M-AGENT1 (PLAN-M-AGENT.md) — the Agent Manager's spine: a durable,
// gate-driven run over the packets vibegraph_plan_work derives from a
// task. PURE module (types, validation, transitions, ordering,
// persistence) on the build_plan.ts pattern — the orchestrator in
// server.ts only sequences calls into this file, so every rule here is
// unit-testable without a server boot.
//
// The two ratified gates (PLAN-M-AGENT decisions, Ben 2026-08-30):
//   * a DRAFT run does nothing until a human RATIFIES it;
//   * a packet's work counts only after a human APPROVES its evidence
//     (IR delta + assertions + diffs) at the awaiting-review gate.
// The orchestrator automates BETWEEN those gates, never through them.
//
// v1 named limits: ONE active run; a rejected packet FAILS (bounded
// re-draft is M-AGENT4).
//
// M-ORCH.4 (Ben, 2026-09-08) — LANES: `run.parallel` packets may be in
// flight at once. Independence is structural: dependencies still order
// packets, and two packets share the lanes only when their EDIT SCOPES
// (the brief's declared files, else the thread's files) do not overlap —
// their handoffs are the contract between them. The serial rule is the
// parallel=1 case, unchanged.

import * as fs from "fs";
import * as path from "path";
import type { WorkPlan } from "./plan_work.ts";
import { spendSentence } from "./spend.ts";
// Wire shapes live in the wire-contract home (protocol.ts, like
// BuildPlan) so the webview board renders the same definition the
// server transitions. Re-exported here under the spine's local names
// so server.ts and the unit suite have one import point.
import type {
  WorkRun, WorkRunPacket, WorkPacketEvidence,
  WorkRunStatus, WorkPacketStatus,
} from "../shared/protocol.ts";

export type { WorkRun };
export type RunStatus = WorkRunStatus;
export type PacketStatus = WorkPacketStatus;
export type RunPacket = WorkRunPacket;
export type PacketEvidence = WorkPacketEvidence;

export const WORK_RUN_FILE = path.join(".vibegraph", "work-run.json");

// ── creation ─────────────────────────────────────────────────────────────

export function draftWorkRun(plan: WorkPlan, now: () => Date = () => new Date()): WorkRun {
  return {
    version: "1",
    task: plan.task,
    createdAt: now().toISOString(),
    status: "draft",
    unmatchedTokens: plan.unmatchedTokens,
    cycles: plan.cycles,
    planNote: plan.planNote,
    packets: plan.packets.map((p, i) => ({
      id: `p${i + 1}`,
      status: "pending",
      attempts: 0,
      plan: p,
      evidence: null,
      escalation: null,
    })),
  };
}

// ── transitions (the ONLY sanctioned writers) ────────────────────────────

const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  draft: ["ratified"],
  ratified: ["running"],
  running: ["paused", "done", "failed"],
  paused: ["running"],
  done: [],
  failed: [],
};

const PACKET_TRANSITIONS: Record<PacketStatus, PacketStatus[]> = {
  // M-ORCH.2 — pending → no-change: the CONFIRMED brief said this packet
  // needs nothing; applied at the objective gate, never by a worker.
  pending: ["running", "skipped", "no-change"],
  running: ["awaiting-review", "escalated", "failed"],
  // M-AGENT4 — awaiting-review → pending is the BOUNDED RETRY: a first
  // rejection sends the packet back for ONE re-draft (its work already
  // restored); the second rejection fails it. The bound lives in
  // MAX_PACKET_ATTEMPTS, enforced by the review handler.
  // M-ORCH — awaiting-review → escalated: the orchestrator's review may
  // hand the packet to the human (a contract/constraint conflict, work
  // outside the plan). Escalations are never auto-resolved.
  "awaiting-review": ["done", "failed", "pending", "escalated"],
  done: [],
  failed: [],
  escalated: ["failed", "done"], // resolved in chat → human marks the outcome
  skipped: [],
  "no-change": [],
};

/** One re-draft after a rejection, then honest failure. */
export const MAX_PACKET_ATTEMPTS = 2;
/** M-ORCH.4 — the most packets a run may have in flight at once. */
export const MAX_LANES = 8;

export function setRunStatus(run: WorkRun, next: RunStatus): string | null {
  if (!RUN_TRANSITIONS[run.status].includes(next)) {
    return `illegal run transition ${run.status} → ${next}`;
  }
  run.status = next;
  return null;
}

/** M-STACK close-out (lanes finding): is `next` a legal transition for the
 *  packet RIGHT NOW? Pure — lets a reviewer restore a packet's snapshot
 *  BEFORE flipping its status, so no concurrent commit from another lane
 *  can persist "failed"/"pending" while the rejected bytes are still on
 *  disk. */
export function packetTransitionError(run: WorkRun, packetId: string, next: PacketStatus): string | null {
  const p = run.packets.find((x) => x.id === packetId);
  if (!p) return `no packet ${packetId}`;
  if (!PACKET_TRANSITIONS[p.status].includes(next)) return `illegal packet transition ${p.status} → ${next} (${packetId})`;
  return null;
}

export function setPacketStatus(
  run: WorkRun,
  packetId: string,
  next: PacketStatus,
  extras?: { evidence?: PacketEvidence; escalation?: { reason: string } },
): string | null {
  const p = run.packets.find((x) => x.id === packetId);
  if (!p) return `no packet ${packetId}`;
  if (!PACKET_TRANSITIONS[p.status].includes(next)) {
    return `illegal packet transition ${p.status} → ${next} (${packetId})`;
  }
  p.status = next;
  if (next === "running") { p.attempts += 1; p.startedAt = new Date().toISOString(); }
  if (extras?.evidence) p.evidence = extras.evidence;
  if (extras?.escalation) p.escalation = extras.escalation;
  // A failed dependency makes every (transitive) dependent unrunnable:
  // skip them EXPLICITLY so the board says why, instead of a silent stall.
  if (next === "failed" || next === "skipped") cascadeSkips(run);
  return null;
}

/** AUTONOMY — the ruling every autonomous run carries (PLAN-HISTORY,
 *  2026-09-12: "when sending off the agents to do tasks I expect the
 *  human to be out the loop"). */
export const AUTONOMY_RULING = "ruling:2026-09-12:human-out-of-the-loop";

/** AUTONOMY — an escalated packet has no human to return to: it is
 *  resolved as FAILED with its reason kept, its dependents cascade to
 *  skipped exactly as after any failure, and the review names the
 *  ruling. Never an approval. Refused on a run that is not autonomous. */
export function resolveEscalationAutonomously(run: WorkRun, packetId: string, reason: string): string | null {
  if (!run.autonomy) return `not an autonomous run — ${packetId} stays escalated for a human`;
  const p = run.packets.find((x) => x.id === packetId);
  if (!p) return `no packet ${packetId}`;
  if (p.status !== "escalated") return `${packetId} is ${p.status}, not escalated`;
  const err = setPacketStatus(run, packetId, "failed");
  if (err) return err;
  p.review = {
    by: "orchestrator", verdict: "escalate", at: new Date().toISOString(),
    reason: `autonomous run (${run.autonomy.ruling}): escalation resolved as FAILED, no human gate — ${reason}`,
  };
  run.autonomy.escalationsResolved += 1;
  return null;
}

function cascadeSkips(run: WorkRun): void {
  const dead = new Set(
    run.packets
      .filter((p) => p.status === "failed" || p.status === "skipped")
      .map((p) => p.plan.entryPointId),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of run.packets) {
      if (p.status !== "pending") continue;
      if (p.plan.boundaries.dependsOn.some((d) => dead.has(d))) {
        p.status = "skipped";
        dead.add(p.plan.entryPointId);
        changed = true;
      }
    }
  }
}

// ── ordering ─────────────────────────────────────────────────────────────

/** M-ORCH.4 — the files a packet's worker may CHANGE: the confirmed
 *  brief's declared edit scope (a subset of the thread's files) when it
 *  gave one, else every file the thread reaches (the M-AGENT remit). The
 *  scope is what the same-file guard, the snapshot, the evidence diffs,
 *  and the chokepoint's refusal all read — one definition. */
export function editScopeOf(run: WorkRun, packet: RunPacket): string[] {
  const declared = run.orchestration?.status === "ready"
    ? run.orchestration.packetTasks[packet.id]?.files
    : undefined;
  return declared && declared.length ? declared : packet.plan.filesReached;
}

/** Packets holding a lane: running, or awaiting a review that still
 *  owns its edit scope (a rejection would restore those files). */
export function inFlightPackets(run: WorkRun): RunPacket[] {
  return run.packets.filter((p) => p.status === "running" || p.status === "awaiting-review");
}

/** M-ORCH.4 — may `p` share the lanes with in-flight `q`? Only when
 *  neither CHANGES a file the other REACHES: a worker must never read a
 *  file another worker is changing mid-flight (the lanes drill's p6 read
 *  normalize.py before p5's change landed and escalated on stale code),
 *  and must never change a file a running worker already read. Two
 *  packets that merely READ the same file are fine. */
export function laneCompatible(run: WorkRun, p: RunPacket, q: RunPacket): boolean {
  const pScope = editScopeOf(run, p);
  const qScope = editScopeOf(run, q);
  const pReads = new Set(p.plan.filesReached);
  const qReads = new Set(q.plan.filesReached);
  return !pScope.some((f) => qReads.has(f) || qScope.includes(f)) && !qScope.some((f) => pReads.has(f));
}

/** The next packet the orchestrator may start: pending, all in-plan
 *  dependencies done, LANE-COMPATIBLE with everything in flight (and with
 *  `alsoInFlight` — packets the caller is about to start in the same
 *  tick), in build order. Coded and PINNED at M-AGENT4 so that
 *  parallelism could never put two packets on one file; M-ORCH.4 is that
 *  parallelism, and the guard now reads edit scopes AND reads. */
export function nextRunnablePacket(run: WorkRun, alsoInFlight: RunPacket[] = []): RunPacket | null {
  // A no-change packet satisfies its dependents exactly like a done one.
  const doneIds = new Set(
    run.packets.filter((p) => p.status === "done" || p.status === "no-change").map((p) => p.plan.entryPointId),
  );
  const inPlan = new Set(run.packets.map((p) => p.plan.entryPointId));
  const inFlight = [...inFlightPackets(run), ...alsoInFlight];
  const taken = new Set(alsoInFlight.map((p) => p.id));
  const ordered = [...run.packets].sort((a, b) => a.plan.order - b.plan.order);
  for (const p of ordered) {
    if (p.status !== "pending" || taken.has(p.id)) continue;
    const deps = p.plan.boundaries.dependsOn.filter((d) => inPlan.has(d));
    if (!deps.every((d) => doneIds.has(d))) continue;
    if (!inFlight.every((q) => laneCompatible(run, p, q))) continue;
    return p;
  }
  return null;
}

// ── M-BATCH — warm worker sessions ───────────────────────────────────
//
// The head-to-head runs cost ~4.5x plain Claude's wall clock, and the
// measured reason was not IR traversal — it was ~13 COLD model spawns run
// mostly in sequence, where plain Claude used one warm session for the
// whole task. Half of those spawns were reviews (M-ORCH.4's pre-checks
// already cut those); the rest were workers, each rediscovering files the
// previous worker had just edited.
//
// Two of the lane drill's escalations came from the same ignorance rather
// than from any parallelism bug: p6 read `normalize.py` believing the
// pre-p5 version, and p2 could not select a column p3 had added. A worker
// that had DONE the earlier packet would have known both.
//
// So: a packet may RESUME the session of a packet that just touched what it
// is about to touch. The batching is EMERGENT, not planned — the coupling
// that forces two packets to serialise is exactly the coupling that makes
// sharing context valuable, so nothing that could run in parallel is ever
// merged, and no new grouping concept enters the plan.
//
// The bound moves; it does not weaken. M-AGENT's "one-shot bounded" became
// "packet-bounded" by Ben's amendment; this makes it CHAIN-bounded — still
// remit-scoped (the MCP session is re-bound to the new packet on resume, so
// the chokepoint still refuses edits outside THIS packet's scope), still
// turn-bounded per packet, still escalate-don't-guess.

/** How many packets one worker session may carry before it is recycled.
 *  A cap rather than a hope: a session that has done four packets is
 *  carrying four packets' worth of context, and the reason multi-agent
 *  exists at all is that context is not free. */
export const MAX_SESSION_PACKETS = 4;

/**
 * May `p` inherit `q`'s context? Exactly when `p` could NOT have run beside
 * `q` — `!laneCompatible`.
 *
 * That equivalence is the whole design, not a convenience. The scheduler
 * already refuses to share the lanes when either packet CHANGES a file the
 * other REACHES; that is precisely the case where the second packet is
 * working on something the first one touched, and therefore precisely the
 * case where carrying its context is worth what the context costs. Two
 * packets that could have run in parallel are strangers, and a stranger's
 * context is a cost rather than a gift.
 *
 * It has to be SYMMETRIC, and the lanes e2e proved why: a first cut asked
 * only "did q CHANGE something p reads", which caught p2-after-p1 (p1 wrote
 * api/app.py, p2 reads it) and missed p4-after-p3 (p3 READ gateway/client.ts,
 * p4 writes it). p3's session knows that file; p4 is about to change it.
 * Reusing the scheduler's own predicate gets both directions for free and
 * cannot drift from it.
 */
function shouldInheritContext(run: WorkRun, p: RunPacket, q: RunPacket): boolean {
  return !laneCompatible(run, p, q);
}

/**
 * The session `packet` should resume, or null for a cold spawn.
 *
 * Refuses, in order, for reasons that are all about being WRONG rather than
 * about being slow:
 *   - a session whose packet was not cleanly `done` (a rejection restores
 *     the snapshot, so the session's belief about disk is stale);
 *   - a session that has carried MAX_SESSION_PACKETS already;
 *   - a packet that touches nothing the candidate touched (no shared
 *     context to inherit, and a stranger's context is a cost, not a gift);
 *   - a retry of the SAME packet — a rejected attempt's session is exactly
 *     the context that produced the rejected work.
 *
 * Picks the LATEST qualifying packet: the most recent edit to the files
 * this packet is about to read is the one worth remembering.
 */
export function warmSessionFor(
  run: WorkRun,
  packet: RunPacket,
): { sessionId: string; from: string; carried: number } | null {
  if (run.warmSessions === false) return null;
  const candidates = run.packets
    .filter((q) => q.id !== packet.id
      && q.status === "done"
      && typeof q.sessionId === "string" && q.sessionId.length > 0
      && (q.sessionPackets ?? 1) < MAX_SESSION_PACKETS
      && shouldInheritContext(run, packet, q))
    .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  const chosen = candidates[candidates.length - 1];
  if (!chosen?.sessionId) return null;
  return { sessionId: chosen.sessionId, from: chosen.id, carried: (chosen.sessionPackets ?? 1) };
}

/** A restore makes every live session's picture of the tree wrong, and a
 *  worker that believes a stale tree is worse than one that knows nothing.
 *  Called wherever a rejection puts the snapshot back. */
export function clearWorkerSessions(run: WorkRun): void {
  for (const p of run.packets) {
    delete p.sessionId;
    delete p.sessionPackets;
  }
}

/** M-ORCH.4 — every packet that may START now: fills the free lanes
 *  (`run.parallel`, absent = 1) with runnable packets whose edit scopes
 *  are disjoint from each other and from everything in flight. With
 *  parallel = 1 and nothing in flight this is exactly the serial rule. */
export function startablePackets(run: WorkRun): RunPacket[] {
  const lanes = Math.max(1, Math.floor(run.parallel ?? 1));
  const out: RunPacket[] = [];
  while (inFlightPackets(run).length + out.length < lanes) {
    const next = nextRunnablePacket(run, out);
    if (!next) break;
    out.push(next);
  }
  return out;
}

export function activePacket(run: WorkRun): RunPacket | null {
  return inFlightPackets(run)[0] ?? null;
}

/** done when every packet reached a terminal state; failed if any
 *  packet failed/was skipped (an incomplete run never claims success).
 *  An OPEN escalation is NOT terminal (real-drive finding, 2026-08-30):
 *  it is a gate awaiting the human's resolution — the run stays
 *  running (its card carries done/failed buttons) instead of
 *  terminalizing over the reviewer's head with a stale summary. */
export function runOutcome(run: WorkRun): RunStatus | null {
  const terminal = new Set(["done", "failed", "skipped", "no-change"]);
  if (!run.packets.every((p) => terminal.has(p.status))) return null;
  // no-change is CLEAN (a confirmed decision), skipped is not (a casualty).
  const clean = run.packets.every((p) => p.status === "done" || p.status === "no-change");
  return clean ? "done" : "failed";
}

// ── run summary (M-AGENT4 — the honest completion report) ───────────────

export interface RunSummary {
  done: number;
  failed: number;
  skipped: number;
  escalated: number;
  /** Files changed by APPROVED packets only — rejected work was restored. */
  filesChanged: string[];
  note: string;
}

export function runSummary(run: WorkRun): RunSummary {
  const count = (s: PacketStatus) => run.packets.filter((p) => p.status === s).length;
  const filesChanged = [...new Set(
    run.packets
      .filter((p) => p.status === "done")
      .flatMap((p) => (p.evidence?.diffs ?? []).map((d) => d.file)),
  )].sort();
  const failed = count("failed");
  const skipped = count("skipped");
  const escalated = count("escalated");
  const parts: string[] = [];
  if (failed) {
    const names = run.packets.filter((p) => p.status === "failed").map((p) => p.plan.qualifiedName);
    parts.push(`${failed} packet(s) failed (${names.join(", ")}) — their edits were restored`);
  }
  if (skipped) parts.push(`${skipped} skipped because a dependency failed`);
  if (escalated) {
    const reasons = run.packets
      .filter((p) => p.status === "escalated")
      .map((p) => p.escalation?.reason ?? "unresolved");
    parts.push(`${escalated} still escalated (${reasons.join("; ")})`);
  }
  // AUTONOMY — escalations that ended as failed packets because no human
  // was in the loop: said apart, with every reason, never folded into
  // "failed".
  const autoResolved = run.packets.filter((p) => p.status === "failed" && p.review?.verdict === "escalate");
  if (run.autonomy && autoResolved.length) {
    parts.push(`${autoResolved.length} escalation(s) resolved as FAILED under autonomy (${run.autonomy.ruling}), reasons kept: `
      + autoResolved.map((p) => `${p.plan.qualifiedName}: ${p.escalation?.reason ?? "no reason recorded"}`).join("; "));
  }
  // M-ORCH — say WHO approved: an orchestrated run's approvals are the
  // orchestrator's (a human confirmed the objective, not each diff), and
  // that difference must survive into the report.
  const byOrchestrator = run.packets.filter((p) => p.review?.by === "orchestrator").length;
  const byHuman = run.packets.filter((p) => p.review?.by === "human").length;
  // M-ORCH.4 — pre-check approvals are counted APART: no model read those
  // diffs; the checks were deterministic (edit scope, parse, entry-point
  // signature, resolution gaps). The report must not fold them into
  // "reviewed by the orchestrator".
  const byPreChecks = run.packets.filter((p) => p.review?.by === "pre-checks").length;
  const preChecksNote = byPreChecks
    ? ` ${byPreChecks} approved on pre-checks alone (deterministic: edit scope, parse, entry-point signature, resolution gaps — no model read those diffs).`
    : "";
  const reviewer = run.mode === "orchestrated"
    ? ` Reviews: ${byOrchestrator} by the orchestrator, ${byHuman} by a human — orchestrator approvals prove consistency with the confirmed objective, not conformance to external reality.${preChecksNote}`
    : "";
  // M-PROVIDER — say WHICH models did the work: a local worker or a local
  // reviewer is a weaker claim than Opus, and the report must carry it.
  const tally = (labels: (string | undefined)[]) => {
    const counts = new Map<string, number>();
    for (const l of labels) if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
    return [...counts].map(([l, n]) => `${l} ×${n}`).join(", ");
  };
  const workers = tally(run.packets.map((p) => p.workerModel));
  const reviewers = tally(run.packets.map((p) => p.review?.model));
  const models = workers || reviewers
    ? ` Models: workers ${workers || "(none spawned)"}; reviews ${reviewers || "(no model reviews)"}.`
    : "";
  // M-ORCH.2 — packets the confirmed brief marked "no change needed"
  // never spawned a worker; say so rather than folding them into "approved".
  const noChange = count("no-change");
  const noChangeNote = noChange
    ? ` ${noChange} packet(s) needed no change per the confirmed brief (no worker spawned).`
    : "";
  // AUTONOMY — the report must say that no human confirmed the objective.
  const autonomyNote = run.autonomy
    ? ` AUTONOMOUS run: the objective was confirmed by the ${run.autonomy.ratifiedBy} under ${run.autonomy.ruling}${run.autonomy.ratifiedAt ? ` at ${run.autonomy.ratifiedAt}` : ""}, not by a human; ${run.autonomy.escalationsResolved} escalation(s) were resolved as failed rather than returned to one.`
    : "";
  return {
    done: count("done"), failed, skipped, escalated, filesChanged,
    note: (parts.length
      ? parts.join(". ") + "."
      : `all ${count("done")} packet(s) approved; ${filesChanged.length} file(s) changed.`)
      + noChangeNote + reviewer + models + spendSentence(run.spend) + autonomyNote,
  };
}

// ── persistence (build_plan.ts pattern) ──────────────────────────────────

export function persistWorkRun(projectRoot: string, run: WorkRun): void {
  const file = path.join(projectRoot, WORK_RUN_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Atomic: the run file is read from disk by the headless driver and the
  // e2e specs while the server commits it several times a second under
  // lanes; a plain write let a reader see a truncated document ("Unexpected
  // end of JSON input", 1 in ~16 rounds). rename() swaps whole files.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

/** Load from disk. A run persisted mid-flight comes back PAUSED — after
 *  a restart the human resumes; the orchestrator never auto-resumes
 *  into spawning unattended (the build-plan precedent). */
export function loadWorkRun(projectRoot: string): WorkRun | null {
  const file = path.join(projectRoot, WORK_RUN_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const run = JSON.parse(fs.readFileSync(file, "utf-8")) as WorkRun;
    const err = validateWorkRun(run);
    if (err) {
      console.warn(`  [WorkRun] ${WORK_RUN_FILE} invalid (${err}) — ignoring`);
      return null;
    }
    if (run.status === "running") {
      run.status = "paused";
      // A packet caught mid-worker is honestly unfinished: back to pending
      // (its attempts count survives), never assumed complete.
      for (const p of run.packets) {
        if (p.status === "running") p.status = "pending";
      }
    }
    return run;
  } catch (e) {
    console.warn(`  [WorkRun] failed to load ${WORK_RUN_FILE}: ${(e as Error).message}`);
    return null;
  }
}

// ── validation (system boundary — WS payloads land here) ────────────────

const RUN_STATUSES = new Set(["draft", "ratified", "running", "paused", "done", "failed"]);
const PACKET_STATUSES = new Set([
  "pending", "running", "awaiting-review", "done", "failed", "escalated", "skipped", "no-change",
]);

export function validateWorkRun(x: unknown): string | null {
  if (!x || typeof x !== "object") return "not an object";
  const r = x as Record<string, unknown>;
  if (r.version !== "1") return "unknown version";
  if (typeof r.task !== "string" || !r.task.trim()) return "empty task";
  if (!RUN_STATUSES.has(r.status as string)) return `bad status ${r.status}`;
  if (!Array.isArray(r.packets) || r.packets.length === 0) return "no packets";
  // M-ORCH — mode is optional (pre-M-ORCH runs) but never unknown.
  if (r.mode !== undefined && r.mode !== "gated" && r.mode !== "orchestrated") return `bad mode ${r.mode}`;
  // M-ORCH.4 — lanes and review policy are optional but bounded.
  if (r.parallel !== undefined && (!Number.isInteger(r.parallel) || (r.parallel as number) < 1 || (r.parallel as number) > MAX_LANES)) return `bad parallel ${r.parallel}`;
  if (r.review !== undefined && r.review !== "full" && r.review !== "pre-checks") return `bad review policy ${r.review}`;
  // AUTONOMY — optional, but never a shape that could be mistaken for one.
  if (r.autonomy !== undefined) {
    const a = r.autonomy as Record<string, unknown> | null;
    if (!a || typeof a !== "object" || a.mode !== "autonomous" || typeof a.ruling !== "string" || !a.ruling
      || a.ratifiedBy !== "orchestrator" || !Number.isInteger(a.escalationsResolved)) return "bad autonomy";
    if (r.mode !== "orchestrated") return "autonomy on a gated run";
  }
  const ids = new Set<string>();
  for (const p of r.packets as Record<string, unknown>[]) {
    if (typeof p.id !== "string" || ids.has(p.id)) return "bad/duplicate packet id";
    ids.add(p.id);
    if (!PACKET_STATUSES.has(p.status as string)) return `bad packet status ${p.status}`;
    const plan = p.plan as Record<string, unknown> | undefined;
    if (!plan || typeof plan.entryPointId !== "string") return "packet missing plan.entryPointId";
  }
  return null;
}
