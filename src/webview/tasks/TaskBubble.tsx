// Over the chat button: what Claude is doing for you now, and what it
// finished (2026-10-21, Ben: "perhaps a message over the chat icon in bottom
// right will be useful if a task is running or complete"). A task runs on the
// server whatever panel is open (src/server/gui_tasks.ts); this is where it
// is seen from anywhere. A running task is a compact WorkingCard; a finished
// one stays until it is opened or dismissed, so a result is never missed
// because its panel was closed.

import React from "react";
import { Check, AlertTriangle, X } from "lucide-react";
import { dismissGuiTask, isGuiTaskSeen, markGuiTaskSeen, useGuiTasks, type GuiTask } from "./guiTasks";
import { WorkingCard } from "./WorkingCard";

const text: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", lineHeight: 1.5, overflowWrap: "anywhere" };

export function TaskBubble({ onOpen, lifted, rightInset = 20, onScreen = [] }: {
  onOpen: (task: GuiTask) => void;
  /** the chat is open below: sit above it, as the chat button does */
  lifted: boolean;
  rightInset?: number;
  /** where a task is shown already ("rules", "map"): its running card is not repeated here */
  onScreen?: string[];
}) {
  const tasks = useGuiTasks().filter((t) => (t.state === "running" ? !onScreen.includes(t.open) : !isGuiTaskSeen(t.id)));
  if (!tasks.length) return null;
  const open = (t: GuiTask) => { if (t.state !== "running") markGuiTaskSeen(t.id); onOpen(t); };
  return (
    <div data-task-bubble style={{
      position: "fixed", right: rightInset, zIndex: 1020, width: 320, display: "flex", flexDirection: "column", gap: 8,
      // above the 42 px chat button (FloatingToggle), which itself lifts over an open chat
      bottom: lifted ? "calc(var(--vg-chat-height, 320px) + 58px)" : 70,
    }}>
      {tasks.map((t) => t.state === "running" ? (
        <WorkingCard key={t.id} data-task-running={t.kind} compact title={t.label} startedAt={t.startedAt} steps={t.steps} onClick={() => open(t)} />
      ) : (
        <div key={t.id} data-task-finished={t.kind} data-task-state={t.state} className="vg-msg-enter" style={{
          display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderRadius: 12, background: "var(--bg-node)",
          border: `1px solid ${t.state === "done" ? "var(--accent-chat)" : "var(--accent-error)"}`, boxShadow: "var(--shadow-panel)",
        }}>
          {t.state === "done"
            ? <Check size={16} strokeWidth={1.5} color="var(--accent-chat)" style={{ flex: "0 0 auto", marginTop: 2 }} />
            : <AlertTriangle size={16} strokeWidth={1.5} color="var(--accent-error)" style={{ flex: "0 0 auto", marginTop: 2 }} />}
          <button type="button" data-task-open={t.kind} onClick={() => open(t)} title="Open where it is decided"
            style={{ flex: "1 1 auto", textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--text-primary)" }}>
            <div style={{ ...text, fontWeight: 600 }}>{t.state === "done" ? `${t.label}: done` : `${t.label}: failed`}</div>
            <div data-task-summary style={{ ...text, color: "var(--text-secondary)" }}>{t.state === "done" ? t.summary : t.error}</div>
          </button>
          <button type="button" data-task-dismiss={t.kind} onClick={() => dismissGuiTask(t.id)} aria-label="Dismiss"
            style={{ flex: "0 0 auto", background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  );
}
