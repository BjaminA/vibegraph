// THE BRIEF on the map (2026-10-08): a card pinned top-left at every zoom —
// what the system is for (Function), how it holds together (Method) and its
// key features — each line lighting the boxes it names. Ratified lines are
// solid; a STALE line says what changed under it; a PROPOSED brief is ghosted,
// with its REVIEW SHEET above Ratify (B13: each line's warnings, the stated
// rules, core mechanisms and main jobs no line covers, where the plan declares
// what the code does not show) and a Ratify button that names what it accepts.
// "Brief again with notes" sends the person's corrections as stated input the
// model must answer. Drafting asks for the estimate first, then spends the one
// call (src/server/brief_server.ts). Folded by default: it sits over the canvas.

import React, { useEffect, useState } from "react";
import { ScrollText, Sparkles, Check, X, ChevronDown, ChevronRight, AlertTriangle, MessageSquarePlus, RefreshCw } from "lucide-react";
import { bridge, type ExtensionMessage } from "../types";
import type { BriefLine } from "../../shared/brief_types";
import { takeMapOpen, useGuiTask } from "../tasks/guiTasks";
import { WorkingCard } from "../tasks/WorkingCard";

type Spec = { function: BriefLine[]; method: BriefLine[]; feature: BriefLine[] };
interface ReviewLine { part: keyof Spec; index: number; warnings: string[]; byRole: Record<string, string[]> }
interface Review { lines: ReviewLine[]; summary: string; ratifyLabel: string; uncovered: { rules: string[]; salient: string[]; primary: string[]; notes: string[] }; gaps: string[]; explainable?: number; basis?: string }
/** "Explain this gap": which gap, its estimate once asked, and how it went */
interface GapAsk { n: number; estimate?: string; busy?: boolean; result?: string; error?: string }
interface Section { section: string; summary: string }
interface BriefStatePayload {
  available: boolean; claude?: boolean; reason?: string;
  ratified: null | { at: string; by: string; model: string; spec?: Spec };
  ratifiedReview: Review | null;
  groupsFirst?: { step: "groups" | "wait"; why: string } | null;
  sync?: { on: boolean; by: string; at: string; lastRun?: string } | null;
  proposed: null | { model: string; at: string; spec: Spec; refused: number; refusedList: Array<{ item: string; reason: string }>; omitted: string[]; notes: string[]; sections: Section[]; review: Review | null };
}

const quiet: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)" };
const btn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--border-edge)", borderRadius: 4, padding: "4px 8px",
  background: "transparent", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", cursor: "pointer",
};
const PARTS: Array<[string, keyof Spec]> = [["Function", "function"], ["Method", "method"], ["Key features", "feature"]];

