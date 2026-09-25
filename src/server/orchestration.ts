// M-ORCH (PLAN-M-CONTRACT.md) — the holistic orchestrator, PURE.
//
// The human confirms ONE thing — the objective — and delegates the rest
// (Ben's amendment, 2026-09-06; the per-packet gate becomes the
// orchestrator's by the human's explicit choice at the objective gate):
//
//   1. the BRIEF — given the task, the plan's packets, and every packet
//      thread's compact CONTRACT (data in/out, the calls it touches, round
//      trips) plus the constraints already routed to it, the orchestrator
//      writes each packet's task text and the constraint HANDOFF that
//      packet's worker needs — nothing more, so a localised agent is never
//      swamped with the whole project — and the global constraints the
//      objective implies;
//   2. the REVIEW — given a packet's task, its handoff, and the SERVER-
//      collected evidence, the orchestrator approves, rejects (the
//      bounded retry follows, once), or escalates to the human.
//
// Floors kept: the brief is a fenced JSON block VALIDATED against the plan
// (unknown packets dropped and NAMED, missing ones NAMED); the review runs
// deterministic pre-checks first and NEVER approves on silence (a failed
// reviewer spawn leaves the packet at the human gate); escalations and
// broken output contracts always return to the human; every verdict is
// recorded on the packet with `by: "orchestrator"` so the human audits
// after the fact; the human can pause at any time.

import type {
  WorkRun, WorkRunPacket, WorkPacketEvidence, WorkRunOrchestration, PacketReview, SystemPacketProposal,
  StackProposal, StackPolicy,
} from "../shared/protocol.ts";
import { validateConstraintInput, type ConstraintInput } from "./constraint_store.ts";
import { STACK_ROLES, isSafeToolName, type StackRole } from "../shared/stack_taxonomy.ts";

export const BRIEF_FENCE = "vg-orchestration";
export const VERDICT_FENCE = "vg-review-verdict";
const MAX_HANDOFF = 8;
const MAX_HANDOFF_CHARS = 400;
const MAX_GLOBAL = 12;
/** M-ORCH.3 — a brief may propose at most this many system packets. */
export const MAX_SYSTEM_PACKETS = 3;
/** M-STACK.4 — and at most this many NEW tools. */
export const MAX_STACK_PROPOSALS = 3;
const DIFF_CAP_CHARS = 4000;

export interface BriefThreadSummary {
  entryPointId: string;
  qualifiedName: string;
  language: string;
  /** Rendered contract block (IR fact) or null. */
  contract: string | null;
  /** Rendered routed constraints (stated) or null. */
  constraints: string | null;
  /** M-STACK.3 — the packet's one-line stack (tools its files use). */
  stack?: string | null;
}

// ── the brief ────────────────────────────────────────────────────────────

