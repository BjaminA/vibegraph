// The Agent Manager's DEFAULT path (2026-09-29; a CONVERSATION since 2026-10-16): one Claude Code session with
// the VibeGraph hooks — the arrangement h2h4 proved (every rule kept, at a
// tenth of the orchestrated run's time and cost). The server owns the run
// (src/server/hooked_runner.ts); this view starts it, shows what the session
// is doing, and puts the SERVER-collected evidence in front of the person who
// accepts or rejects it. Claude's own summary is shown as what it is: a
// self-report. The orchestrated run is one toggle away (AgentEngineToggle).

import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, CircleDot, Square, Wrench, User, Bot, HelpCircle, ShieldAlert, Send, ClipboardCheck, Compass } from "lucide-react";
import { bridge, type ExtensionMessage } from "./types";
import type { HookedRun, HookedRunEvent, HookedRunFacts, HookedRunPayload } from "../shared/hooked_run_wire";

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


const STATUS_LABEL: Record<HookedRun["status"], string> = {
  running: "Claude is working", waiting: "waiting for you", collecting: "collecting the evidence",
  "awaiting-review": "ready for your review", accepted: "accepted", rejected: "rejected", failed: "failed",
};

function StatusLine({ run }: { run: HookedRun }) {
  const s = { size: 16, strokeWidth: 1.5 } as const;
  const icon = run.status === "accepted" ? <CheckCircle2 {...s} color="var(--accent-thread)" />
    : run.status === "rejected" || run.status === "failed" ? <XCircle {...s} color="var(--accent-error)" />
      : run.status === "awaiting-review" || run.status === "waiting" ? <AlertTriangle {...s} color="var(--accent-warning)" />
        : <CircleDot {...s} color="var(--accent-thread)" />;
  const t = run.totals;
  return (
    <div data-hooked-status={run.status} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "var(--fs-12)" }}>
      <span className="vg-keep-accent" style={{ display: "flex" }}>{icon}</span>
      <span style={{ fontWeight: 600 }}>{STATUS_LABEL[run.status]}</span>
      <span style={{ ...small, fontFamily: mono }}>
        {run.model} · hooks {run.hooks === "project" ? "from the project's own settings" : "injected for this run"}
        {t ? ` · $${t.costUsd.toFixed(2)}${run.costCap ? ` of $${run.costCap}` : ""} · ${t.messages} message${t.messages === 1 ? "" : "s"} · ${t.turns} turns` : ""}
      </span>
    </div>
  );
}

/** Consecutive tool calls fold into one row; everything else is a message. */
type Item = { kind: "tools"; list: string[] } | { kind: Exclude<HookedRunEvent["kind"], "tool">; text: string };
function fold(events: HookedRunEvent[]): Item[] {
  const out: Item[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (e.kind === "tool") { if (last?.kind === "tools") last.list.push(e.text); else out.push({ kind: "tools", list: [e.text] }); }
    else out.push({ kind: e.kind, text: e.text });
  }
  return out;
}

const bubble = (accent: string | null): React.CSSProperties => ({
  border: `1px solid ${accent ? `color-mix(in oklab, ${accent} 45%, transparent)` : "var(--border-edge)"}`,
  background: accent ? `color-mix(in oklab, ${accent} 10%, transparent)` : "var(--bg-canvas)",
  borderRadius: 8, padding: "8px 12px", display: "flex", gap: 8, alignItems: "flex-start", maxWidth: "88%",
  fontSize: "var(--fs-12)", lineHeight: 1.5, color: "var(--text-primary)",
});
const ico = { size: 16, strokeWidth: 1.5, style: { flexShrink: 0, marginTop: 1 } } as const;

