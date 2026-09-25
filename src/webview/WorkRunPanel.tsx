// M-AGENT2 (PLAN-M-AGENT.md) — the Agent Manager run board. A portal
// dialog (RoadmapOverviewDialog pattern) rendering the durable WorkRun
// that rides the envelope: launch form → ratification gate → packet
// cards advancing serially → per-packet evidence gate → honest outcome.
//
// The board SENDS gate messages and renders state; every transition is
// server-side (src/server/work_run.ts) — the two human gates are
// structural, not UI sugar. Aesthetic: Family 1 teal carries the run
// (it IS the user's program being worked); amber is reserved for the
// review gate + escalations (genuine treat-with-care); red only for
// failed. No spinners (no infinite loops): "running" is a static
// accent state the next envelope will move.

import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Bot, CircleDashed, CircleDot, ShieldQuestion, CheckCircle2,
  XCircle, AlertTriangle, MinusCircle, Play, Pause,
} from "lucide-react";
import type { WorkRun, WorkRunPacket, WorkRunMode, ConstraintRecord, StackIndexRecord } from "../shared/protocol";
import { bridge } from "./types";
// M-CONTRACT.3 / M-ORCH — split out to keep this file under the 500-line rule.
import { ConstraintsPanel } from "./ConstraintsPanel";
import { OrchestrationGate } from "./OrchestrationGate";

const mono = "var(--font-mono)";

function StatusGlyph({ status }: { status: WorkRunPacket["status"] }) {
  const s = { size: 14, strokeWidth: 1.5 } as const;
  switch (status) {
    case "pending": return <CircleDashed {...s} color="var(--text-muted)" />;
    case "running": return <CircleDot {...s} color="var(--accent-thread)" />;
    case "awaiting-review": return <ShieldQuestion {...s} color="var(--accent-warning)" />;
    case "done": return <CheckCircle2 {...s} color="var(--accent-thread)" />;
    case "failed": return <XCircle {...s} color="var(--accent-error)" />;
    case "escalated": return <AlertTriangle {...s} color="var(--accent-warning)" />;
    case "skipped": return <MinusCircle {...s} color="var(--text-muted)" />;
    // M-ORCH.2 — settled by the confirmed brief, no worker ran: a quiet tick.
    case "no-change": return <CheckCircle2 {...s} color="var(--text-muted)" />;
  }
}

function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warn" }) {
  const color = tone === "warn" ? "var(--accent-warning)" : "var(--text-muted)";
  return (
    <span style={{
      fontSize: "var(--fs-11)", fontFamily: mono, color,
      border: `1px solid color-mix(in oklab, ${color} 45%, transparent)`,
      borderRadius: 4, padding: "1px 6px",
    }}>{children}</span>
  );
}

function countLabel(x: unknown): string {
  if (Array.isArray(x)) return String(x.length);
  if (x && typeof x === "object") return String(Object.keys(x).length);
  return "—";
}

function GateButton(props: {
  label: string; dataAttr: string; accent: string; onClick: () => void;
}) {
  return (
    <button
      {...{ [props.dataAttr]: true }}
      onClick={props.onClick}
      style={{
        background: `color-mix(in oklab, ${props.accent} 16%, transparent)`,
        border: `1px solid color-mix(in oklab, ${props.accent} 55%, transparent)`,
        borderRadius: 4, color: props.accent, padding: "4px 12px",
        cursor: "pointer", fontSize: "var(--fs-11)", fontFamily: mono, fontWeight: 600,
      }}
    >{props.label}</button>
  );
}

