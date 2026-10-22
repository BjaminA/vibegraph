// The setup, offered (2026-10-21, Ben: "a button for this pop up if detected a
// new project i.e. vibegraph can spot its loaded on new instance and suggest
// this to the user"). Opened by itself, once, when the app is pointed at a
// project nobody has set up (src/server/setup_welcome.ts); opened any time
// from the sidebar's "setup" line. It lists the setup's steps in their one
// order (src/server/setup_state.ts: the same order as `vibegraph-knowledge
// setup` and /vibegraph-setup), each with its state, whether it asks a model
// and whether a person decides it. Every step Claude can take now starts
// selected, its chip highlighted; one Run takes the selected steps in order,
// one at a time (SetupRun.tsx, SetupStepRow.tsx); what each will do is listed
// under it. A step that waits for a person opens from its status chip.

import React, { useEffect, useRef, useState } from "react";
import { Check, Play, Terminal, X, Copy, Sparkles } from "lucide-react";
import type { NowPanel, NowState, SheetPanel } from "../../shared/now_wire";
import { bridge } from "../types";
import { SetupRunPanel, useSetupRun } from "./SetupRun";
import { SetupStepRow } from "./SetupStepRow";
import { btn, ico, quiet } from "./styles";

/** the sidebar's setup line (NowStrip) opens the guide from anywhere */
export function openSetupGuide(): void {
  document.dispatchEvent(new CustomEvent("vg-open-setup"));
}

/** Mounted once by App: opens the guide by itself when the server offers the
 * setup (a new project), and on `openSetupGuide()`. Closing the offered guide
 * in any way, or starting the setup from it, sets the offer aside for this
 * project; the sidebar's setup line still opens it. */
export function SetupGuideHost({ now, onPanel, onMap }: {
  now: NowState | null;
  onPanel: (p: SheetPanel) => void;
  /** the next step is decided on the map: the Brief card */
  onMap: () => void;
}) {
  const [open, setOpen] = useState<"welcome" | "progress" | null>(null);
  const offered = useRef(false);
  const welcome = !!now?.setup?.welcome;
  useEffect(() => {
    if (welcome && !offered.current) { offered.current = true; setOpen("welcome"); }
  }, [welcome]);
  useEffect(() => {
    const h = () => setOpen("progress");
    document.addEventListener("vg-open-setup", h);
    return () => document.removeEventListener("vg-open-setup", h);
  }, []);
  const close = React.useCallback(() => {
    setOpen((cur) => {
      if (cur === "welcome") bridge.postMessage({ type: "setup-welcome-dismiss" } as never);
      return null;
    });
  }, []);
  if (!open || !now?.setup) return null;
  return <SetupGuide now={now} welcome={open === "welcome"} onClose={close}
    onStart={(t) => { if (t.panel === "setup") return; close(); if (t.panel) onPanel(t.panel); else onMap(); }} />;
}

const COMMANDS = [
  { run: "npx vibegraph-knowledge init --skill", why: "in your terminal, in the project: installs the /vibegraph-setup skill for Claude Code" },
  { run: "/vibegraph-setup", why: "in Claude Code: it walks the same steps, runs the proposing ones after your yes, and stops at every decision that is yours" },
];
const HOOKS = { run: "npx vibegraph-knowledge init --hooks", why: "your step, in your terminal: from the next Claude Code session, every prompt gets its contracts and every edit is checked against the rules" };