function Message({ item }: { item: Item }) {
  if (item.kind === "tools") {
    return (
      <details data-hooked-event="tool" className="vg-msg-enter" style={{ fontFamily: mono, fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
        <summary style={{ cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}>
          <Wrench size={16} strokeWidth={1.5} />{item.list.length} tool call{item.list.length === 1 ? "" : "s"} · {item.list[item.list.length - 1]}
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0 0 24px" }}>{item.list.map((t, i) => <span key={i}>{t}</span>)}</div>
      </details>
    );
  }
  const text = <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{item.text}</span>;
  switch (item.kind) {
    case "you": return <div data-hooked-event="you" className="vg-msg-enter" style={{ ...bubble("var(--accent-thread)"), alignSelf: "flex-end" }}><User {...ico} color="var(--accent-thread)" />{text}</div>;
    case "question": return (
      <div data-hooked-event="question" className="vg-msg-enter vg-keep-accent" style={{ ...bubble("var(--accent-warning)"), alignSelf: "flex-start", flexDirection: "column", gap: 4 }}>
        <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "var(--fs-11)", fontWeight: 600, color: "var(--accent-warning)" }}><HelpCircle {...ico} />Claude asks you</span>{text}
      </div>
    );
    case "blocked": return <div data-hooked-event="blocked" className="vg-msg-enter" style={{ display: "flex", gap: 8, fontSize: "var(--fs-11)", fontFamily: mono, color: "var(--accent-warning)" }}><ShieldAlert {...ico} />{text}</div>;
    case "error": return <div data-hooked-event="error" className="vg-msg-enter" style={{ display: "flex", gap: 8, fontSize: "var(--fs-11)", fontFamily: mono, color: "var(--accent-error)" }}><XCircle {...ico} />{text}</div>;
    default: return <div data-hooked-event="text" className="vg-msg-enter" style={{ ...bubble(null), alignSelf: "flex-start" }}><Bot {...ico} color="var(--text-muted)" />{text}</div>;
  }
}

function Conversation({ run }: { run: HookedRun }) {
  const items = fold(run.events);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [run.events.length]);
  if (!items.length) return <span style={small}>Starting Claude Code…</span>;
  return (
    <div data-hooked-events role="log" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
      <div data-hooked-event="you" style={{ ...bubble("var(--accent-thread)"), alignSelf: "flex-end" }}><User {...ico} color="var(--accent-thread)" /><span style={{ whiteSpace: "pre-wrap" }}>{run.task}</span></div>
      {items.map((it, i) => <Message key={i} item={it} />)}
      <div ref={end} />
    </div>
  );
}