function PacketCard({ packet, orderIdx }: { packet: WorkRunPacket; orderIdx: number }) {
  const gated = packet.status === "awaiting-review";
  const escalated = packet.status === "escalated";
  const b = packet.plan.boundaries;
  const review = (approve: boolean) =>
    bridge.postMessage({ type: "work-run-review", payload: { packetId: packet.id, approve } });
  return (
    <div
      data-packet-card={packet.id}
      data-packet-status={packet.status}
      style={{
        display: "flex", flexDirection: "column", gap: 8,
        border: `1px solid ${gated || escalated
          ? "color-mix(in oklab, var(--accent-warning) 55%, transparent)"
          : "var(--border-edge)"}`,
        borderRadius: 10, padding: "10px 14px",
        opacity: packet.status === "skipped" ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <StatusGlyph status={packet.status} />
        <span style={{ fontSize: "var(--fs-12)", fontWeight: 700 }}>
          {orderIdx}. {packet.plan.qualifiedName}
        </span>
        <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", fontFamily: mono }}>
          {packet.status}{packet.attempts > 1 ? ` · attempt ${packet.attempts}` : ""}
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {packet.plan.matchedOn.slice(0, 4).map((t) => <Chip key={t}>{t}</Chip>)}
        {packet.plan.boundaries.dependsOn.map((d) => <Chip key={d}>after {d}</Chip>)}
        {b.resolutionGaps > 0 && <Chip tone="warn">{b.resolutionGaps} resolution gap(s)</Chip>}
        {b.runtimeDispatch > 0 && <Chip tone="warn">{b.runtimeDispatch} runtime dispatch</Chip>}
        {packet.plan.skill.status !== "none" && <Chip>skill: {packet.plan.skill.status}</Chip>}
        {/* M-ORCH.3 — a system packet: no thread; proposed by the brief, confirmed by the human. */}
        {packet.plan.kind === "system" && (
          <span data-packet-system title={packet.plan.rationale ?? ""}>
            <Chip tone="warn">system packet · {packet.plan.filesReached.join(", ")}</Chip>
          </span>
        )}
        {/* M-CONTRACT — compact contract facts; M-ORCH — who reviewed, and how. */}
        {packet.plan.contract && packet.plan.contract.roundTrips > 0 && (
          <Chip tone="warn">{packet.plan.contract.roundTrips} loop round-trip(s)</Chip>
        )}
        {packet.plan.contract && packet.plan.contract.constraints > 0 && (
          <Chip>{packet.plan.contract.constraints} constraint(s)</Chip>
        )}
        {packet.review && (
          <span data-packet-review-by={packet.review.by} data-packet-review-verdict={packet.review.verdict}
            title={packet.review.reason}>
            <Chip tone={packet.review.verdict === "approve" ? "muted" : "warn"}>
              {packet.review.by}: {packet.review.verdict}
            </Chip>
          </span>
        )}
      </div>

      {escalated && packet.escalation && (
        <div data-packet-escalation style={{
          border: "1px solid color-mix(in oklab, var(--accent-warning) 45%, transparent)",
          borderRadius: 6, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6,
        }}>
          <span style={{ fontSize: "var(--fs-11)", color: "var(--accent-warning)", fontFamily: mono }}>
            ESCALATED — {packet.escalation.reason}
          </span>
          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
            The agent stopped at its boundary instead of guessing. Resolve it (in chat, or by hand), then record the outcome:
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <GateButton label="Discuss in chat" dataAttr="data-escalation-chat"
              accent="var(--accent-chat)"
              onClick={() => {
                // M-AGENT4 — hand the packet's full context to the chat
                // as a PREFILL only (the human reviews and sends; the
                // chat's Claude has the remit-routing + MCP tools to
                // investigate). The escalation card stays open — the
                // outcome is still recorded HERE, by the human.
                const b = packet.plan.boundaries;
                document.dispatchEvent(new CustomEvent("vg-chat-prefill", {
                  detail: {
                    text: `An Agent Manager packet escalated and needs a decision.\n`
                      + `Thread: ${packet.plan.qualifiedName} (${packet.plan.entryPointId})\n`
                      + `Reason: ${packet.escalation?.reason ?? "(none given)"}\n`
                      + `Outside-plan boundary: reaches ${b.outsidePlan.reaches.join(", ") || "—"}; reached by ${b.outsidePlan.reachedBy.join(", ") || "—"}\n`
                      + `Help me resolve it; I will record done/failed on the packet card afterwards.`,
                  },
                }));
              }} />
            <GateButton label="Resolved — count as done" dataAttr="data-escalation-resolve"
              accent="var(--accent-thread)" onClick={() => review(true)} />
            <GateButton label="Mark failed" dataAttr="data-escalation-fail"
              accent="var(--accent-error)" onClick={() => review(false)} />
          </div>
        </div>
      )}

      {gated && packet.evidence && (
        <div data-packet-evidence style={{
          borderTop: "1px solid var(--border-edge)", paddingTop: 8,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", fontFamily: mono }}>
            worker self-report (ranked below the structural facts):
          </span>
          <div style={{ fontSize: "var(--fs-12)", lineHeight: 1.5 }}>
            {packet.evidence.summary ?? "(none)"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip>{packet.evidence.diffs.length} confined diff(s)</Chip>
            <Chip>assertions: {countLabel(packet.evidence.assertions)}</Chip>
            <Chip>blind spots: {countLabel(packet.evidence.blindSpots)}</Chip>
            <Chip>{packet.evidence.irDelta ? "IR delta captured" : "no IR delta"}</Chip>
          </div>
          {packet.evidence.diffs.map((d, i) => (
            <pre key={i} style={{
              fontSize: "var(--fs-11)", fontFamily: mono, color: "var(--text-primary)",
              background: "color-mix(in oklab, var(--bg-canvas) 60%, transparent)",
              border: "1px solid var(--border-edge)", borderRadius: 6,
              padding: 8, margin: 0, maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap",
            }}><span style={{ color: "var(--text-muted)" }}>{d.file}{"\n"}</span>{d.diff}</pre>
          ))}
          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
            A green structural check proves self-consistency, not conformance to external reality — read the diffs.
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <GateButton label="Approve" dataAttr="data-packet-approve"
              accent="var(--accent-thread)" onClick={() => review(true)} />
            <GateButton label="Reject" dataAttr="data-packet-reject"
              accent="var(--accent-error)" onClick={() => review(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkRunPanel({ open, onClose, run, constraints = [], stack, policyPrefill, onPolicyPrefillConsumed }: {
  open: boolean; onClose: () => void; run: WorkRun | null; constraints?: ConstraintRecord[];
  // M-STACK.2 — the facts feed the constraint form's tool scope; the
  // prefill is the Stack panel's "state a policy" handoff.
  stack?: StackIndexRecord | null;
  policyPrefill?: { tool: string; role?: string } | null;
  onPolicyPrefillConsumed?: () => void;
}) {
  const [task, setTask] = useState("");
  const [newRunForm, setNewRunForm] = useState(false);
  // M-ORCH — the launch choice: gated (every packet reviewed by you) or
  // orchestrated (you confirm the objective; the orchestrator reviews).
  const [mode, setMode] = useState<WorkRunMode>("gated");
  // M-ORCH.4 — lanes (packets in flight at once; only disjoint edit scopes
  // share them) and the review policy. Gated stays serial unless asked.
  const [lanes, setLanes] = useState(3);
  const [fullReview, setFullReview] = useState(false);
  // AUTONOMY — no human gate at all: the server confirms the objective
  // when the brief lands and resolves escalations as failed packets.
  const [autonomous, setAutonomous] = useState(false);
  if (!open) return null;

  const finished = run && (run.status === "done" || run.status === "failed");
  const showForm = !run || (finished && newRunForm);
  const orchestrated = run?.mode === "orchestrated";
  const start = () => {
    if (!task.trim()) return;
    bridge.postMessage({
      type: "work-run-start",
      payload: mode === "orchestrated"
        ? { task, mode, parallel: lanes, review: fullReview ? "full" : "pre-checks", ...(autonomous ? { autonomous: true } : {}) }
        : { task, mode },
    });
    setNewRunForm(false);
  };

  return createPortal(
    <>
      <div
        data-work-run-backdrop
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 1149,
          background: "color-mix(in oklab, var(--bg-canvas) 35%, transparent)",
          backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
        }}
      />
      <div
        role="dialog"
        aria-label="Agent Manager"
        data-work-run-panel
        data-run-status={run?.status ?? "none"}
        style={{
          position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
          width: "min(880px, 92vw)", maxHeight: "86vh", zIndex: 1150,
          background: "var(--bg-node)", border: "1px solid var(--border-edge)",
          borderRadius: 12, boxShadow: "var(--shadow-panel)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          fontFamily: "var(--font-ui)", color: "var(--text-primary)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "12px 20px", borderBottom: "1px solid var(--border-edge)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <Bot size={16} strokeWidth={1.5} color="var(--accent-thread)" />
          <span style={{ fontSize: "var(--fs-13)", fontWeight: 700 }}>Agent Manager</span>
          {run && (
            <span data-run-status-label style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", fontFamily: mono }}>
              {run.status} · {run.packets.filter((p) => p.status === "done").length}/{run.packets.length} packets
            </span>
          )}
          <span style={{ marginLeft: "auto" }} />
          {run?.status === "running" && (
            <button data-work-run-pause title="Pause between packets"
              onClick={() => bridge.postMessage({ type: "work-run-pause", payload: {} })}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}>
              <Pause size={15} strokeWidth={1.5} />
            </button>
          )}
          {run?.status === "paused" && (
            <button data-work-run-resume title="Resume"
              onClick={() => bridge.postMessage({ type: "work-run-resume", payload: {} })}
              style={{ background: "none", border: "none", color: "var(--accent-thread)", cursor: "pointer", padding: 2 }}>
              <Play size={15} strokeWidth={1.5} />
            </button>
          )}
          <button data-work-run-close onClick={onClose} title="Close"
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {showForm ? (
            <>
              <span style={{ fontSize: "var(--fs-12)", color: "var(--text-muted)", lineHeight: 1.5 }}>
                Describe the task. It decomposes DETERMINISTICALLY onto the threads whose remit it names
                (lexical match over the IR — name the code: backticked symbols, file names, node ids).
                Nothing runs until you {mode === "orchestrated" ? "confirm the objective" : "ratify the plan"}.
              </span>
              {/* M-ORCH — the launch choice is explicit, never a default the human did not see. */}
              <div data-work-run-mode={mode} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <GateButton label="Gated — you review every packet" dataAttr="data-work-run-mode-gated"
                  accent={mode === "gated" ? "var(--accent-thread)" : "var(--text-muted)"} onClick={() => setMode("gated")} />
                <GateButton label="Orchestrated — you confirm the objective; the orchestrator reviews" dataAttr="data-work-run-mode-orchestrated"
                  accent={mode === "orchestrated" ? "var(--accent-thread)" : "var(--text-muted)"} onClick={() => setMode("orchestrated")} />
              </div>
              {mode === "orchestrated" && (
                <>
                  <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    The orchestrator reads each packet's thread contract (data in/out, calls, round trips) and the stated constraints,
                    writes every worker's task and handoff, and reviews each packet's evidence. Escalations, broken output
                    contracts, and a silent reviewer still come back to you.
                  </span>
                  {/* M-ORCH.4 — lanes + review policy: explicit choices the human sees before confirming. */}
                  <div data-work-run-lanes={lanes} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      lanes
                      <select data-work-run-lanes-select value={lanes} onChange={(e) => setLanes(Number(e.target.value))}
                        style={{ background: "var(--bg-node)", color: "var(--text-primary)", border: "1px solid var(--border-edge)", borderRadius: 4, fontFamily: mono, fontSize: "var(--fsm-12)", padding: "2px 4px" }}>
                        {[1, 2, 3, 4].map((n) => <option key={n} value={n}>×{n}</option>)}
                      </select>
                      <span>packets with disjoint edit scopes run at once</span>
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" data-work-run-review-full checked={fullReview} onChange={(e) => setFullReview(e.target.checked)} />
                      full review of every packet (otherwise deterministic pre-checks approve clean packets without a model)
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" data-work-run-autonomous checked={autonomous} onChange={(e) => setAutonomous(e.target.checked)} />
                      autonomous — no human gate: the orchestrator confirms the objective under a recorded ruling, and an escalation ends its packet as failed with the reason kept
                    </label>
                  </div>
                </>
              )}
              <ConstraintsPanel constraints={constraints} stack={stack ?? undefined}
                prefill={policyPrefill} onPrefillConsumed={onPolicyPrefillConsumed} />
              <TaskInput value={task} onChange={setTask} />
              <div>
                <GateButton label="Plan the run" dataAttr="data-work-run-start"
                  accent="var(--accent-thread)" onClick={start} />
              </div>
            </>
          ) : run && (
            <>
              <div style={{ fontSize: "var(--fs-12)", lineHeight: 1.5 }}>
                <span style={{ color: "var(--text-muted)", fontFamily: mono }}>task · </span>{run.task}
                <span data-run-mode style={{ color: "var(--text-muted)", fontFamily: mono }}> · {run.mode ?? "gated"}</span>
                {/* M-ORCH.4 — lanes and review policy are facts of the run, shown with it. */}
                <span data-run-lanes={run.parallel ?? 1} style={{ color: "var(--text-muted)", fontFamily: mono }}> · lanes ×{run.parallel ?? 1}</span>
                {run.review && <span data-run-review={run.review} style={{ color: "var(--text-muted)", fontFamily: mono }}> · review: {run.review}</span>}
              </div>

              {run.status === "draft" && (
                <div data-work-run-gate style={{
                  border: "1px solid color-mix(in oklab, var(--accent-warning) 50%, transparent)",
                  borderRadius: 10, padding: "12px 16px",
                  display: "flex", flexDirection: "column", gap: 8,
                }}>
                  <span style={{ fontSize: "var(--fs-12)", fontWeight: 700, color: "var(--accent-warning)" }}>
                    {orchestrated ? "Objective gate — nothing has run" : "Ratification gate — nothing has run"}
                  </span>
                  {orchestrated && <OrchestrationGate run={run} />}
                  <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {run.planNote}
                  </span>
                  {run.unmatchedTokens.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: "var(--fs-11)", color: "var(--accent-warning)" }}>NOT covered:</span>
                      {run.unmatchedTokens.map((t) => <Chip key={t} tone="warn">{t}</Chip>)}
                    </div>
                  )}
                  {run.cycles.length > 0 && (
                    <Chip tone="warn">{run.cycles.length} dependency cycle(s) — order inside them is score-ranked</Chip>
                  )}
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {orchestrated && run.orchestration?.status === "drafting" ? (
                      // Not a disabled button: the affordance appears only once the objective exists.
                      <span data-work-run-ratify-waiting style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", fontFamily: mono }}>
                        confirm becomes available when the brief is ready
                      </span>
                    ) : (
                      <GateButton
                        label={orchestrated
                          ? `Confirm objective & run ${run.packets.length} packet(s)`
                          : `Ratify & run ${run.packets.length} packet(s)`}
                        dataAttr="data-work-run-ratify" accent="var(--accent-thread)"
                        onClick={() => bridge.postMessage({ type: "work-run-ratify", payload: {} })} />
                    )}
                    <GateButton label="Discard draft" dataAttr="data-work-run-discard"
                      accent="var(--accent-error)"
                      onClick={() => bridge.postMessage({ type: "work-run-discard", payload: {} })} />
                  </div>
                </div>
              )}

              <ConstraintsPanel constraints={constraints} stack={stack ?? undefined}
                prefill={policyPrefill} onPrefillConsumed={onPolicyPrefillConsumed} />

              {[...run.packets]
                .sort((a, b) => a.plan.order - b.plan.order)
                .map((p) => <PacketCard key={p.id} packet={p} orderIdx={p.plan.order} />)}

              {finished && (
                <div data-work-run-outcome style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      fontSize: "var(--fs-12)", fontWeight: 700, fontFamily: mono,
                      color: run.status === "done" ? "var(--accent-thread)" : "var(--accent-error)",
                    }}>
                      run {run.status}
                      {run.status === "failed" ? " — an incomplete run never claims success" : ""}
                    </span>
                    <GateButton label="New run" dataAttr="data-work-run-new"
                      accent="var(--accent-thread)" onClick={() => setNewRunForm(true)} />
                  </div>
                  {run.summary && (
                    <div data-work-run-summary style={{
                      fontSize: "var(--fs-11)", color: "var(--text-muted)",
                      fontFamily: mono, lineHeight: 1.5,
                    }}>
                      {run.summary.note}
                      {run.summary.filesChanged.length > 0 && (
                        <> Files changed (approved work only): {run.summary.filesChanged.join(", ")}.</>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

// The task box grows with what is typed and never shrinks below three rows:
// it sits in a scrolling flex column, where a textarea (itself a scroll
// container, so its min-height is 0) was squeezed to a sliver that cut the
// placeholder in half. The column scrolls; the box never does.
function TaskInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      data-work-run-task
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="e.g. harden `create_user` and `list_users` in app.py"
      rows={3}
      style={{
        flexShrink: 0, boxSizing: "border-box", width: "100%",
        minHeight: 3 * 20 + 2 * 12 + 2, overflow: "hidden", resize: "none",
        background: "color-mix(in oklab, var(--bg-canvas) 60%, transparent)",
        border: "1px solid var(--border-edge)", borderRadius: 8,
        color: "var(--text-primary)", fontFamily: mono, fontSize: "var(--fsm-12)", lineHeight: "20px",
        padding: 12,
      }}
    />
  );
}