function Lines({ spec, review, ghost, onLight, onReaffirm }: { spec: Spec; review?: Review | null; ghost?: boolean; onLight: (boxes: string[] | null) => void; onReaffirm?: (text: string) => void }) {
  return (
    <>
      {PARTS.map(([title, part]) => spec[part].length ? (
        <div key={part} data-brief-part={part} style={{ marginTop: 8 }}>
          <div style={{ ...quiet, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{title}</div>
          {spec[part].map((l, i) => {
            const r = review?.lines.find((x) => x.part === part && x.index === i);
            const warnings = r?.warnings ?? [];
            const roles = r ? Object.entries(r.byRole).map(([role, ids]) => `${role}: ${ids.join(", ")}`).join("\n") : (l.cites.length ? `cites ${l.cites.join(", ")}` : "");
            return (
              <div key={i} style={{ marginTop: 4 }}>
                <button data-brief-line={part} data-brief-stale={l.stale?.length ? "true" : undefined} data-brief-inferred={l.cites.length ? undefined : "true"} data-brief-warned={warnings.length ? "true" : undefined}
                  onClick={() => onLight(l.boxes?.length ? l.boxes : null)}
                  title={`${l.words.join(", ")}\n${l.cites.length ? roles : "INFERRED — no citation"}`}
                  style={{
                    display: "block", width: "100%", textAlign: "left", background: "transparent", cursor: l.boxes?.length ? "pointer" : "default",
                    border: ghost ? "1px dashed var(--proposed-border)" : "1px solid transparent", borderRadius: 4, padding: "4px 4px",
                    color: "var(--text-primary)", opacity: !l.cites.length ? 0.55 : warnings.length ? 0.8 : 1, fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", lineHeight: 1.4,
                  }}>
                  {l.stale?.length || warnings.length ? <AlertTriangle size={16} strokeWidth={1.5} style={{ color: "var(--accent-warning)", verticalAlign: "middle", marginRight: 4 }} /> : null}
                  {l.text}
                </button>
                {(l.staleWhy ?? []).map((w, k) => <div key={`s${k}`} data-brief-stale-why style={{ ...quiet, paddingLeft: 8 }}>{`STALE — ${w}`}</div>)}
                {onReaffirm && l.stale?.length ? <button data-brief-reaffirm-line onClick={() => onReaffirm(l.text)} title="The line still holds: stamp its citations against the code as it is now (no tokens)" style={{ ...quiet, marginLeft: 8, background: "transparent", border: "1px solid var(--border-edge)", borderRadius: 4, padding: "0 8px", cursor: "pointer" }}>Still true</button> : null}
                {warnings.map((w, k) => <div key={`w${k}`} data-brief-warning style={{ ...quiet, paddingLeft: 8 }}>{w}</div>)}
              </div>
            );
          })}
        </div>
      ) : null)}
    </>
  );
}

/** What the checks see that the prose does not show (the review sheet's foot).
 *  An open facts gap offers "Explain" — the estimate first, then one call. */
function Sheet({ review, ask, onExplain, canSpend }: { review: Review; ask?: GapAsk | null; onExplain?: (n: number, estimate: boolean) => void; canSpend?: boolean }) {
  const rows = [
    ...review.uncovered.rules.map((r) => `stated rule ${r} — no line covers it`),
    ...review.uncovered.salient.map((f) => `core mechanism ${f} — no line covers it`),
    ...review.uncovered.primary.map((p) => `main job not stated — ${p}`),
    ...review.uncovered.notes.map((n) => `unanswered ${n}`),
  ];
  const total = rows.length + review.gaps.length;
  return (
    <div data-brief-review style={{ marginTop: 8, padding: 8, border: "1px solid var(--border-edge)", borderRadius: 6 }}>
      <div data-brief-review-summary style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", color: "var(--text-primary)" }}>{`Review: ${review.summary}`}</div>
      {/* 2026-10-21 — what the claims were checked against, so a thin map shows */}
      {review.basis && <div data-brief-review-basis data-incomplete={review.basis.includes("INCOMPLETE") ? "true" : undefined} style={{ ...quiet, marginTop: 4, color: review.basis.includes("INCOMPLETE") ? "var(--accent-warning)" : "var(--text-muted)" }}>{review.basis}</div>}
      {total > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ ...quiet, cursor: "pointer" }}>{`${total} thing${total === 1 ? "" : "s"} to look at`}</summary>
          {rows.map((r, i) => <div key={i} data-brief-uncovered style={{ ...quiet, marginTop: 4 }}>{r}</div>)}
          {review.gaps.map((g, i) => {
            const n = i + 1;
            const explainable = onExplain && i < (review.explainable ?? 0);
            const mine = ask?.n === n ? ask : null;
            return (
              <div key={`g${i}`} data-brief-gap={n} style={{ ...quiet, marginTop: 4 }}>
                {`facts gap — ${g}`}
                {explainable && !mine?.estimate && <button data-brief-gap-ask={n} disabled={!canSpend || !!ask?.busy} onClick={() => onExplain!(n, true)} style={{ ...btn, marginLeft: 4, padding: "0 4px" }}>Explain</button>}
                {explainable && mine?.estimate && !mine.result && <button data-brief-gap-run={n} disabled={!!mine.busy} onClick={() => onExplain!(n, false)} style={{ ...btn, marginLeft: 4, padding: "0 4px" }}>{mine.busy ? "Explaining…" : `Explain (${mine.estimate})`}</button>}
                {mine?.result && <div data-brief-gap-result style={{ ...quiet, paddingLeft: 8 }}>{mine.result}</div>}
                {mine?.error && <div style={{ ...quiet, paddingLeft: 8, color: "var(--accent-error)" }}>{mine.error}</div>}
              </div>
            );
          })}
        </details>
      )}
    </div>
  );
}

