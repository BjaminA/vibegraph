// The setup guide's run (2026-10-21, Ben: "go to the next step button in gui
// still just takes to the plan page - please fix and add a run all button";
// 2026-10-22: "instead of run next step and run all - lets select all tasks
// aside from the plan - user can then deselect or reselect by clicking the
// highlighted chip. then just one simple run button ... serial ... each task
// at a time"). The server says what Claude can run now and what waits for a
// person (src/server/setup_run.ts). Every step it can run starts SELECTED;
// its chip in the guide takes it out or puts it back; Run takes the selected
// steps in the setup's order, one model call at a time, as one task the app
// follows (tasks/guiTasks.ts): it carries on with the guide closed, and the
// bubble over the chat button says when it ends.

import React, { useEffect, useState } from "react";
import { Check, AlertTriangle, Hand } from "lucide-react";
import { bridge, type ExtensionMessage } from "../types";
import { dismissGuiTask, useGuiTask } from "../tasks/guiTasks";
import { WorkingCard } from "../tasks/WorkingCard";
import { btn, ico, quiet } from "./styles";

export interface SetupActionWire { key: string; kind: string; step: string; label: string; spends: boolean; urls?: string[]; github?: string }
/** github: whether this machine has a GitHub login, and the owners already granted (github_docs.ts) */
export interface PreviewWire { actions: SetupActionWire[]; waits: string[]; github?: { login: string | null; granted: string[] } }
interface RunResult { ran?: Array<{ label: string; detail: string }>; failed?: Array<{ label: string; error: string; needs?: { github: string } }>; waits?: string[]; held?: { error: string; labels: string[] } }

export function useSetupRun() {
  const [preview, setPreview] = useState<PreviewWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  // what the person took OUT: a step that becomes runnable later starts selected
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const task = useGuiTask("setup");
  const running = task?.state === "running";
  useEffect(() => {
    const on = (m: ExtensionMessage) => {
      const x = m as unknown as { type: string; payload?: { action?: string; ok?: boolean; error?: string } & Partial<PreviewWire> };
      if (x.type !== "setup-run-result" || !x.payload) return;
      if (x.payload.action === "preview" && x.payload.ok) setPreview({ actions: x.payload.actions ?? [], waits: x.payload.waits ?? [], ...(x.payload.github ? { github: x.payload.github } : {}) });
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
  const actions = preview?.actions ?? [];
  /** the steps Claude can run now, in the setup's order */
  const runnable = [...new Set(actions.map((a) => a.step))];
  const selected = runnable.filter((s) => !deselected.has(s));
  const send = (steps: string[], grantGithub: string[]) => {
    setError(null);
    bridge.postMessage({ type: "setup-run", payload: { steps, ...(grantGithub.length ? { grantGithub } : {}) } } as never);
  };
  return {
    preview, error, task, running, runnable, selected,
    isSelected: (step: string) => runnable.includes(step) && !deselected.has(step),
    toggle: (step: string) => setDeselected((d) => { const n = new Set(d); if (n.has(step)) n.delete(step); else n.add(step); return n; }),
    /** GitHub owners ticked under the software step: the person's grant of their login */
    grants, toggleGrant: (o: string) => setGrants((g) => { const n = new Set(g); if (n.has(o)) n.delete(o); else n.add(o); return n; }),
    start: () => { send(selected, [...grants]); setGrants(new Set()); },
    /** a failed step a grant would let through: grant it, and run the software step again */
    retryWithGrant: (o: string) => send(["software"], [o]),
  };
}
export type SetupRun = ReturnType<typeof useSetupRun>;

/** The run in progress, or how it ended, above the guide's buttons. */
export function SetupRunPanel({ run }: { run: SetupRun }) {
  const { task } = run;
  if (task?.state === "running") {
    return <WorkingCard data-setup-running="" title={task.label} startedAt={task.startedAt} steps={task.steps}
      note="One step at a time, in order. It carries on if you close this guide; the bubble over the chat button says when it ends." />;
  }
  const result = task?.result as RunResult | undefined;
  if (task && (task.state === "failed" || result)) {
    return (
      <div data-setup-run-result={task.state} style={{ display: "flex", flexDirection: "column", gap: 4, padding: 12, borderRadius: 8, border: "1px solid var(--border-edge)" }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-13)", color: "var(--text-primary)" }}>{task.state === "failed" ? `The run stopped: ${task.error}` : `The run ended: ${task.summary}`}</span>
        {(result?.ran ?? []).map((r) => <span key={r.label} style={{ ...quiet, display: "flex", gap: 8 }}><Check {...ico} color="var(--accent-thread)" style={{ flexShrink: 0 }} />{r.label}: {r.detail}</span>)}
        {(result?.failed ?? []).map((r) => (
          <span key={r.label} style={{ ...quiet, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <AlertTriangle {...ico} color="var(--accent-warning)" style={{ flexShrink: 0 }} />{r.label}: {r.error}
            {r.needs?.github && (
              <button type="button" data-setup-retry-github={r.needs.github} onClick={() => run.retryWithGrant(r.needs!.github)} style={{ ...btn(), padding: "4px 8px" }}>
                Use my GitHub login for {r.needs.github} and try again
              </button>
            )}
          </span>
        ))}
        {/* RC6 — the model call failed once, before the run: the steps that need it, and why */}
        {result?.held?.labels.length ? (
          <span data-setup-run-held style={{ ...quiet, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <AlertTriangle {...ico} color="var(--accent-warning)" style={{ flexShrink: 0 }} />Not run, as the model call failed: {result.held.labels.join("; ")}. {result.held.error}
          </span>
        ) : null}
        {(result?.waits ?? []).map((w) => <span key={w} style={{ ...quiet, display: "flex", gap: 8 }}><Hand {...ico} style={{ flexShrink: 0 }} />{w}</span>)}
        <button type="button" data-setup-run-clear onClick={() => dismissGuiTask(task.id)} style={{ ...btn(), alignSelf: "flex-start", marginTop: 4 }}>Clear</button>
      </div>
    );
  }
  if (run.error) return <span data-setup-run-error style={{ ...quiet, color: "var(--accent-warning)" }}>{run.error}</span>;
  return null;
}
