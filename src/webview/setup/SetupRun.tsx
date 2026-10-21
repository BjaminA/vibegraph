// The setup guide's "Run all" and "Run the next step" (2026-10-21, Ben: "go to
// the next step button in gui still just takes to the plan page - please fix
// and add a run all button"). The server says what Claude can run now and what
// waits for a person (src/server/setup_run.ts); a run is one task the app
// follows (tasks/guiTasks.ts), so it carries on with the guide closed and the
// bubble over the chat button says when it ends. Nothing runs without the
// confirmation that lists every model call first.

import React, { useEffect, useState } from "react";
import { Check, AlertTriangle, Sparkles, Hand } from "lucide-react";
import { bridge, type ExtensionMessage } from "../types";
import { dismissGuiTask, useGuiTask } from "../tasks/guiTasks";
import { WorkingCard } from "../tasks/WorkingCard";
import { btn, ico, quiet, tag } from "./styles";

export interface SetupActionWire { key: string; kind: string; step: string; label: string; spends: boolean; urls?: string[] }
interface PreviewWire { actions: SetupActionWire[]; waits: string[] }
interface RunResult { ran?: Array<{ label: string; detail: string }>; failed?: Array<{ label: string; error: string }>; waits?: string[] }

export interface SetupRunState {
  preview: PreviewWire | null;
  /** the actions for one step, or every action ("all"), waiting for the confirmation */
  confirm: string | null;
  ask: (what: string | null) => void;
  running: boolean;
}

/** What Claude can run now, the run in progress, and the confirmation. */
export function useSetupRun(): SetupRunState & { start: () => void; error: string | null; task: ReturnType<typeof useGuiTask> } {
  const [preview, setPreview] = useState<PreviewWire | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const task = useGuiTask("setup");
  const running = task?.state === "running";
  useEffect(() => {
    const on = (m: ExtensionMessage) => {
      const x = m as unknown as { type: string; payload?: { action?: string; ok?: boolean; error?: string } & Partial<PreviewWire> };
      if (x.type !== "setup-run-result" || !x.payload) return;
      if (x.payload.action === "preview" && x.payload.ok) setPreview({ actions: x.payload.actions ?? [], waits: x.payload.waits ?? [] });
      else if (x.payload.action === "run" && !x.payload.ok) setError(x.payload.error ?? "the run could not start");
    };
    bridge.onMessage(on);
    return () => bridge.removeListener(on);
  }, []);
  // asked again whenever a run ends: what it made possible, and the "now"
  useEffect(() => {
    if (running) return;
    bridge.postMessage({ type: "setup-run-preview", payload: {} } as never);
    if (task) bridge.postMessage({ type: "now-get" } as never);
  }, [running, task?.id]);
  const start = () => {
    setError(null);
    bridge.postMessage({ type: "setup-run", payload: confirm && confirm !== "all" ? { only: confirm } : {} } as never);
    setConfirm(null);
  };
  return { preview, confirm, ask: (w) => { setError(null); setConfirm(w); }, running, start, error, task };
}

/** The run in progress, its result, or the confirmation, above the guide's buttons. */
export function SetupRunPanel({ run }: { run: ReturnType<typeof useSetupRun> }) {
  const { task, preview, confirm } = run;
  if (task?.state === "running") {
    return <WorkingCard data-setup-running="" title={task.label} startedAt={task.startedAt} steps={task.steps}
      note="It carries on if you close this guide; the bubble over the chat button says when it ends." />;
  }
  if (confirm && preview) {
    const actions = confirm === "all" ? preview.actions : preview.actions.filter((a) => a.step === confirm);
    const calls = actions.filter((a) => a.spends).length;
    return (
      <div data-setup-confirm={confirm} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 8, border: "1px solid var(--border-edge)" }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-13)", color: "var(--text-primary)" }}>
          {calls ? `${calls} model call${calls === 1 ? "" : "s"}, one after another:` : "Nothing here asks Claude:"}
        </span>
        <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
          {actions.map((a) => (
            <li key={a.key} data-setup-action={a.key} style={{ ...quiet, color: "var(--text-secondary)" }}>
              {a.label} {a.spends && <span style={tag("var(--accent-chat)")}><Sparkles {...ico} />asks Claude</span>}
            </li>
          ))}
        </ol>
        <span style={quiet}>
          A classification can bring more packages to specify; they join the same run. Everything it proposes waits for you to ratify.
          {confirm === "all" && preview.waits.length ? ` It stops where a decision is yours: ${preview.waits[0]}${preview.waits.length > 1 ? ` (and ${preview.waits.length - 1} more)` : ""}.` : ""}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" data-setup-run-confirm onClick={run.start} style={btn(true)}>{calls ? "Run them" : "Run it"}</button>
          <button type="button" onClick={() => run.ask(null)} style={btn()}>Cancel</button>
        </div>
      </div>
    );
  }
  const result = task?.result as RunResult | undefined;
  if (task && (task.state === "failed" || result)) {
    return (
      <div data-setup-run-result={task.state} style={{ display: "flex", flexDirection: "column", gap: 4, padding: 12, borderRadius: 8, border: "1px solid var(--border-edge)" }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-13)", color: "var(--text-primary)" }}>{task.state === "failed" ? `The run stopped: ${task.error}` : `The run ended: ${task.summary}`}</span>
        {(result?.ran ?? []).map((r) => <span key={r.label} style={{ ...quiet, display: "flex", gap: 8 }}><Check {...ico} color="var(--accent-thread)" style={{ flexShrink: 0 }} />{r.label}: {r.detail}</span>)}
        {(result?.failed ?? []).map((r) => <span key={r.label} style={{ ...quiet, display: "flex", gap: 8 }}><AlertTriangle {...ico} color="var(--accent-warning)" style={{ flexShrink: 0 }} />{r.label}: {r.error}</span>)}
        {(result?.waits ?? []).map((w) => <span key={w} style={{ ...quiet, display: "flex", gap: 8 }}><Hand {...ico} style={{ flexShrink: 0 }} />{w}</span>)}
        <button type="button" data-setup-run-clear onClick={() => dismissGuiTask(task.id)} style={{ ...btn(), alignSelf: "flex-start", marginTop: 4 }}>Clear</button>
      </div>
    );
  }
  if (run.error) return <span data-setup-run-error style={{ ...quiet, color: "var(--accent-warning)" }}>{run.error}</span>;
  return null;
}