/** When Claude ends a turn: answer it, add to the task, or finish for review. */
function Composer({ run }: { run: HookedRun }) {
  const [text, setText] = useState("");
  const lastYou = run.events.map((e) => e.kind).lastIndexOf("you");
  const asked = run.events.slice(lastYou + 1).some((e) => e.kind === "question");
  const spent = run.totals?.costUsd ?? 0;
  const over = run.costCap != null && spent >= run.costCap;
  const send = () => { if (text.trim() && !over) { bridge.postMessage({ type: "hooked-run-reply", payload: { text } } as never); setText(""); } };
  return (
    <div data-hooked-composer style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea data-hooked-reply value={text} onChange={(e) => setText(e.target.value)} rows={3} disabled={over}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
        placeholder={asked ? "Answer Claude's question…  (Ctrl+Enter to send)" : "Reply, or add to the task…  (Ctrl+Enter to send)"}
        style={{ resize: "vertical", background: "var(--bg-canvas)", color: "var(--text-primary)", border: `1px solid ${asked ? "color-mix(in oklab, var(--accent-warning) 55%, transparent)" : "var(--border-edge)"}`, borderRadius: 8, padding: 8, fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)" }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button data-hooked-send onClick={send} disabled={!text.trim() || over} style={{ ...btnStyle("var(--accent-thread)"), display: "flex", gap: 4, alignItems: "center", opacity: !text.trim() || over ? 0.5 : 1 }}><Send size={16} strokeWidth={1.5} />Send</button>
        <button data-hooked-finish onClick={() => bridge.postMessage({ type: "hooked-run-finish" } as never)} style={{ ...btnStyle("var(--accent-warning)"), display: "flex", gap: 4, alignItems: "center" }}><ClipboardCheck size={16} strokeWidth={1.5} />Finish and review</button>
        <span style={small}>{over ? `the $${run.costCap} cost cap is reached — finish and review` : "Claude is waiting for you; the session stays open until you finish it"}</span>
      </div>
    </div>
  );
}

/** What the run will be told about the project — before it starts. */
function Knows({ facts }: { facts: HookedRunFacts }) {
  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, fontSize: "var(--fs-12)", lineHeight: 1.5 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span><span style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
  return (
    <div data-hooked-knows style={{ border: "1px solid var(--border-edge)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "var(--fs-12)", fontWeight: 600 }}><Compass size={16} strokeWidth={1.5} />What Claude will be told</span>
      {row("Objective", facts.objective ?? <span style={small}>none stated — the Plan panel sets one</span>)}
      {row("Stated rules", facts.rules ? `${facts.rules}, each sent with the thread it applies to; an edit that breaks one is stopped` : <span style={small}>none — the Rules panel states one</span>)}
      {facts.waiting > 0 && row("Waiting for you", `${facts.waiting} decision${facts.waiting === 1 ? "" : "s"} — Claude is told not to decide them`)}
      {facts.openQuestions.length > 0 && row("Open questions", facts.openQuestions.map((q) => q.id).join(", ") + " — Claude says if its work answers one")}
      {row("Direction", [facts.projectDirection ? `${facts.projectDirection} agreed rule${facts.projectDirection === 1 ? "" : "s"} of this project's own` : "", facts.direction.length ? `generic: ${facts.direction.join(", ")}` : ""].filter(Boolean).join(" · ") || <span style={small}>none yet — the Direction panel reads it from the code</span>)}
      {row("Tools", "the VibeGraph tools (thread brief, coverage, blast radius, dataflow, plan) — none that spend extra tokens or start other agents")}
    </div>
  );
}

export function HookedRunView({ taskInput }: { taskInput: (value: string, onChange: (v: string) => void) => React.ReactNode }) {
  const [state, setState] = useState<HookedRunPayload>({ run: null });
  const [task, setTask] = useState("");
  useEffect(() => {
    const onMsg = (m: ExtensionMessage) => {
      if ((m as { type: string }).type !== "hooked-run") return;
      const p = (m as unknown as { payload: HookedRunPayload }).payload;
      setState((s) => ({ ...p, facts: p.facts ?? s.facts }));
    };
    bridge.onMessage(onMsg);
    bridge.postMessage({ type: "hooked-run-get" } as never);
    return () => bridge.removeListener(onMsg);
  }, []);
  const run = state.run;
  const live = run?.status === "running" || run?.status === "waiting" || run?.status === "collecting";
  const reviewing = run?.status === "awaiting-review";
  const start = () => { if (task.trim()) bridge.postMessage({ type: "hooked-run-start", payload: { task } } as never); };

  return (
    <div data-hooked-run style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!live && !reviewing && (
        <>
          <span style={{ ...small, fontSize: "var(--fs-12)" }}>
            A conversation with one Claude Code session that has VibeGraph's hooks: each message brings the contracts, stated rules and
            skills of the threads it names, every edit is re-checked, and when Claude needs a decision it asks you here. The project is
            snapshotted first; when you finish, you see the changes and the checks, then accept or reject.
          </span>
          {state.facts && <Knows facts={state.facts} />}
          {taskInput(task, setTask)}
          <div><button data-hooked-start onClick={start} style={btnStyle("var(--accent-thread)")}>Start with Claude Code</button></div>
        </>
      )}
      {state.error && <span data-hooked-error style={{ fontSize: "var(--fs-11)", color: "var(--accent-error)" }}>{state.error}</span>}
      {run && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--border-edge)", paddingTop: 12 }}>
          <StatusLine run={run} />
          {run.note && <span data-hooked-note style={small}>{run.note}</span>}
          <Conversation run={run} />
          {run.status === "waiting" && <Composer run={run} />}
          {(run.status === "running" || run.status === "waiting") && (
            <div><button data-hooked-stop onClick={() => bridge.postMessage({ type: "hooked-run-stop" } as never)} style={{ ...btnStyle("var(--accent-error)"), display: "flex", gap: 4, alignItems: "center" }}>
              <Square size={16} strokeWidth={1.5} />Stop
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
        {/* 2026-10-16 — the run changed the rules themselves: checked above against the rules as they stood */}
        {!!run.check?.rulesChanged?.length && (
          <div data-hooked-rules-changed style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
            <span style={{ fontSize: "var(--fs-11)", color: "var(--accent-warning)", fontWeight: 600 }}>The run changed the stated rules — checked above against the rules as they stood before it; Reject puts them back</span>
            {run.check.rulesChanged.map((t) => <span key={t} style={{ fontSize: "var(--fs-11)", color: "var(--accent-warning)", fontFamily: mono }}>{t}</span>)}
          </div>
        )}
      </div>
      <div data-hooked-changes>
        <div style={{ fontSize: "var(--fs-12)", fontWeight: 600, marginBottom: 4 }}>{changes.length} file(s) changed</div>
        {changes.map((c) => (
          <details key={c.file} data-hooked-change={c.file} style={{ marginBottom: 4 }}>
            <summary style={{ cursor: "pointer", fontFamily: mono, fontSize: "var(--fs-11)" }}>
              <span style={{ color: c.status === "added" ? "var(--accent-thread)" : c.status === "deleted" ? "var(--accent-error)" : "var(--text-primary)" }}>{c.status}</span> {c.file}
              {c.stated && <span data-hooked-stated style={{ color: "var(--accent-warning)" }}> · what the project states (a person's decision)</span>}
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