export function SetupGuide({ now, welcome, onStart, onClose }: {
  now: NowState;
  /** opened by itself on a new project (the first-time wording) */
  welcome: boolean;
  /** go to where the next step is decided */
  onStart: (target: { panel: NowPanel | null }) => void;
  onClose: () => void;
}) {
  const [claudeCode, setClaudeCode] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const steps = now.setup?.steps ?? [];
  // 2026-10-22 — every step Claude can run starts selected (its chip); one Run
  // takes the selected steps in order (SetupRun.tsx, setup_run.ts). A step that
  // waits for the person opens where it is decided from its status chip.
  const run = useSetupRun();
  const calls = (run.preview?.actions ?? []).filter((a) => run.selected.includes(a.step) && a.spends).length;
  const copy = (s: string) => { void navigator.clipboard?.writeText(s).then(() => setCopied(s), () => setCopied(null)); };
  return (
    <div data-setup-guide-scrim onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "color-mix(in oklab, var(--bg-canvas) 55%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div data-setup-guide={welcome ? "welcome" : "progress"} role="dialog" aria-modal="true" aria-labelledby="vg-setup-title" className="vg-msg-enter" onClick={(e) => e.stopPropagation()}
        style={{ width: "min(640px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: "var(--bg-node)", border: "1px solid var(--border-edge)", borderRadius: 12, boxShadow: "var(--shadow-panel)", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <Sparkles size={20} strokeWidth={1.5} color="var(--accent-thread)" style={{ flex: "0 0 auto", marginTop: 2 }} />
          <div style={{ flex: "1 1 auto" }}>
            <h2 id="vg-setup-title" style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--fs-16)", fontWeight: 600, color: "var(--text-primary)" }}>
              {welcome ? "Set up VibeGraph for this project" : "The setup"}
            </h2>
            <p style={{ ...quiet, margin: "4px 0 0" }}>
              {welcome
                ? "VibeGraph has read this project, and none of its setup has been started here. The setup gives Claude the project's architecture, its Brief and the rules your team keeps, and checks every edit against them."
                : now.setup && now.setup.done >= now.setup.of
                  ? `All ${now.setup.of} steps are done. After the setup: a plan for what you build next, when you have it.`
                  : `${now.setup?.done ?? 0} of ${now.setup?.of ?? 0} steps done. The same order as \`vibegraph-knowledge setup\`.`}
            </p>
          </div>
          <button type="button" data-setup-guide-close onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--text-muted)" }}><X {...ico} /></button>
        </div>

        <ol data-setup-steps style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {steps.map((s, i) => (
            <React.Fragment key={s.id}>
              {/* 2026-10-21 — the plan follows the setup and is not counted in it (setup_state.ts) */}
              {s.after && !steps[i - 1]?.after && <li data-setup-after style={{ ...quiet, marginTop: 8 }}>After the setup, when you have something to build next:</li>}
              <SetupStepRow step={s} index={i} run={run} onGo={onStart} onHooks={() => setClaudeCode(true)} />
            </React.Fragment>
          ))}
        </ol>
        <p style={{ ...quiet, margin: 0 }}>The highlighted steps run in order when you press Run, one at a time; click a step's chip to leave it out or put it back. Nothing a model proposes applies until you ratify it, and a step that waits for you opens from its status chip.</p>

        {claudeCode && (
          <div data-setup-claude-code style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...COMMANDS, HOOKS].map((c) => (
              <div key={c.run} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ flex: "0 0 auto", fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--text-primary)", background: "var(--bg-canvas)", border: "1px solid var(--border-edge)", borderRadius: 4, padding: "4px 8px" }}>{c.run}</code>
                <button type="button" onClick={() => copy(c.run)} aria-label={`Copy ${c.run}`} style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: copied === c.run ? "var(--accent-thread)" : "var(--text-muted)" }}>
                  {copied === c.run ? <Check {...ico} /> : <Copy {...ico} />}
                </button>
                <span style={quiet}>{c.why}</span>
              </div>
            ))}
          </div>
        )}

        <SetupRunPanel run={run} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {!run.running && (
            <button type="button" data-setup-run disabled={!run.selected.length} onClick={run.start} style={{ ...btn(true), ...(run.selected.length ? {} : { opacity: 0.5, cursor: "default" }) }}>
              <Play {...ico} />{run.selected.length ? `Run ${run.selected.length} step${run.selected.length === 1 ? "" : "s"}${calls ? ` · ${calls} model call${calls === 1 ? "" : "s"}` : ""}` : "Run"}
            </button>
          )}
          <button type="button" data-setup-claude-code-toggle aria-pressed={claudeCode} onClick={() => setClaudeCode((v) => !v)} style={btn()}>
            <Terminal {...ico} />Set up from Claude Code
          </button>
          <button type="button" data-setup-not-now onClick={onClose} style={{ ...btn(), marginLeft: "auto" }}>{welcome ? "Not now" : "Close"}</button>
        </div>
        <p style={{ ...quiet, margin: 0 }}>{`Next: ${now.next.text}`}</p>
      </div>
    </div>
  );
}