export function buildBriefPrompt(args: {
  task: string;
  packets: WorkRunPacket[];
  threads: Map<string, BriefThreadSummary>;
  /** M-STACK.3/.4 — the rendered PROJECT stack spec (facts + the
   *  policies stated about them). This is what lets the brief choose
   *  the optimum EXISTING tool, and propose one only when none fits. */
  projectStack?: string | null;
}): string {
  const parts: string[] = [
    "You are the ORCHESTRATOR of a multi-agent work run over a codebase whose structure is known exactly (a static IR).",
    "A human will confirm the OBJECTIVE you state; after that, one bounded WORKER agent runs per packet below, and YOU review each packet's evidence. Workers see ONLY their own thread: its execution path, its contract (data in / data out / what it touches), and the handoff you write. They cannot see other packets or the whole project — that is deliberate.",
    "",
    "YOUR JOB: (1) restate the objective in one or two sentences a human can confirm; (2) for EVERY packet, write the concrete task for its worker and a HANDOFF — the 1–5 constraints and data shapes that worker must keep (payload shape in and out at its boundary, which proxy or backend it talks to and what that expects, which performance lever applies: batch the round trips inside a loop rather than micro-optimise) — phrased as facts to keep, never a restatement of the project; (3) state the GLOBAL constraints the objective implies for the whole project, if any.",
    "",
    "HONESTY RULES: use only endpoints, tables, files, and shapes that appear in the contracts below — never invent one. A packet's task must stay inside the packet's files; if the objective needs work no packet owns, say so in the objective note instead of assigning it. If a contract lists 'Round trips inside loops', the handoff for that packet names the batching lever explicitly.",
    "SCOPE RULE (head-to-head finding, 2026-09-07): a packet's task states ONLY what the objective requires in that thread — never add a requirement the objective did not state (a docstring or comment update, a refactor, a test, a tidy-up). Extras you would like belong in `note`, not in a task: an added requirement the worker cannot satisfy stalls the whole packet at a human gate for work nobody asked for.",
    "TOOLS (the PROJECT STACK block above): a packet's task names the EXISTING tools its work uses — the project funnel, not the library it wraps (a thread whose stack lists `telemetry.http_client [http-client, project funnel wrapping requests]` calls the funnel; reaching for `requests` directly would bypass whatever the funnel exists to do). Where two of the project's tools could serve, say which and why in that packet's handoff. Never assume a tool that is not in that block.",
    "A NEW TOOL (`stackProposals`): when the objective needs a capability NOTHING in the project stack provides, PROPOSE the tool — never assume it, never have a worker add it. Give the `tool` name, its `role`, `why` the existing stack cannot serve, `rule` (\"prefer\", or \"require\" when the objective is meaningless without it), the `alternatives` you rejected WITH the reason for each (a proposal with no alternatives considered is a preference, not a decision), and the `scope` it applies to. At most three. The human confirms them with the objective, and only then do they become stated policies your workers receive; nothing installs a package. If an existing tool CAN do the job — even clumsily — say so in the packet's handoff instead of proposing a new one.",
    "GLOBAL CONSTRAINTS: state only NEW facts the objective implies. Do NOT restate a constraint that already appears in a packet's 'Constraints for this thread' block below — those are already routed to every worker that needs them, and a restated copy would be stored twice under a weaker source.",
    "SYSTEM PACKETS (work NO thread owns): the plan only contains threads the task's words matched, so cross-cutting work can fall between them — a schema migration for existing data, a new module, a wiring point between two threads. When the objective genuinely needs such work, PROPOSE it as an extra packet in `extraPackets`: an id x1, x2…; a short title; a concrete task; the handoff; the exact `files` its worker may edit (a NEW .py module may be listed and will be created through the chokepoint; existing files are allowed and the packet then runs AFTER the plan packets that own them); a one-sentence rationale; `integrates` = the entryPointIds whose contracts the worker must receive (its integration points); `after` = plan packet ids that must finish first. The human confirms these with the objective. Do not use a system packet for work a plan packet already covers, and never propose more than three. ASK EXPLICITLY: does the objective change a STORED shape — a table, a serialised file, a wire format? Then data that already exists needs a migration or a compatibility path (an existing sqlite file created with `create table if not exists` will NOT gain a new column by itself); if no plan packet's files own that work, PROPOSE it as a system packet — a note that names the gap and leaves it is the failure mode this exists to end.",
    "NO-CHANGE PACKETS: the plan matches threads LEXICALLY (a file name in the task pulls in every thread seeded in that file), so some packets may need nothing for this objective. For those, set \"noChange\": true and make `task` the one-sentence reason (what you verified from the contract that makes no edit necessary). A no-change packet spawns NO worker — so only mark it when the objective genuinely requires nothing in that thread; when in doubt, give it a task.",
    "ORDER (`after`): the plan orders packets by the CALL graph only. When a packet must SEE another packet's change on disk before it can do its own work — a column the schema packet adds, a helper another packet writes, a shape another packet changes — and no call edge exists between them, list those packet ids in `after`; its worker then runs once they are done instead of escalating on code that has not landed yet. Only genuine on-disk dependencies: an unnecessary `after` serialises work that could run in parallel.",
    "EDIT SCOPE (`files`): for every packet that has a task, list the files its worker may CHANGE — a subset of that packet's `files:` line, kept to what the task needs. Packets whose edit scopes do not overlap run IN PARALLEL (their handoffs are the contract between them — the shape one promises at its boundary is what the other writes against), so give each file to the ONE packet whose task changes it and keep the others' hands off it; two packets that must change the same file will simply run one after the other. A worker's edit outside its scope is refused by the chokepoint, and a change it needs there becomes an escalation — so when a task needs a helper in another packet's file, put that helper in the OTHER packet's task and describe its shape in both handoffs.",
    "",
    `RUN TASK (from the human): ${args.task}`,
  ];
  if (args.projectStack) {
    parts.push("", args.projectStack.trim());
  }
  parts.push(
    "",
    "PACKETS (dependencies-first build order; ids are what you must reference):",
  );
  for (const p of [...args.packets].sort((a, b) => a.plan.order - b.plan.order)) {
    const t = args.threads.get(p.plan.entryPointId);
    const b = p.plan.boundaries;
    parts.push(
      "",
      `### packet ${p.id} — ${p.plan.qualifiedName} (${p.plan.entryPointId}, order ${p.plan.order}${t ? `, ${t.language}` : ""})`,
      `files: ${p.plan.filesReached.join(", ") || "(none)"}; depends on: ${b.dependsOn.join(", ") || "(none)"}; matched on: ${p.plan.matchedOn.join(", ")}`,
      `outside-plan boundary: reaches ${b.outsidePlan.reaches.join(", ") || "—"}; reached by ${b.outsidePlan.reachedBy.join(", ") || "—"}; gaps ${b.resolutionGaps}, dynamic ${b.runtimeDispatch}, uncaptured ${b.uncaptured}; skill: ${p.plan.skill.status}`,
      ...(t?.stack ? [t.stack] : []),
      t?.contract ?? "(no contract available for this thread)",
      ...(t?.constraints ? [t.constraints] : []),
    );
  }
  parts.push(
    "",
    "FINISH with exactly one fenced block, the LAST thing you output — valid JSON, every packet id present:",
    "```" + BRIEF_FENCE,
    JSON.stringify({
      objective: "<one or two sentences the human confirms>",
      packets: [
        { id: "p1", task: "<concrete task for this worker>", handoff: ["<constraint or data shape to keep>", "..."], files: ["<file this worker may change>", "..."], after: ["<packet id whose change this worker must see on disk first — usually empty>"] },
        { id: "p2", noChange: true, task: "<why this thread needs no edit for the objective>", handoff: [] },
      ],
      globalConstraints: [{ kind: "payload-schema | proxy | backend-call | perf-lever | invariant | objective", text: "<the constraint>", scope: { all: true } }],
      extraPackets: [{
        id: "x1", title: "<short title>", task: "<concrete task for this worker>", handoff: ["<fact to keep>"],
        files: ["<existing/file.py or new/module.py>"], rationale: "<why no plan packet owns this>",
        integrates: ["<entryPointId whose contract the worker needs>"], after: ["p1"],
      }],
      stackProposals: [{
        tool: "<package or module name>", role: "<web-framework | frontend | http-client | db | cache | queue | tensor | data | cloud | infra | process | remote | test | build>",
        why: "<what the objective needs that no tool in the PROJECT STACK provides>",
        rule: "prefer | require",
        alternatives: [{ tool: "<existing or other candidate>", whyNot: "<why it does not serve>" }],
        scope: { all: true },
      }],
      note: "<anything the objective needs that no packet owns and no system packet can do; else empty>",
    }, null, 2),
    "```",
  );
  return parts.join("\n");
}

function lastFence(text: string | null, fence: string): string | null {
  if (!text) return null;
  const re = new RegExp("```" + fence + "\\s*\\n([\\s\\S]*?)```", "g");
  let last: string | null = null;
  for (const m of text.matchAll(re)) last = m[1];
  return last;
}

export interface ParsedBrief {
  orchestration: WorkRunOrchestration;
  globalConstraints: ConstraintInput[];
  problems: string[];
}

/** Validate the orchestrator's brief against the run's packets. null =
 *  no usable block (the caller records "unavailable" honestly). */
