// M-ORCH (PLAN-M-CONTRACT.md) — the OBJECTIVE gate: in orchestrated mode
// the human confirms ONE thing — the orchestrator's brief (objective,
// each packet's task + constraint handoff, the global constraints it
// states) — and delegates every packet review to the orchestrator.
// Renders server state only; the confirm/discard buttons live in the
// parent gate so both modes share one ratify message. Honest states:
// "drafting" (confirm disabled — the human has not seen it), "ready",
// "unavailable" (workers fall back to the generic run task; the human
// may still confirm the bare task).

import React from "react";
import { Compass } from "lucide-react";
import type { WorkRun } from "../shared/protocol";

const mono = "var(--font-mono)";

export function OrchestrationGate({ run }: { run: WorkRun }) {
  const o = run.orchestration;
  const status = o?.status ?? "drafting";
  const tone = status === "ready" ? "var(--accent-thread)" : status === "unavailable" ? "var(--accent-error)" : "var(--text-muted)";
  return (
    <div data-orchestration-gate data-orchestration-status={status}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Compass size={14} strokeWidth={1.5} color={tone} />
        <span style={{ fontSize: "var(--fs-12)", fontWeight: 700 }}>Orchestrator brief</span>
        <span style={{ fontSize: "var(--fs-11)", fontFamily: mono, color: tone }}>{status}</span>
      </div>
      {status === "drafting" && (
        <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
          The orchestrator is reading each packet's thread contract and writing its task and handoff. Confirm becomes available when the objective is here.
        </span>
      )}
      {status === "unavailable" && (
        <span style={{ fontSize: "var(--fs-11)", color: "var(--accent-error)", lineHeight: 1.5 }}>{o?.note}</span>
      )}
      {status === "ready" && o && (
        <>
          <div data-orchestration-objective style={{ fontSize: "var(--fs-12)", lineHeight: 1.5 }}>
            <span style={{ color: "var(--text-muted)", fontFamily: mono }}>objective · </span>{o.objective}
          </div>
          {run.packets.map((p) => {
            const t = o.packetTasks[p.id];
            return (
              <div key={p.id} data-orchestration-packet={p.id} style={{
                borderLeft: "2px solid color-mix(in oklab, var(--accent-thread) 45%, transparent)",
                paddingLeft: 10, display: "flex", flexDirection: "column", gap: 4,
              }}>
                <span style={{ fontSize: "var(--fs-11)", fontFamily: mono, color: "var(--text-muted)" }}>
                  {p.id} · {p.plan.qualifiedName}
                  {t?.noChange && (
                    <span data-orchestration-nochange={p.id} style={{
                      marginLeft: 8, color: "var(--text-muted)",
                      border: "1px solid color-mix(in oklab, var(--text-muted) 45%, transparent)",
                      borderRadius: 4, padding: "1px 6px",
                    }}>no change needed — no worker will run</span>
                  )}
                </span>
                <span style={{ fontSize: "var(--fs-12)", lineHeight: 1.5 }}>
                  {t ? t.task : "(no brief task — this worker receives the generic run task)"}
                </span>
                {/* M-ORCH.4 — the EDIT SCOPE the brief declared: the files this worker may change (others in its thread are read-only; disjoint scopes run in parallel). */}
                {t && !t.noChange && t.files && t.files.length > 0 && (
                  <span data-orchestration-scope={p.id} style={{ fontSize: "var(--fs-11)", fontFamily: mono, color: "var(--text-muted)" }}>
                    edits only · {t.files.join(", ")}
                  </span>
                )}
                {t && t.handoff.length > 0 && (
                  <ul data-orchestration-handoff style={{ margin: 0, paddingLeft: 16, fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {t.handoff.map((h, i) => <li key={i}>{h}</li>)}
                  </ul>
                )}
              </div>
            );
          })}
          {o.globalConstraints.length > 0 && (
            <div data-orchestration-globals style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 }}>
              <span style={{ fontFamily: mono }}>global constraints (stored as orchestrator-stated on confirm) · </span>
              {o.globalConstraints.map((g, i) => <span key={i}>[{g.kind}] {g.text}{i < o.globalConstraints.length - 1 ? "; " : ""}</span>)}
            </div>
          )}
          {(o.extraPackets?.length ?? 0) > 0 && (
            <div data-orchestration-system-packets style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "var(--fs-11)", fontFamily: mono, color: "var(--accent-warning)" }}>
                system packets proposed — work no thread owns; confirming creates them as packets
              </span>
              {o.extraPackets!.map((x) => (
                <div key={x.id} data-orchestration-system-packet={x.id} style={{
                  borderLeft: "2px solid color-mix(in oklab, var(--accent-warning) 55%, transparent)",
                  paddingLeft: 10, display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <span style={{ fontSize: "var(--fs-11)", fontFamily: mono, color: "var(--text-muted)" }}>
                    {x.id} · {x.title} · files: {x.files.join(", ")}{x.after.length ? ` · after ${x.after.join(", ")}` : ""}
                  </span>
                  <span style={{ fontSize: "var(--fs-12)", lineHeight: 1.5 }}>{x.task}</span>
                  <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    why: {x.rationale || "(none given)"}{x.integrates.length ? ` · integrates ${x.integrates.join(", ")}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* M-STACK.4 — TOOLS the objective needs that the stack lacks.
              Proposed, never assumed: confirming stores each as a
              stack-policy constraint (source orchestrator); nothing is
              installed, and the alternatives it rejected are shown so the
              human is confirming a decision, not a preference. */}
          {(o.stackProposals?.length ?? 0) > 0 && (
            <div data-orchestration-stack-proposals style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "var(--fs-11)", fontFamily: mono, color: "var(--accent-warning)" }}>
                new tools proposed — the project stack does not provide these; confirming states them as policies, it installs nothing
              </span>
              {o.stackProposals!.map((s) => (
                <div key={s.tool} data-orchestration-stack-proposal={s.tool} style={{
                  borderLeft: "2px solid color-mix(in oklab, var(--accent-warning) 55%, transparent)",
                  paddingLeft: 10, display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <span style={{ fontSize: "var(--fs-11)", fontFamily: mono, color: "var(--text-muted)" }}>
                    {s.rule} {s.tool}{s.role ? ` · ${s.role}` : ""}
                  </span>
                  <span style={{ fontSize: "var(--fs-12)", lineHeight: 1.5 }}>{s.why}</span>
                  <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {s.alternatives.length
                      ? `considered instead: ${s.alternatives.map((a) => `${a.tool} — ${a.whyNot || "no reason given"}`).join("; ")}`
                      : "no alternatives were named — this is a preference, not a decision"}
                  </span>
                </div>
              ))}
            </div>
          )}
          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", fontFamily: mono }}>{o.note}</span>
        </>
      )}
      <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 }}>
        Confirming delegates every packet review to the orchestrator. Escalations, broken output contracts, and a silent reviewer still return to you; you can pause at any time.
      </span>
    </div>
  );
}
