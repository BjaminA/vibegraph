// One step of the setup guide (SetupGuide.tsx). A step Claude can run now
// carries a chip that is highlighted while the step is selected for the run;
// clicking it takes the step out or puts it back (SetupRun.tsx). A step that
// waits for the person opens where it is decided from its status chip. What a
// selected step will do is listed under it, so the run spends nothing unsaid.

import React from "react";
import { Check, Clock, Circle, Sparkles, UserCheck, BookOpen } from "lucide-react";
import type { NowPanel, SetupStepSummary } from "../../shared/now_wire";
import type { SetupRun } from "./SetupRun";
import { ico, quiet, tag } from "./styles";

const STATE: Record<SetupStepSummary["status"], { label: string; accent: string; icon: React.ReactNode }> = {
  done: { label: "done", accent: "var(--accent-thread)", icon: <Check {...ico} /> },
  waiting: { label: "waiting for you", accent: "var(--accent-warning)", icon: <Clock {...ico} /> },
  todo: { label: "to do", accent: "var(--text-secondary)", icon: <Circle {...ico} /> },
  optional: { label: "optional", accent: "var(--text-muted)", icon: <Circle {...ico} /> },
  skipped: { label: "set aside", accent: "var(--text-muted)", icon: <Circle {...ico} /> },
};

// a chip that is a button keeps the tag's own size (no `font` shorthand: it reset the size)
const chipButton: React.CSSProperties = { cursor: "pointer", background: "transparent" };

export function SetupStepRow({ step: s, index, run, onGo, onHooks }: {
  step: SetupStepSummary;
  index: number;
  run: SetupRun;
  /** open where a waiting step is decided */
  onGo: (now: { panel: NowPanel | null }) => void;
  /** the hooks are installed from a terminal: show the command */
  onHooks: () => void;
}) {
  const st = STATE[s.status];
  const actions = (run.preview?.actions ?? []).filter((a) => a.step === s.id);
  const runnable = actions.length > 0 && !run.running;
  const selected = run.isSelected(s.id);
  const free = actions.length > 0 && actions.every((a) => !a.spends);
  const owners = selected ? [...new Set(actions.map((a) => a.github).filter((o): o is string => !!o && !run.preview?.github?.granted.includes(o)))] : [];
  // the status chip opens where the step is decided, when the person is who it waits for
  const goes = s.id === "hooks" ? s.status === "todo" || s.status === "waiting" : s.status === "waiting";
  const status = goes
    ? <button type="button" data-setup-go={s.id} onClick={() => (s.id === "hooks" ? onHooks() : onGo(s.now))} title={s.id === "hooks" ? "Show the command" : "Open where this is decided"} style={{ ...tag(st.accent), ...chipButton }}>{st.icon}{st.label}</button>
    : <span style={tag(st.accent)}>{st.icon}{st.label}</span>;
  const accent = free ? "var(--accent-thread)" : "var(--accent-chat)";
  return (
    <li data-setup-step={s.id} data-setup-status={s.status} data-setup-selected={runnable ? String(selected) : undefined}
      style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "8px 12px", borderRadius: 8, border: `1px ${s.after ? "dashed" : "solid"} ${selected && runnable ? `color-mix(in oklab, ${accent} 45%, var(--border-edge))` : "var(--border-edge)"}` }}>
      <span style={{ ...quiet, fontFamily: "var(--font-mono)", minWidth: 16 }}>{index + 1}</span>
      <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-13)", color: "var(--text-primary)" }}>{s.title}</span>
        {s.now.text && s.status !== "done" && <span style={quiet}>{s.now.text}</span>}
        {selected && runnable && (
          <ul data-setup-step-actions style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 2 }}>
            {actions.slice(0, 4).map((a) => <li key={a.key} data-setup-action={a.key} style={{ ...quiet, overflowWrap: "anywhere" }}>{a.label}</li>)}
            {actions.length > 4 && <li style={quiet}>and {actions.length - 4} more</li>}
          </ul>
        )}
        {s.id === "brief" && s.status === "todo" && !actions.length && <span style={quiet}>Written once you have ratified the groups.</span>}
        {owners.map((o) => (
          <label key={o} style={{ ...quiet, display: "flex", alignItems: "flex-start", gap: 8, color: "var(--text-secondary)", cursor: run.preview?.github?.login ? "pointer" : "default" }}>
            <input type="checkbox" data-setup-grant-github={o} checked={run.grants.has(o)} disabled={!run.preview?.github?.login} onChange={() => run.toggleGrant(o)} />
            <span>{run.preview?.github?.login
              ? `Use my GitHub login (${run.preview.github.login}) for github.com/${o}, in case a repository there is private. Read through GitHub's API only; never stored or sent to a model.`
              : `github.com/${o} may be private, and no GitHub login was found here: run \`gh auth login\`, or set GITHUB_TOKEN.`}</span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end", flex: "0 0 auto", maxWidth: 220 }}>
        {status}
        {runnable ? (
          <button type="button" data-setup-select={s.id} aria-pressed={selected} onClick={() => run.toggle(s.id)}
            title={selected ? "In the run: click to leave it out" : "Left out: click to put it back in the run"}
            style={{ ...tag(selected ? accent : "var(--text-muted)"), ...chipButton, ...(selected ? { background: `color-mix(in oklab, ${accent} 18%, transparent)` } : { borderStyle: "dashed" }) }}>
            {free ? <BookOpen {...ico} /> : <Sparkles {...ico} />}{free ? "reads the code" : "asks Claude"}
          </button>
        ) : s.spends && s.status !== "done" && <span data-setup-spends style={tag("var(--accent-chat)")}><Sparkles {...ico} />asks Claude</span>}
        {s.decides && s.status !== "done" && <span style={tag("var(--text-secondary)")}><UserCheck {...ico} />you decide</span>}
      </div>
    </li>
  );
}