export function parseBrief(text: string | null, run: WorkRun, knownEntryPointIds?: Set<string>): ParsedBrief | null {
  const raw = lastFence(text, BRIEF_FENCE);
  if (!raw) return null;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw.trim()); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const problems: string[] = [];
  const objective = typeof parsed.objective === "string" ? parsed.objective.trim() : "";
  if (!objective) return null;

  const known = new Map(run.packets.map((p) => [p.id, p]));
  const packetTasks: WorkRunOrchestration["packetTasks"] = {};
  for (const item of Array.isArray(parsed.packets) ? (parsed.packets as Record<string, unknown>[]) : []) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" ? item.id : "";
    if (!known.has(id)) { problems.push(`brief named unknown packet ${id || "(no id)"} — dropped`); continue; }
    const task = typeof item.task === "string" ? item.task.trim() : "";
    if (!task) { problems.push(`packet ${id}: empty task — worker falls back to the run task`); continue; }
    const handoff = (Array.isArray(item.handoff) ? item.handoff : [])
      .filter((h): h is string => typeof h === "string" && !!h.trim())
      .slice(0, MAX_HANDOFF)
      .map((h) => h.trim().slice(0, MAX_HANDOFF_CHARS));
    // M-ORCH.2 — `noChange: true` (strictly boolean) marks a packet the
    // objective does not touch; its `task` is the reason. Applied at the
    // objective gate (the human confirmed it), never by a worker.
    if (item.noChange === true) { packetTasks[id] = { task, handoff, noChange: true }; continue; }
    // M-ORCH.4 — `files`: the edit scope. Only files the thread REACHES
    // count (a brief cannot widen a remit); anything else is dropped and
    // NAMED. An empty/omitted scope means the whole remit, as before.
    const remit = known.get(id)!.plan.filesReached;
    const rawFiles = Array.isArray(item.files) ? item.files.filter((f): f is string => typeof f === "string") : [];
    const files = [...new Set(rawFiles.map((f) => f.trim()).filter((f) => remit.includes(f)))];
    const dropped = rawFiles.map((f) => f.trim()).filter((f) => f && !remit.includes(f));
    if (dropped.length) problems.push(`packet ${id}: edit scope named file(s) outside its thread (${dropped.join(", ")}) — dropped`);
    // `after`: known plan packet ids, never itself (cycles are refused when
    // the ordering is APPLIED at the objective gate, where every packet's
    // final dependency set is known).
    const rawAfter = Array.isArray(item.after) ? item.after.filter((a): a is string => typeof a === "string").map((a) => a.trim()) : [];
    const after = [...new Set(rawAfter.filter((a) => a !== id && known.has(a)))];
    const badAfter = rawAfter.filter((a) => a === id || !known.has(a));
    if (badAfter.length) problems.push(`packet ${id}: after named unknown/self packet id(s) (${badAfter.join(", ")}) — dropped`);
    packetTasks[id] = { task, handoff, ...(files.length ? { files } : {}), ...(after.length ? { after } : {}) };
  }
  for (const p of run.packets) {
    if (!packetTasks[p.id]) problems.push(`packet ${p.id} (${p.plan.qualifiedName}) has no brief task — worker falls back to the run task`);
  }

  const globalConstraints: ConstraintInput[] = [];
  for (const g of Array.isArray(parsed.globalConstraints) ? (parsed.globalConstraints as unknown[]).slice(0, MAX_GLOBAL) : []) {
    const v = validateConstraintInput(g);
    if (v.ok) globalConstraints.push(v.value);
    else problems.push(`global constraint dropped: ${v.error}`);
  }
  // M-ORCH.3 — system packets: validated hard (ids x1…, ≤ 3, ≤ 6 relative
  // files inside the project, known integration threads / after-ids only);
  // anything dropped is NAMED in the note, never silently lost.
  const extraPackets: SystemPacketProposal[] = [];
  const knownEps = new Set(run.packets.map((p) => p.plan.entryPointId));
  const safeRel = (f: unknown): f is string =>
    typeof f === "string" && !!f.trim() && !f.startsWith("/") && !/^[a-zA-Z]:/.test(f) && !f.split(/[\\/]/).includes("..");
  for (const [i, raw] of (Array.isArray(parsed.extraPackets) ? parsed.extraPackets : []).entries()) {
    if (extraPackets.length >= MAX_SYSTEM_PACKETS) { problems.push(`system packet ${i + 1}: over the ${MAX_SYSTEM_PACKETS}-packet cap — dropped`); continue; }
    const x = (raw ?? {}) as Record<string, unknown>;
    const title = typeof x.title === "string" ? x.title.trim() : "";
    const task = typeof x.task === "string" ? x.task.trim() : "";
    const files = (Array.isArray(x.files) ? x.files : []).filter(safeRel).map((f) => f.trim()).slice(0, 6);
    if (!title || !task || files.length === 0) { problems.push(`system packet ${i + 1}: needs title, task, and at least one project-relative file — dropped`); continue; }
    const integrates = (Array.isArray(x.integrates) ? x.integrates : []).filter((e): e is string => typeof e === "string");
    const unknownInt = integrates.filter((e) => !knownEps.has(e) && !(knownEntryPointIds?.has(e) ?? false));
    if (unknownInt.length) problems.push(`system packet x${extraPackets.length + 1}: unknown integration thread(s) ${unknownInt.join(", ")} — dropped from integrates`);
    const after = (Array.isArray(x.after) ? x.after : []).filter((id): id is string => typeof id === "string" && known.has(id));
    extraPackets.push({
      id: `x${extraPackets.length + 1}`,
      title: title.slice(0, 120),
      task,
      handoff: (Array.isArray(x.handoff) ? x.handoff : []).filter((h): h is string => typeof h === "string" && !!h.trim()).slice(0, MAX_HANDOFF).map((h) => h.trim().slice(0, MAX_HANDOFF_CHARS)),
      files,
      rationale: typeof x.rationale === "string" ? x.rationale.trim().slice(0, 400) : "",
      integrates: integrates.filter((e) => !unknownInt.includes(e)),
      after,
    });
  }
  // M-STACK.4 — proposed TOOLS. Validated as hard as the system packets:
  // a safe tool name, a reason, a known role, a real scope, ≤ 3. Anything
  // dropped is NAMED — a silently discarded proposal would read at the
  // gate as "the brief needed nothing new", which is a different claim.
  const stackProposals: StackProposal[] = [];
  for (const [i, raw] of (Array.isArray(parsed.stackProposals) ? parsed.stackProposals : []).entries()) {
    if (stackProposals.length >= MAX_STACK_PROPOSALS) { problems.push(`stack proposal ${i + 1}: over the ${MAX_STACK_PROPOSALS}-tool cap — dropped`); continue; }
    const x = (raw ?? {}) as Record<string, unknown>;
    if (!isSafeToolName(x.tool)) { problems.push(`stack proposal ${i + 1}: needs a tool name — dropped`); continue; }
    const why = typeof x.why === "string" ? x.why.trim() : "";
    if (!why) { problems.push(`stack proposal ${x.tool}: needs a "why" (what the existing stack cannot do) — dropped`); continue; }
    const scopeRaw = (x.scope ?? { all: true }) as Record<string, unknown>;
    const scopeCheck = validateConstraintInput({ kind: "objective", text: why, scope: scopeRaw });
    if (!scopeCheck.ok) { problems.push(`stack proposal ${x.tool}: ${scopeCheck.error} — dropped`); continue; }
    const alternatives = (Array.isArray(x.alternatives) ? x.alternatives : [])
      .map((a) => (a ?? {}) as Record<string, unknown>)
      .filter((a) => isSafeToolName(a.tool))
      .slice(0, 4)
      .map((a) => ({ tool: a.tool as string, whyNot: (typeof a.whyNot === "string" ? a.whyNot : "").trim().slice(0, 300) }));
    stackProposals.push({
      tool: x.tool as string,
      ...(STACK_ROLES.includes(x.role as StackRole) ? { role: x.role as StackRole } : {}),
      why: why.slice(0, 600),
      rule: x.rule === "require" ? "require" : "prefer",
      alternatives,
      scope: scopeCheck.value.scope,
    });
  }
  const note = typeof parsed.note === "string" ? parsed.note.trim() : "";

  return {
    orchestration: {
      status: "ready",
      objective,
      packetTasks,
      globalConstraints: globalConstraints.map((c) => ({ kind: c.kind, text: c.text, scope: c.scope })),
      storedConstraintIds: [],
      ...(extraPackets.length ? { extraPackets } : {}),
      ...(stackProposals.length ? { stackProposals } : {}),
      note: [
        `brief validated: ${Object.keys(packetTasks).length}/${run.packets.length} packet task(s), ${globalConstraints.length} global constraint(s)${extraPackets.length ? `, ${extraPackets.length} system packet(s) proposed` : ""}${stackProposals.length ? `, ${stackProposals.length} new tool(s) proposed` : ""}`,
        ...(note ? [`orchestrator note: ${note}`] : []),
        ...problems,
      ].join(". "),
    },
    globalConstraints,
    problems,
  };
}

