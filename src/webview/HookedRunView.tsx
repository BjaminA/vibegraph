// The Agent Manager's DEFAULT path (2026-09-29): one Claude Code session with
// the VibeGraph hooks — the arrangement h2h4 proved (every rule kept, at a
// tenth of the orchestrated run's time and cost). The server owns the run
// (src/server/hooked_runner.ts); this view starts it, shows what the session
// is doing, and puts the SERVER-collected evidence in front of the person who
// accepts or rejects it. Claude's own summary is shown as what it is: a
// self-report. The orchestrated run is one toggle away (AgentEngineToggle).

import React, { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, CircleDot, Square, Wrench, MessageSquare } from "lucide-react";
import { bridge, type ExtensionMessage } from "./types";
import type { HookedRun, HookedRunPayload } from "../shared/hooked_run_wire";

const mono = "var(--font-mono)";
const small: React.CSSProperties = { fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 };

export type AgentEngine = "hooked" | "orchestrated";
const ENGINE_KEY = "vg-agent-engine";

/** Which engine the panel shows: the hooked run by default, the legacy
 *  orchestrated one when chosen — or when a legacy run is still live, so it
 *  is never hidden behind the new default. */
export function useAgentEngine(legacyLive: boolean): [AgentEngine, (e: AgentEngine) => void] {
  const [engine, setEngineState] = useState<AgentEngine>(() => {
    if (legacyLive) return "orchestrated";
    let saved: string | null = null;
    try { saved = localStorage.getItem(ENGINE_KEY); } catch { /* no storage */ }
    // A viewer's own choice wins; else the server's (VG_AGENT_ENGINE).
    const first = saved ?? document.querySelector('meta[name="vg-agent-engine"]')?.getAttribute("content");
    return first === "orchestrated" ? "orchestrated" : "hooked";
  });
  const setEngine = (e: AgentEngine) => {
    setEngineState(e);
    try { localStorage.setItem(ENGINE_KEY, e); } catch { /* per-viewer convenience */ }
  };
  return [engine, setEngine];
}

export function AgentEngineToggle({ engine, onChange }: { engine: AgentEngine; onChange: (e: AgentEngine) => void }) {
  const btn = (e: AgentEngine, label: string, title: string) => (
    <button
      data-agent-engine={e}
      data-active={engine === e ? "true" : "false"}
      title={title}
      onClick={() => onChange(e)}
      style={{
        border: `1px solid ${engine === e ? "color-mix(in oklab, var(--accent-thread) 55%, transparent)" : "var(--border-edge)"}`,
        background: engine === e ? "color-mix(in oklab, var(--accent-thread) 16%, transparent)" : "transparent",
        color: engine === e ? "var(--accent-thread)" : "var(--text-secondary)",
        borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontSize: "var(--fs-11)", fontFamily: mono,
      }}
    >{label}</button>
  );
  return (
    <div data-agent-engine-toggle style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {btn("hooked", "Claude Code + hooks (recommended)", "One Claude Code session with the VibeGraph hooks: contracts, rules and skills delivered per prompt; every edit re-checked")}
      {btn("orchestrated", "Orchestrated (legacy)", "Plan → packets → workers → review: the earlier Agent Manager, kept as it was")}
    </div>
  );
}

const btnStyle = (accent: string): React.CSSProperties => ({
  background: `color-mix(in oklab, ${accent} 16%, transparent)`,
  border: `1px solid color-mix(in oklab, ${accent} 55%, transparent)`,
  borderRadius: 4, color: accent, padding: "4px 12px",
  cursor: "pointer", fontSize: "var(--fs-11)", fontFamily: mono, fontWeight: 600,
});