export function BriefCard({ onLight }: { onLight: (boxes: string[] | null) => void }) {
  const [state, setState] = useState<BriefStatePayload | null>(null);
  const [open, setOpen] = useState(false);
  const [busyHere, setBusy] = useState<string | null>(null);
  // 2026-10-21 — a draft is the server's task (tasks/guiTasks.ts): it runs on
  // with the card closed, and the card reads it back when it reopens
  const task = useGuiTask("brief");
  const busy = busyHere ?? (task?.state === "running" ? "brief-run" : null);
  useEffect(() => {
    if (takeMapOpen("brief")) setOpen(true); // asked for before the map mounted
    const h = (e: Event) => { if ((e as CustomEvent).detail?.kind === "brief") { takeMapOpen("brief"); setOpen(true); } };
    document.addEventListener("vg-open-task", h);
    return () => document.removeEventListener("vg-open-task", h);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ calls: number; tokens: number; silent: number } | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [ask, setAsk] = useState<GapAsk | null>(null);
  useEffect(() => {
    const h = (m: ExtensionMessage) => {
      const x = m as unknown as { type: string; payload?: any };
      if (x.type === "brief-state") setState(x.payload as BriefStatePayload);
      if (x.type !== "brief-result") return;
      const p = x.payload ?? {};
      if (p.action === "gap-estimate" || p.action === "gap-explain") {
        setAsk((a) => (a && a.n === p.n ? { ...a, busy: false, ...(p.ok ? (p.action === "gap-estimate" ? { estimate: p.detail } : { result: p.detail }) : { error: p.error }) } : a));
        return;
      }
      setBusy(null);
      if (!p.ok) { setError(p.error ?? "failed"); return; }
      setError(null);
      if (p.action === "estimate") setEstimate({ calls: p.calls, tokens: p.tokens, silent: p.silent });
      if (p.action === "run") { setEstimate(null); setNotes(null); }
    };
    bridge.onMessage(h);
    bridge.postMessage({ type: "brief-get" } as never);
    return () => bridge.removeListener(h);
  }, []);
  if (!state?.available) return null;
  const send = (type: string, payload: Record<string, unknown> = {}) => { setBusy(type); setError(null); bridge.postMessage({ type, payload } as never); };
  const explain = (n: number, estimate: boolean) => {
    setAsk((a) => (estimate || a?.n !== n ? { n, busy: true } : { ...a, busy: true, error: undefined }));
    bridge.postMessage({ type: "brief-explain-gap", payload: { n, estimate } } as never);
  };
  const r = state.ratified, p = state.proposed;
  const staleCount = r?.spec ? [...r.spec.function, ...r.spec.method, ...r.spec.feature].filter((l) => l.stale?.length).length : 0;
  const status = p ? "proposed" : r?.spec ? (staleCount ? `${staleCount} stale` : "ratified") : "none";
  const noteList = (notes ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  return (
    <div data-brief-card data-brief-state={p ? "proposed" : r?.spec ? "ratified" : "none"} style={{
      position: "absolute", top: "calc(var(--vg-lens-bar-bottom, 120px) + 8px)", left: 16, zIndex: 33, width: open ? 380 : "auto", maxHeight: "64vh", overflowY: open ? "auto" : "visible",
      background: "color-mix(in oklab, var(--bg-node) 94%, transparent)", border: `1px ${p ? "dashed var(--proposed-border)" : "solid var(--border-edge)"}`,
      borderRadius: 8, padding: "8px 12px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-secondary)", pointerEvents: "auto",
    }}>
      <button data-brief-toggle aria-expanded={open} onClick={() => { setOpen((o) => !o); onLight(null); }} style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)" }}>
        <ScrollText size={16} strokeWidth={1.5} /> Brief
        <span style={{ ...quiet, color: staleCount ? "var(--accent-warning)" : p ? "var(--proposed-border)" : "var(--text-muted)" }}>· {status}</span>
        {open ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
      </button>
      {open && (
        <div>
          {r?.spec && <div style={{ ...quiet, marginTop: 4 }}>{`ratified ${r.at.slice(0, 10)} by ${r.by} · written by ${r.model} · click a line to light its boxes`}</div>}
          {r?.spec && <Lines spec={r.spec} review={state.ratifiedReview} onLight={onLight} onReaffirm={(text) => send("brief-reaffirm", { texts: [text] })} />}
          {r?.spec && (
            <button data-brief-sync aria-pressed={!!state.sync?.on} disabled={!!busy || (!state.claude && !state.sync?.on)} onClick={() => send("brief-sync", { on: !state.sync?.on })}
              title={"Sync: when the code a ratified line cites changes, re-draft just the stale lines — one small scoped call each time, at most one per 10 minutes — and keep them as a proposal for you to ratify. Off: stale lines are only marked."}
              style={{ ...btn, marginTop: 8, color: state.sync?.on ? "var(--accent-thread)" : "var(--text-secondary)", borderColor: state.sync?.on ? "var(--accent-thread)" : "var(--border-edge)" }}>
              <RefreshCw size={16} strokeWidth={1.5} />{state.sync?.on ? `Sync on${state.sync.lastRun ? ` · last re-draft ${state.sync.lastRun.slice(0, 16).replace("T", " ")}` : ""}` : "Sync off"}
            </button>
          )}
          {r?.spec && !p && state.ratifiedReview && <Sheet review={state.ratifiedReview} ask={ask} onExplain={explain} canSpend={!!state.claude} />}
          {p && (
            <div data-brief-proposal style={{ marginTop: 12, paddingTop: 8, borderTop: "1px dashed var(--proposed-border)" }}>
              <div style={{ ...quiet, color: "var(--proposed-border)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{`Proposed · ${p.model}`}</div>
              {p.notes.length > 0 && <div style={{ ...quiet, marginTop: 4 }}>{`asked to answer ${p.notes.length} note${p.notes.length === 1 ? "" : "s"}: ${p.notes.map((n, i) => `note:${i + 1} ${n}`).join(" · ")}`}</div>}
              {!p.spec.function.length && !p.spec.method.length && !p.spec.feature.length && p.sections.some((s) => s.section === "groups") && (
                <div data-brief-groups-first style={{ ...quiet, marginTop: 4 }}>Groups first: decide these groups, then draft the brief — it reads the codebase through the groups you agree. The proposed groups are drawn dashed on the map, their boxes lit.</div>
              )}
              <Lines spec={p.spec} review={p.review} ghost onLight={onLight} />
              {p.review && <Sheet review={p.review} ask={ask} onExplain={explain} canSpend={!!state.claude} />}
              {p.sections.map((s) => (
                <div key={s.section} data-brief-section={s.section} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ flex: "1 1 160px" }}>{s.section}: {s.summary}</span>
                  <button data-brief-ratify={s.section} disabled={!!busy} onClick={() => send("brief-decide", { section: s.section, decision: "ratify" })} style={btn}>
                    <Check size={16} strokeWidth={1.5} />{s.section === "spec" && p.review ? p.review.ratifyLabel : "Ratify"}
                  </button>
                  <button data-brief-reject={s.section} disabled={!!busy} onClick={() => send("brief-decide", { section: s.section, decision: "reject" })} style={btn}><X size={16} strokeWidth={1.5} />Reject</button>
                </div>
              ))}
              {(p.refused > 0 || p.omitted.length > 0) && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ ...quiet, cursor: "pointer" }}>{`${p.refused} item(s) refused by the checks · ${p.omitted.length} left out`}</summary>
                  {p.refusedList.map((x, i) => <div key={i} data-brief-refused style={{ ...quiet, marginTop: 4 }}>{`${x.item}: ${x.reason}`}</div>)}
                  {p.omitted.map((o, i) => <div key={`o${i}`} style={{ ...quiet, marginTop: 4 }}>{`left out: ${o}`}</div>)}
                </details>
              )}
            </div>
          )}
          {notes !== null && (
            <div data-brief-notes style={{ marginTop: 12 }}>
              <div style={quiet}>One correction per line. The model must answer each (cite it as note:N, or say why not); the checks still apply.</div>
              <textarea data-brief-notes-input value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
                placeholder={"requests are per person; the state service decides each request"}
                style={{ width: "100%", boxSizing: "border-box", marginTop: 4, fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", background: "var(--bg-canvas)", color: "var(--text-primary)", border: "1px solid var(--border-edge)", borderRadius: 4, padding: 8 }} />
            </div>
          )}
          {/* 2026-10-21 (a field report) — a model call takes minutes on a large
              project: say what is running and for how long, in place of the
              disabled buttons, one of which read like a status */}
          {busy === "brief-run" && (
            <WorkingCard data-brief-run-progress title={task?.state === "running" ? task.label : "Drafting the Brief"} startedAt={task?.state === "running" ? task.startedAt : undefined}
              steps={task?.state === "running" ? task.steps : []} style={{ marginTop: 12 }}
              note="It can take a few minutes on a large project, and carries on if you close this card; the ratified Brief stays as it is until you ratify the draft." />
          )}
          <div style={{ display: busy === "brief-run" ? "none" : "flex", gap: 4, marginTop: 12, flexWrap: "wrap" }}>
            {staleCount > 0 && !p && <button data-brief-reaffirm-all disabled={!!busy} onClick={() => send("brief-reaffirm")} title="Every stale line still holds: stamp them against the code as it is now (no tokens)" style={btn}><Check size={16} strokeWidth={1.5} />{`Mark the ${staleCount} stale line${staleCount === 1 ? "" : "s"} still true`}</button>}
            {staleCount > 0 && !p && <button data-brief-restate disabled={!!busy || !state.claude} onClick={() => send("brief-run", { stale: true })} style={btn}><Sparkles size={16} strokeWidth={1.5} />{busy === "brief-run" ? "Re-briefing…" : `Re-brief ${staleCount} stale line${staleCount === 1 ? "" : "s"}`}</button>}
            {(r?.spec || p) && notes === null && <button data-brief-again disabled={!!busy || !state.claude} onClick={() => setNotes("")} style={btn}><MessageSquarePlus size={16} strokeWidth={1.5} />Brief again with notes</button>}
            {notes !== null && (
              <>
                <button data-brief-again-run disabled={!!busy || !noteList.length} onClick={() => send("brief-run", { notes: noteList, only: "spec" })} style={btn}><Sparkles size={16} strokeWidth={1.5} />{busy === "brief-run" ? "Briefing… (a minute or two)" : `Brief again (${noteList.length} note${noteList.length === 1 ? "" : "s"})`}</button>
                <button disabled={!!busy} onClick={() => setNotes(null)} style={btn}>Cancel</button>
              </>
            )}
            {!p && !estimate && notes === null && <button data-brief-ask disabled={!!busy || !state.claude} onClick={() => send("brief-estimate")} style={btn}><Sparkles size={16} strokeWidth={1.5} />{r?.spec ? "Brief again" : "Brief this codebase"}</button>}
            {!p && estimate && (
              <>
                <span data-brief-estimate style={{ ...quiet, alignSelf: "center" }}>{`≈ ${estimate.calls} call${estimate.calls === 1 ? "" : "s"}, ~${Math.round(estimate.tokens / 1000)}k tokens`}</span>
                <button data-brief-run disabled={!!busy} onClick={() => send("brief-run")} style={btn}>{busy === "brief-run" ? "Briefing… (a minute or two)" : state.groupsFirst?.step === "groups" ? "Propose groups first" : "Draft it"}</button>
                {state.groupsFirst?.step === "groups" && <button data-brief-skip-groups disabled={!!busy} onClick={() => send("brief-run", { skipGroups: true })} style={btn}>Skip groups</button>}
                <button disabled={!!busy} onClick={() => setEstimate(null)} style={btn}>Cancel</button>
              </>
            )}
          </div>
          {!p && state.groupsFirst && <div data-brief-groups-note style={{ ...quiet, marginTop: 4 }}>{state.groupsFirst.why}</div>}
          {!state.claude && <div style={{ ...quiet, marginTop: 4 }}>the claude CLI is not available here — `vibegraph-knowledge brief codebase` with a saved reply works from the command line</div>}
          {error && <div data-brief-error style={{ ...quiet, color: "var(--accent-error)", marginTop: 4 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