/** M-STACK.4 — the CONFIRMED brief's tool proposals as constraint inputs:
 *  a `stack-policy` per proposal, scoped as the brief asked AND by the
 *  tool itself, so it keeps applying to whatever adopts the tool later.
 *  Pure — the caller persists them (source "orchestrator") at the
 *  objective gate, through the same duplicate check as the globals.
 *  Nothing here installs anything: a policy is a decision, not an act. */
export function stackPolicyInputs(run: WorkRun): ConstraintInput[] {
  const o = run.orchestration;
  if (!o || o.status !== "ready") return [];
  const out: ConstraintInput[] = [];
  for (const p of o.stackProposals ?? []) {
    const alts = p.alternatives.length
      ? ` Considered instead: ${p.alternatives.map((a) => `${a.tool} (${a.whyNot || "no reason given"})`).join("; ")}.`
      : " No alternatives were named.";
    const v = validateConstraintInput({
      kind: "stack-policy",
      text: `${p.rule === "require" ? "Use" : "Prefer"} ${p.tool}${p.role ? ` as this project's ${p.role}` : ""}: ${p.why}${alts}`,
      scope: { ...p.scope, stack: [p.tool] },
      policy: { tool: p.tool, ...(p.role ? { role: p.role } : {}), rule: p.rule, reason: p.why.slice(0, 300) },
      note: `proposed by the orchestrator brief and confirmed by the human at the objective gate — nothing was installed`,
    });
    if (v.ok) out.push(v.value);
  }
  return out;
}

/** M-ORCH.2 — packets the READY brief marked "no change needed", with the
 *  reason. The caller (the objective gate, after the human confirms) moves
 *  them pending → no-change; nothing else ever does. */
export function noChangePackets(run: WorkRun): Array<{ id: string; reason: string }> {
  const o = run.orchestration;
  if (!o || o.status !== "ready") return [];
  return run.packets
    .filter((p) => p.status === "pending" && o.packetTasks[p.id]?.noChange === true)
    .map((p) => ({ id: p.id, reason: o.packetTasks[p.id].task }));
}

/** M-ORCH.4 — apply the CONFIRMED brief's `after` ordering: each named
 *  packet's entryPointId joins the packet's dependsOn (the same edge the
 *  call graph would have produced), so the scheduler and the failure
 *  cascade treat it exactly like a call dependency. An `after` that would
 *  close a cycle is REFUSED and named — the plan's order stays acyclic.
 *  Pure; idempotent. Returns the problems. */
export function applyBriefOrdering(run: WorkRun): string[] {
  const o = run.orchestration;
  if (!o || o.status !== "ready") return [];
  const problems: string[] = [];
  const byId = new Map(run.packets.map((p) => [p.id, p]));
  const epOf = (id: string) => byId.get(id)?.plan.entryPointId;
  const reaches = (fromEp: string, toEp: string, seen = new Set<string>()): boolean => {
    if (fromEp === toEp) return true;
    if (seen.has(fromEp)) return false;
    seen.add(fromEp);
    const p = run.packets.find((x) => x.plan.entryPointId === fromEp);
    return !!p && p.plan.boundaries.dependsOn.some((d) => reaches(d, toEp, seen));
  };
  for (const p of run.packets) {
    for (const afterId of o.packetTasks[p.id]?.after ?? []) {
      const dep = epOf(afterId);
      if (!dep || dep === p.plan.entryPointId) continue;
      if (p.plan.boundaries.dependsOn.includes(dep)) continue;
      // p must run after `afterId`: adding dep → p is a cycle iff `afterId` already (transitively) depends on p.
      if (reaches(dep, p.plan.entryPointId)) {
        problems.push(`packet ${p.id}: after ${afterId} would close a cycle — dropped`);
        continue;
      }
      p.plan.boundaries.dependsOn = [...p.plan.boundaries.dependsOn, dep].sort();
    }
  }
  return problems;
}