function StatusLine({ run }: { run: HookedRun }) {
  const s = { size: 14, strokeWidth: 1.5 } as const;
  const icon = run.status === "accepted" ? <CheckCircle2 {...s} color="var(--accent-thread)" />
    : run.status === "rejected" || run.status === "failed" ? <XCircle {...s} color="var(--accent-error)" />
      : run.status === "awaiting-review" ? <AlertTriangle {...s} color="var(--accent-warning)" />
        : <CircleDot {...s} color="var(--accent-thread)" />;
  const r = run.result;
  return (
    <div data-hooked-status={run.status} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "var(--fs-12)" }}>
      {icon}
      <span style={{ fontWeight: 600 }}>{run.status === "collecting" ? "collecting the evidence" : run.status}</span>
      <span style={{ ...small, fontFamily: mono }}>
        {run.model} · hooks {run.hooks === "project" ? "from the project's own settings" : "injected for this run"}
        {r?.durationMs != null ? ` · ${Math.round(r.durationMs / 1000)} s` : ""}
        {r?.costUsd != null ? ` · $${r.costUsd.toFixed(2)}` : ""}
        {r?.turns != null ? ` · ${r.turns} turns` : ""}
      </span>
    </div>
  );
}

function Events({ run }: { run: HookedRun }) {
  const shown = run.events.slice(-40);
  if (!shown.length) return <span style={small}>Starting Claude Code…</span>;
  return (
    <div data-hooked-events style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 220, overflowY: "auto", fontFamily: mono, fontSize: "var(--fs-11)" }}>
      {run.events.length > shown.length && <span style={small}>… {run.events.length - shown.length} earlier</span>}
      {shown.map((e, i) => (
        <div key={i} data-hooked-event={e.kind} style={{
          display: "flex", gap: 6, alignItems: "flex-start",
          color: e.kind === "blocked" ? "var(--accent-warning)" : e.kind === "error" ? "var(--accent-error)" : e.kind === "text" ? "var(--text-secondary)" : "var(--text-primary)",
        }}>
          {e.kind === "tool" ? <Wrench size={12} strokeWidth={1.5} style={{ marginTop: 2, flexShrink: 0 }} />
            : e.kind === "text" ? <MessageSquare size={12} strokeWidth={1.5} style={{ marginTop: 2, flexShrink: 0 }} />
              : <AlertTriangle size={12} strokeWidth={1.5} style={{ marginTop: 2, flexShrink: 0 }} />}
          <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

function Evidence({ run }: { run: HookedRun }) {
  const changes = run.changes ?? [];
  const introduced = run.check?.introduced ?? [];
  return (
    <div data-hooked-evidence style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...small }}>
        Collected by VibeGraph after the session ended — not Claude's account of itself.
      </div>
      <div data-hooked-checks>
        <div style={{ fontSize: "var(--fs-12)", fontWeight: 600, marginBottom: 4 }}>Stated rules</div>
        {introduced.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {introduced.map((t) => <span key={t} data-hooked-introduced style={{ fontSize: "var(--fs-11)", color: "var(--accent-error)", fontFamily: mono }}>newly violated: {t}</span>)}
          </div>
        ) : (
          <span data-hooked-rules-clean style={{ fontSize: "var(--fs-11)", color: "var(--accent-thread)", fontFamily: mono }}>
            {run.check?.rows.length ? `no stated rule newly violated (${run.check.rows.length} clause(s) checked)` : "no checkable rule is stated for this project"}
          </span>
        )}
        {!!run.check?.inherited && <div style={small}>{run.check.inherited} violation(s) were already there before the run.</div>}
        {!!run.check?.fixed.length && <div style={small}>Fixed by the run: {run.check.fixed.join(", ")}.</div>}
      </div>
      <div data-hooked-changes>
        <div style={{ fontSize: "var(--fs-12)", fontWeight: 600, marginBottom: 4 }}>{changes.length} file(s) changed</div>
        {changes.map((c) => (
          <details key={c.file} data-hooked-change={c.file} style={{ marginBottom: 4 }}>
            <summary style={{ cursor: "pointer", fontFamily: mono, fontSize: "var(--fs-11)" }}>
              <span style={{ color: c.status === "added" ? "var(--accent-thread)" : c.status === "deleted" ? "var(--accent-error)" : "var(--text-primary)" }}>{c.status}</span> {c.file}
            </summary>
            {c.diff && (
              <pre style={{ margin: "4px 0 0", maxHeight: 240, overflow: "auto", background: "var(--bg-canvas)", border: "1px solid var(--border-edge)", borderRadius: 4, padding: 8, fontFamily: mono, fontSize: "var(--fs-11)", color: "var(--text-secondary)" }}>{c.diff}</pre>
            )}
          </details>
        ))}
      </div>
      <div data-hooked-tests style={small}>
        {run.tests?.length ? `Discovered tests that reach the changes: ${run.tests.join(", ")}.` : "No discovered test reaches the changed files."}
      </div>
      {run.result?.text && (
        <div data-hooked-self-report>
          <div style={{ fontSize: "var(--fs-12)", fontWeight: 600, marginBottom: 4 }}>Claude's summary <span style={small}>(a self-report)</span></div>
          <div style={{ fontSize: "var(--fs-11)", color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 200, overflowY: "auto" }}>{run.result.text}</div>
        </div>
      )}
    </div>
  );
}

export function HookedRunView({ taskInput }: { taskInput: (value: string, onChange: (v: string) => void) => React.ReactNode }) {
  const [state, setState] = useState<HookedRunPayload>({ run: null });
  const [task, setTask] = useState("");
  useEffect(() => {
    const onMsg = (m: ExtensionMessage) => {
      if ((m as { type: string }).type !== "hooked-run") return;
      setState((m as unknown as { payload: HookedRunPayload }).payload);
    };
    bridge.onMessage(onMsg);
    bridge.postMessage({ type: "hooked-run-get" } as never);
    return () => bridge.removeListener(onMsg);
  }, []);
  const run = state.run;
  const live = run?.status === "running" || run?.status === "collecting";
  const reviewing = run?.status === "awaiting-review";
  const start = () => { if (task.trim()) bridge.postMessage({ type: "hooked-run-start", payload: { task } } as never); };

  return (
    <div data-hooked-run style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!live && !reviewing && (
        <>
          <span style={{ ...small, fontSize: "var(--fs-12)" }}>
            One Claude Code session with VibeGraph's hooks: each prompt gets the contracts, stated rules and ratified skills of
            the threads it names, and every edit is re-checked — a new violation of a stated rule is stopped and explained.
            The project is snapshotted first; when the session ends you see the changes and the checks, then accept or reject.
          </span>
          {taskInput(task, setTask)}
          <div><button data-hooked-start onClick={start} style={btnStyle("var(--accent-thread)")}>Run with Claude Code</button></div>
        </>
      )}
      {state.error && <span data-hooked-error style={{ fontSize: "var(--fs-11)", color: "var(--accent-error)" }}>{state.error}</span>}
      {run && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border-edge)", paddingTop: 12 }}>
          <div style={{ fontSize: "var(--fs-12)", lineHeight: 1.5 }}><span style={{ ...small, fontFamily: mono }}>task · </span>{run.task}</div>
          <StatusLine run={run} />
          {run.note && <span data-hooked-note style={small}>{run.note}</span>}
          <Events run={run} />
          {run.status === "running" && (
            <div><button data-hooked-stop onClick={() => bridge.postMessage({ type: "hooked-run-stop" } as never)} style={btnStyle("var(--accent-error)")}>
              <Square size={11} strokeWidth={2} style={{ marginRight: 4, verticalAlign: -1 }} />Stop
            </button></div>
          )}
          {(reviewing || run.status === "accepted" || run.status === "rejected") && <Evidence run={run} />}
          {reviewing && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button data-hooked-accept onClick={() => bridge.postMessage({ type: "hooked-run-decide", payload: { accept: true } } as never)} style={btnStyle("var(--accent-thread)")}>Accept — keep the changes</button>
              <button data-hooked-reject onClick={() => bridge.postMessage({ type: "hooked-run-decide", payload: { accept: false } } as never)} style={btnStyle("var(--accent-error)")}>Reject — restore the snapshot</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