/** M-ORCH.3 — turn the CONFIRMED brief's system-packet proposals into run
 *  packets (kind "system", entryPointId "system:<id>", origin "brief").
 *  Runs after every plan packet that owns one of its files (the same-file
 *  guard would serialise them anyway; the dependency makes the ORDER
 *  explicit) plus the brief's `after` ids. Pure; idempotent (a run that
 *  already carries brief packets gets none twice). */
export function materializeSystemPackets(run: WorkRun): WorkRunPacket[] {
  const proposals = run.orchestration?.status === "ready" ? run.orchestration.extraPackets ?? [] : [];
  if (!proposals.length || run.packets.some((p) => p.plan.origin === "brief")) return [];
  const byId = new Map(run.packets.map((p) => [p.id, p]));
  const maxOrder = Math.max(0, ...run.packets.map((p) => p.plan.order));
  return proposals.map((x, i) => {
    const owners = run.packets
      .filter((p) => p.plan.filesReached.some((f) => x.files.includes(f)))
      .map((p) => p.plan.entryPointId);
    const afterEps = x.after.map((id) => byId.get(id)?.plan.entryPointId).filter((e): e is string => !!e);
    const dependsOn = [...new Set([...owners, ...afterEps])].sort();
    return {
      id: x.id,
      status: "pending",
      attempts: 0,
      evidence: null,
      escalation: null,
      plan: {
        order: maxOrder + i + 1,
        entryPointId: `system:${x.id}`,
        qualifiedName: x.title,
        kind: "system",
        matchedOn: ["orchestrator brief"],
        score: 0,
        filesReached: x.files,
        boundaries: {
          staticallyComplete: false, resolutionGaps: 0, runtimeDispatch: 0, uncaptured: 0,
          dependsOn,
          outsidePlan: { reaches: x.integrates.filter((e) => !run.packets.some((p) => p.plan.entryPointId === e)), reachedBy: [] },
        },
        skill: { status: "none", note: "system packet — no thread, no skill; the brief's handoff and the integration contracts are its context" },
        origin: "brief",
        rationale: x.rationale,
        integrates: x.integrates,
      },
    };
  });
}

/** The unavailable brief — honest fallback when the spawn produced nothing usable. */
export function unavailableBrief(reason: string): WorkRunOrchestration {
  return {
    status: "unavailable", objective: "", packetTasks: {}, globalConstraints: [], storedConstraintIds: [],
    note: `orchestrator brief unavailable (${reason}) — workers receive the generic run task and the human may still confirm the objective as stated`,
  };
}

/** The task text a worker receives for a packet: the brief's, with its
 *  handoff appended as facts to keep — or the generic run-task framing. */
export function packetTaskText(run: WorkRun, packet: WorkRunPacket): { task: string; fromBrief: boolean } {
  // M-ORCH.3 — a system packet's task lives on its proposal, not in packetTasks.
  if (packet.plan.kind === "system") {
    const x = run.orchestration?.extraPackets?.find((e) => e.id === packet.id);
    if (!x) return { task: `SYSTEM PACKET ${packet.id}: ${packet.plan.qualifiedName}`, fromBrief: false };
    const handoff = x.handoff.length
      ? `\n\nHANDOFF from the orchestrator (constraints and data shapes to KEEP):\n${x.handoff.map((h) => `- ${h}`).join("\n")}`
      : "";
    return {
      task: `OBJECTIVE (confirmed by the human): ${run.orchestration!.objective}\n\nSYSTEM PACKET ${x.id} — ${x.title}\nWhy no thread owns this: ${x.rationale || "(no rationale given)"}\n\nYOUR TASK (written by the orchestrator, confirmed by the human): ${x.task}${handoff}`,
      fromBrief: true,
    };
  }
  const brief = run.orchestration?.status === "ready" ? run.orchestration.packetTasks[packet.id] : undefined;
  const generic = `Within this thread, do YOUR PART of the ratified run task below. Parts owned by other packets/threads are NOT yours.\nRUN TASK: ${run.task}\n(this packet matched on: ${packet.plan.matchedOn.join(", ")})`;
  if (!brief) return { task: generic, fromBrief: false };
  const handoff = brief.handoff.length
    ? `\n\nHANDOFF from the orchestrator (constraints and data shapes to KEEP — each is a fact about this thread's boundary):\n${brief.handoff.map((h) => `- ${h}`).join("\n")}`
    : "";
  return {
    task: `OBJECTIVE (confirmed by the human): ${run.orchestration!.objective}\n\nYOUR PACKET (written by the orchestrator): ${brief.task}${handoff}\n(this packet matched on: ${packet.plan.matchedOn.join(", ")})`,
    fromBrief: true,
  };
}

// ── the review ───────────────────────────────────────────────────────────

/** M-ORCH.4 — what the deterministic pre-checks may read besides the
 *  packet and its evidence. */
export interface PreCheckContext {
  /** Files the worker may change (the brief's edit scope, else the thread's files). */
  scope?: string[];
  /** The run's review policy is "pre-checks": a clean packet is APPROVED
   *  here, without a model. Off = the pre-checks only reject/escalate. */
  autoApprove?: boolean;
  /** The packet's entry-point contract summary AFTER the edit: undefined =
   *  not computed (system packet), null = the thread is GONE. */
  contractAfter?: { params: number; returns: string | null } | null;
  /** M-STACK.5 — the tools this packet's edit INTRODUCED, resolved by the
   *  server from the IR delta's new import/include/command nodes
   *  (src/server/stack.ts:toolsAddedByDelta). */
  addedTools?: Array<{
    tool: string; role?: string; origin?: string; file: string; alsoElsewhere?: boolean;
    /** M-BOUNDARY.3 — where the tool turned up: IMPORTED into the file, or
     *  CALLED. A reject that names the call is actionable. */
    site?: "import" | "call"; nodeId?: string; preview?: string; via?: string;
  }>;
  /** M-STACK.5 — the STATED policies routed to this packet. Only the
   *  structured half is checkable; a policy's prose is for the model. */
  policies?: Array<{ id: string; source: string; policy: StackPolicy }>;
  /** M-GRAMMAR — the routed constraints that carry a CHECKABLE half, already
   *  evaluated against the settled IR by the server (which is the side that
   *  has it). `violated` rejects; `unverifiable` goes to the model; `pass`
   *  joins the approval's audit trail. */
  constraintChecks?: Array<{
    id: string; source: string; described: string;
    verdict: "pass" | "violated" | "unverifiable"; reason: string;
    /** Quality layer — may this check REJECT? The three M-GRAMMAR verbs
     *  always may; a Run 1 verb only when its calibration record reads
     *  MAY-GATE (standings.ts); a derived quality-model binding never.
     *  Absent = true (the pre-M-quality shape). A non-gating violated or
     *  unverifiable is an ADVISORY line: recorded, never rejecting, never
     *  spawning a reviewer (RUN1 5.2, the cheaper lane). */
    gates?: boolean;
  }>;
  /** RUN1 4.2 — the contract's unattributed-boundary count before and after the edit. */
  unattributedBefore?: number;
  unattributedAfter?: number;
}

export interface PreCheckReport {
  /** A verdict the pre-checks reached on their own, or null = ask the model. */
  decision: { verdict: "approve" | "reject" | "escalate"; reason: string } | null;
  /** Why the packet needs eyes (empty when `decision` is an approval). */
  needsEyes: string[];
  /** What was verified deterministically (the approval's audit trail). */
  passed: string[];
  /** Quality layer — recorded, never rejecting, never spawning a reviewer:
   *  a non-gating verb's verdict, tests-touched. */
  advisories: string[];
}

/** Deterministic checks that never need a model. Failures decide the
 *  packet without spending a spawn (reject / escalate, as at M-ORCH);
 *  M-ORCH.4 adds the APPROVE path: with `autoApprove`, a packet whose
 *  evidence is clean by every structural measure is approved with
 *  `by: "pre-checks"` — and anything unusual (a system packet, a retry, no
 *  bytes changed, an unparsed file, a changed entry-point signature, a new
 *  resolution gap) is handed to the model with the reasons named. */
export function preCheckReport(packet: WorkRunPacket, evidence: WorkPacketEvidence, ctx: PreCheckContext = {}): PreCheckReport {
  const s = evidence.summary ?? "";
  const fail = (verdict: "reject" | "escalate", reason: string): PreCheckReport => ({ decision: { verdict, reason }, needsEyes: [], passed: [], advisories: [] });
  if (s.startsWith("WORKER SESSION FAILED")) return fail("escalate", "worker session failed — a human must look");
  if (s.startsWith("WORKER BROKE THE OUTPUT CONTRACT")) return fail("escalate", "worker broke the output contract — a human must look");
  const scope = ctx.scope?.length ? ctx.scope : packet.plan.filesReached;
  const outside = evidence.diffs.map((d) => d.file).filter((f) => !scope.includes(f));
  if (outside.length) return fail("reject", `edits outside the packet's ${ctx.scope?.length ? "edit scope" : "files"}: ${outside.join(", ")}`);
  if (ctx.contractAfter === null) return fail("escalate", "the packet's entry point is no longer in the envelope after the edit — a human must look");

  // M-STACK.5 — the STACK check runs whatever the review policy is: a
  // forbidden tool is a fact, not a matter of opinion, and it costs no
  // spawn to find. The reason names the policy AND the alternative, so
  // the bounded retry's RETRY NOTICE tells the worker what to use instead.
  for (const added of ctx.addedTools ?? []) {
    for (const c of ctx.policies ?? []) {
      const p = c.policy;
      if (p.tool !== added.tool) continue;
      if (p.rule !== "forbid" && p.rule !== "replace-with") continue;
      const instead = p.with ? ` Use ${p.with} instead.` : "";
      // M-BOUNDARY.3 — name the SITE. "introduced requests in models.py"
      // sent a worker hunting; "called at module/list_users.fn/get.call:
      // `requests.get(url)`" is the line to change. An import with no call
      // through it yet is a different (smaller) thing, and says so.
      const where = added.site === "call"
        ? `called at ${added.nodeId ?? "?"}${added.preview ? `: \`${added.preview}\`` : ""}${added.via ? `, inside ${added.via}` : ""}`
        : added.site === "import"
          ? `imported at ${added.nodeId ?? "?"} — no call through it yet`
          : null;
      return fail(
        "reject",
        `this edit introduced ${added.tool} in ${added.file}${where ? ` (${where})` : ""}, which policy ${c.id} (${c.source}-stated) ${p.rule === "forbid" ? "forbids" : `says to replace with ${p.with}`}.`
        + `${instead}${p.reason ? ` Reason given: ${p.reason}` : ""}`,
      );
    }
  }

  const needsEyes: string[] = [];
  const passed: string[] = [];
  const advisories: string[] = [];
  // M-GRAMMAR — a constraint with a CHECKABLE half is evaluated against the
  // IR instead of being read as prose. The failure this ends was measured:
  // a reviewer approved "routed through should_notify then notify" while
  // the checker found ingest.py calling notify directly.
  //
  // Three verdicts, and the third is the point. `violated` is a fact, so it
  // costs no spawn to reject on — WHATEVER the review policy. `unverifiable`
  // is NOT a pass — it goes to the model with its reason, because a checker
  // that silently passes what it could not check looks like proof and is not.
  //
  // Quality layer — a check that may not GATE (a Run 1 verb without a
  // MAY-GATE record; a derived quality-model binding) is an ADVISORY line
  // whichever verdict it reaches: recorded in the evidence, never a reject,
  // never a reason to spawn a reviewer (RUN1 5.2: the cheaper lane).
  for (const rc of ctx.constraintChecks ?? []) {
    const gates = rc.gates !== false;
    if (rc.verdict === "violated") {
      if (gates) return fail("reject", `this edit breaks constraint ${rc.id} (${rc.source}-stated): ${rc.described}. ${rc.reason}`);
      advisories.push(`ADVISORY (never rejects; ${rc.source === "derived" ? "derived, uncalibrated" : "uncalibrated or demoted verb"}): ${rc.id} violated — ${rc.described}. ${rc.reason}`);
    } else if (rc.verdict === "unverifiable") {
      if (gates) needsEyes.push(`constraint ${rc.id} (${rc.described}) could not be checked against the IR — ${rc.reason}`);
      else advisories.push(`ADVISORY (never rejects): ${rc.id} unverifiable — ${rc.described}. ${rc.reason}`);
    } else {
      passed.push(`constraint ${rc.id} holds: ${rc.described} — ${rc.reason}`);
    }
  }
  // RUN1 4.2 — loosening-loud: a removed exit, a removed test, a silenced
  // test. Tightening is silent; loosening is never auto-approved.
  needsEyes.push(...looseningLines(evidence));
  // RUN1 4.2 — tests-touched: advisory only. An instance test did not stop
  // a class recurring twice in this repository's own history.
  const tt = testsTouchedLine(evidence);
  if (tt) advisories.push(tt);

  if (!ctx.autoApprove) return { decision: null, needsEyes, passed, advisories };

  // A tool the project has never used before is a dependency decision.
  // Deterministic checks do not take those: the model reads the diff.
  for (const added of ctx.addedTools ?? []) {
    // M-TABLES — `unknown` origin must gate here too. It used to BE
    // "third-party" (every bash command word was), so reading only that
    // string would have quietly stopped reviewing new shell dependencies
    // the day the origin started telling the truth.
    if ((added.origin === "third-party" || added.origin === "unknown") && added.alsoElsewhere === false) {
      needsEyes.push(`new ${added.origin === "unknown" ? "unrecognised" : "third-party"} tool ${added.tool} in ${added.file}`
        + `${added.site === "call" && added.preview ? ` (\`${added.preview}\`)` : ""}`
        + " — the project used it nowhere else");
    }
  }
  if (packet.plan.kind === "system") needsEyes.push("system packet — a new integration point always gets the review");
  if (packet.attempts > 1) needsEyes.push(`attempt ${packet.attempts} after a rejection — the reviewer said what must change`);
  if (evidence.diffs.length === 0) needsEyes.push("no bytes changed — the task may have required a change");
  else passed.push(`${evidence.diffs.length} file(s) changed inside the edit scope (${evidence.diffs.map((d) => d.file).join(", ")})`);
  const deltas = Array.isArray(evidence.irDelta) ? (evidence.irDelta as Array<{ file?: string; delta?: unknown }>) : [];
  const unparsed = evidence.diffs.map((d) => d.file).filter((f) => !deltas.some((x) => x.file === f && x.delta));
  if (unparsed.length) needsEyes.push(`no IR delta for ${unparsed.join(", ")} (did it re-parse?)`);
  else if (evidence.diffs.length) passed.push("every edited file re-parsed and re-linked");
  const before = packet.plan.contract;
  const after = ctx.contractAfter;
  if (!before || after === undefined) needsEyes.push("entry-point contract unavailable for comparison");
  else if (before.params !== after.params || (before.returns ?? null) !== (after.returns ?? null)) {
    needsEyes.push(`entry-point signature changed (${before.params} param(s) → ${after.params}; returns ${before.returns ?? "-"} → ${after.returns ?? "-"})`);
  } else passed.push(`entry-point signature unchanged (${after.params} param(s), returns ${after.returns ?? "-"})`);
  // RUN1 4.2 — no-new-unattributed-boundary: a boundary the attribution
  // rules cannot name is a boundary the checks cannot see.
  if (typeof ctx.unattributedBefore === "number" && typeof ctx.unattributedAfter === "number") {
    if (ctx.unattributedAfter > ctx.unattributedBefore) needsEyes.push(`new unattributed boundaries (${ctx.unattributedBefore} → ${ctx.unattributedAfter})`);
    else passed.push(`no new unattributed boundary (${ctx.unattributedAfter})`);
  }
  const blind = evidence.blindSpots as { totals?: Record<string, number> } | null;
  const b = packet.plan.boundaries as unknown as Record<string, number>;
  if (!blind?.totals) needsEyes.push("no post-edit blind-spot totals");
  else {
    const grew = (["resolutionGaps", "runtimeDispatch", "uncaptured"] as const).filter((k) => (blind.totals![k] ?? 0) > (b[k] ?? 0));
    if (grew.length) needsEyes.push(`new ${grew.map((k) => `${k} (${b[k] ?? 0} → ${blind.totals![k]})`).join(", ")}`);
    else passed.push("no new resolution gaps, runtime dispatch, or uncaptured effects");
  }
  if (needsEyes.length) return { decision: null, needsEyes, passed, advisories };
  passed.push("worker reported done");
  return {
    decision: { verdict: "approve", reason: `pre-checks passed — ${passed.join("; ")}. No model read this diff.` },
    needsEyes: [],
    passed,
    advisories,
  };
}

/** A path the repository treats as a test: a test/tests/__tests__ directory,
 *  a `test_` basename, or a `.test.` / `.spec.` / `_test.` suffix. */
export function isTestFile(path: string): boolean {
  const segs = path.split("/");
  const base = segs[segs.length - 1] ?? "";
  return segs.slice(0, -1).some((s) => s === "test" || s === "tests" || s === "__tests__")
    || /^test_/.test(base) || /\.(test|spec)\.[A-Za-z]+$/.test(base) || /_test\.[A-Za-z]+$/.test(base);
}

const SKIP_MARKER = /^\+.*(\btest\.skip\(|\bit\.skip\(|\bdescribe\.skip\(|\btest\.fixme\(|\bxit\(|\bxdescribe\(|@unittest\.skip|pytest\.mark\.skip|@skip\b)/m;

/** RUN1 4.2 — loosening-loud, from the server-collected evidence: a removed
 *  raise/return node in the IR delta (an exit the code no longer takes), a
 *  removed test function, a skip marker added to a test file's diff. Each
 *  is a needsEyes line: never auto-approved, always named. */
export function looseningLines(evidence: WorkPacketEvidence): string[] {
  const out: string[] = [];
  const deltas = Array.isArray(evidence.irDelta)
    ? (evidence.irDelta as Array<{ file?: string; delta?: { nodesRemoved?: Array<{ id: string; type?: string; name?: string }> } | null }>)
    : [];
  for (const d of deltas) {
    const removed = d.delta?.nodesRemoved ?? [];
    const exits = removed.filter((n) => n.type === "raise_stmt" || n.type === "return_stmt");
    if (exits.length) out.push(`loosening: ${exits.length} raise/return node(s) removed in ${d.file ?? "?"} (${exits.map((n) => n.id).join(", ")}) — a removed exit is never auto-approved`);
    const tests = removed.filter((n) => n.type === "function_def" && (/^test_/.test(n.name ?? "") || isTestFile(d.file ?? "")));
    if (tests.length) out.push(`loosening: test function(s) removed in ${d.file ?? "?"} (${tests.map((n) => n.name ?? n.id).join(", ")})`);
  }
  for (const df of evidence.diffs) {
    if (isTestFile(df.file) && SKIP_MARKER.test(df.diff)) out.push(`loosening: a skip marker was added in ${df.file} — a silenced test is never auto-approved`);
  }
  return out;
}

/** RUN1 4.2 — tests-touched, advisory: the delta changed project files and
 *  no test file. Never a reject and never a reviewer spawn on its own. */
export function testsTouchedLine(evidence: WorkPacketEvidence): string | null {
  const files = evidence.diffs.map((d) => d.file);
  if (!files.length || files.some(isTestFile)) return null;
  return `tests-touched: the delta changed ${files.length} file(s) (${files.join(", ")}) and no test file — advisory only`;
}

/** The M-ORCH shape: a decision or null. Kept for callers and tests that
 *  only need the verdict; the report carries the reasons. */
export function preReviewChecks(packet: WorkRunPacket, evidence: WorkPacketEvidence, ctx: PreCheckContext = {}): { verdict: "approve" | "reject" | "escalate"; reason: string } | null {
  return preCheckReport(packet, evidence, ctx).decision;
}

export function buildReviewPrompt(args: {
  run: WorkRun;
  packet: WorkRunPacket;
  task: string;
  evidence: WorkPacketEvidence;
  contract: string | null;
  constraints: string | null;
  /** M-ORCH.4 — why the deterministic pre-checks handed this packet to the model. */
  preCheckNotes?: string[];
}): string {
  const { run, packet, evidence } = args;
  const assertions = evidence.assertions as { invariants?: string[] } | null;
  const blind = evidence.blindSpots as { totals?: Record<string, number>; staticallyComplete?: boolean } | null;
  let diffText = evidence.diffs.map((d) => `--- ${d.file}\n${d.diff}`).join("\n\n");
  if (diffText.length > DIFF_CAP_CHARS) diffText = diffText.slice(0, DIFF_CAP_CHARS) + "\n[diff truncated — treat the unseen part as UNREVIEWED and lean toward escalate]";
  const parts = [
    "You are the ORCHESTRATOR reviewing ONE packet of a work run whose objective a human confirmed. Decide from the SERVER-COLLECTED evidence — the worker's summary is a self-report ranked below the diffs and the IR delta.",
    "",
    `OBJECTIVE: ${run.orchestration?.objective || run.task}`,
    `PACKET ${packet.id}: ${packet.plan.qualifiedName} (${packet.plan.entryPointId}); files: ${packet.plan.filesReached.join(", ")}; attempt ${packet.attempts}`,
    "",
    "THE TASK THIS WORKER WAS GIVEN:",
    args.task,
    "",
    ...(args.contract ? [args.contract, ""] : []),
    ...(args.constraints ? [args.constraints, ""] : []),
    `WORKER SELF-REPORT (unverified): ${evidence.summary ?? "(none)"}`,
    "",
    `CONFINED DIFFS (${evidence.diffs.length}):`,
    diffText || "(no bytes changed)",
    "",
    `IR DELTA: ${evidence.irDelta ? JSON.stringify(evidence.irDelta).slice(0, 2000) : "(none)"}`,
    `POST-EDIT THREAD INVARIANTS: ${assertions?.invariants?.length ? assertions.invariants.slice(0, 20).join(" | ") : "(none)"}`,
    `POST-EDIT BLIND SPOTS: ${blind?.totals ? JSON.stringify(blind.totals) : "(none)"}${blind?.staticallyComplete === false ? " — NOT statically complete" : ""}`,
    ...(args.preCheckNotes?.length
      ? ["", `WHY THE DETERMINISTIC PRE-CHECKS HANDED THIS TO YOU: ${args.preCheckNotes.join("; ")}`]
      : []),
    "",
    "VERDICT RULES: approve ONLY when the diffs do what the task and handoff ask, stay inside the packet's files, and keep every data shape / constraint named above. reject when the change is wrong or incomplete but a fresh attempt could fix it (ONE bounded retry follows; a second rejection fails the packet — say what the retry must do differently). escalate when a human decision is needed: a constraint or contract conflict, work outside the plan, ambiguity you cannot resolve from the evidence, or no change where one was required. A green structural check proves self-consistency, not conformance to external reality — read the diffs.",
    "",
    "FINISH with exactly one fenced block, the LAST thing you output:",
    "```" + VERDICT_FENCE,
    '{"verdict": "approve" | "reject" | "escalate", "reason": "<one or two sentences a human can audit>"}',
    "```",
  ];
  return parts.join("\n");
}

export function parseVerdict(text: string | null): { verdict: PacketReview["verdict"]; reason: string } | null {
  const raw = lastFence(text, VERDICT_FENCE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
    const v = parsed.verdict;
    if (v !== "approve" && v !== "reject" && v !== "escalate") return null;
    return { verdict: v, reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : "(no reason given)" };
  } catch {
    return null;
  }
}

/** The compact per-thread summaries the brief prompt reads. */
export function briefThreadSummaries(
  run: WorkRun,
  contractFor: (entryPointId: string) => { contract: string | null; constraints: string | null; language: string; stack?: string | null } | null,
): Map<string, BriefThreadSummary> {
  const out = new Map<string, BriefThreadSummary>();
  for (const p of run.packets) {
    const c = contractFor(p.plan.entryPointId);
    out.set(p.plan.entryPointId, {
      entryPointId: p.plan.entryPointId,
      qualifiedName: p.plan.qualifiedName,
      language: c?.language ?? "unknown",
      contract: c?.contract ?? null,
      constraints: c?.constraints ?? null,
      stack: c?.stack ?? null,
    });
  }
  return out;
}
