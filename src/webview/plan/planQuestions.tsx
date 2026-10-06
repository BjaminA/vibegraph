// The Plan panel's open questions (2026-10-05, from a field report: the
// close control read as a status badge, a dropped question vanished, long
// questions were clipped to two lines with the answer in the clipped part,
// and in "Everything" the questions sat 10,000 px down).
//
//   * every question is shown in FULL: no line clamp, the card grows with its
//     text and reflows with the panel;
//   * "Close — answered" and "Drop — not needed" are labelled actions, each
//     confirmed, each with an optional note recorded in the plan history;
//     "ANSWERED …" in the text is a passive tag, never a button;
//   * closed and dropped questions stay under "Closed and dropped", with
//     when, who and the note, and Reopen;
//   * at the cap, adding one more lists the questions that look answered,
//     with "Close all answered" (one confirm naming every id).
// All of these are a person's steps: the server refuses them from an agent.

import React, { useState } from "react";
import { Check, Trash2, ArrowUpRight, RotateCcw, Plus } from "lucide-react";
import type { Plan, PlanFinding, PlanQuestion, ResolvedQuestion } from "../../shared/plan_types";
import { PLAN_CAPS, looksAnswered, proposedObjectiveText } from "../../shared/plan_types";
import { Chip, Verdict } from "../panels/Chip";
import { sendPlanOp, sendPlanOps } from "../usePlanState";

const PROPOSED_OBJECTIVE = "Proposed objective:";
const small: React.CSSProperties = { fontSize: "var(--fs-12)", color: "var(--text-muted)", lineHeight: 1.5 };
const field: React.CSSProperties = {
  flex: 1, minWidth: 160, boxSizing: "border-box", background: "var(--bg-canvas)", color: "var(--text-primary)",
  border: "1px solid var(--border-edge)", borderRadius: 6, padding: "4px 8px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)",
};
/** The full question text: wraps, never clipped, grows the card. */
const textStyle: React.CSSProperties = {
  margin: "0 12px 8px", fontSize: "var(--fs-13)", lineHeight: 1.6, color: "var(--text-secondary)",
  whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word",
};

/** Confirm a close or a drop, with an optional one-line note. */
function Confirm({ kind, id, onDone }: { kind: "close" | "drop"; id: string; onDone: () => void }) {
  const [note, setNote] = useState("");
  const send = () => {
    sendPlanOp({ op: kind === "close" ? "close-question" : "drop-question", id, ...(note.trim() ? { note: note.trim() } : {}) });
    onDone();
  };
  return (
    <div data-question-confirm={kind} role="group" aria-label={`${kind === "close" ? "Close" : "Drop"} ${id}?`}
      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "0 12px 12px" }}>
      <span style={small}>{kind === "close" ? `Close ${id} as answered?` : `Drop ${id} as not needed?`}</span>
      <input data-question-note value={note} maxLength={PLAN_CAPS.note} onChange={(e) => setNote(e.target.value.replace(/[\r\n]/g, " "))}
        onKeyDown={(e) => { if (e.key === "Enter") send(); if (e.key === "Escape") onDone(); }}
        placeholder={kind === "close" ? "the answer, or where it is (optional)" : "why it is not needed (optional)"} style={field} autoFocus />
      <button className="vg-btn" data-tone={kind === "close" ? "go" : "no"} data-question-confirm-go onClick={send}>{kind === "close" ? "Close it" : "Drop it"}</button>
      <button className="vg-btn" onClick={onDone}>Cancel</button>
    </div>
  );
}

export function QuestionCard({ q, finding }: { q: PlanQuestion; finding?: PlanFinding }) {
  const [asking, setAsking] = useState<"close" | "drop" | null>(null);
  const evidence = !finding ? null : finding.verdict === "violated" ? "refuted" : finding.verdict === "pass" ? "confirmed" : "unverified";
  const tag = looksAnswered(q);
  return (
    <article className="vg-item" data-plan-item={`open:${q.id}`} data-question={q.id}>
      <div className="vg-item-head">
        <Chip kind="question" id={q.id} />
        {q.about && <span style={small}>about {q.about}</span>}
        <span className="vg-grow" />
        {tag && <span data-question-tag={tag}><Verdict v={tag === "answered" ? "answered" : "partly"} /></span>}
        {evidence && <span data-plan-question-state={evidence} title={finding!.detail}><Verdict v={evidence} /></span>}
      </div>
      <p data-question-text style={textStyle}>{q.text}</p>
      {asking ? <Confirm kind={asking} id={q.id} onDone={() => setAsking(null)} /> : (
        <div className="vg-item-acts">
          {q.text.startsWith(PROPOSED_OBJECTIVE) && (
            <button className="vg-btn" data-tone="go" data-plan-adopt-objective title="Make this the plan's objective"
              onClick={() => sendPlanOps([{ op: "set-objective", text: proposedObjectiveText(q.text) }, { op: "close-question", id: q.id, note: "adopted as the objective" }])}>
              <ArrowUpRight size={12} strokeWidth={1.5} /> Adopt as objective
            </button>
          )}
          <button className="vg-btn" data-tone="go" data-question-close aria-label={`Close — answered (${q.id})`} onClick={() => setAsking("close")}
            title="It is answered: close it (kept under Closed and dropped, with your note)">
            <Check size={12} strokeWidth={1.5} /> Close — answered
          </button>
          <button className="vg-btn" data-question-drop aria-label={`Drop — not needed (${q.id})`} onClick={() => setAsking("drop")}
            title="It no longer matters: drop it (kept under Closed and dropped, with your note)">
            <Trash2 size={12} strokeWidth={1.5} /> Drop — not needed
          </button>
        </div>
      )}
    </article>
  );
}

/** Closed and dropped questions: collapsed, each with when, who, why, Reopen.
 *  A <details> — the browser's find-in-page opens it to show a match. */
export function ResolvedQuestions({ resolved }: { resolved: ResolvedQuestion[] }) {
  if (!resolved.length) return null;
  return (
    <details data-questions-resolved style={{ border: "1px solid var(--border-edge)", borderRadius: 10, padding: "8px 12px" }}>
      <summary style={{ cursor: "pointer", color: "var(--text-secondary)", fontSize: "var(--fs-13)" }}>Closed and dropped ({resolved.length})</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {[...resolved].reverse().map((q) => (
          <div key={q.id} data-resolved-question={q.id} data-resolved-state={q.state} style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: "1px dashed var(--border-edge)", paddingTop: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Chip kind="question" id={q.id} />
              <Verdict v={q.state === "closed" ? "closed" : "dropped"} />
              <span style={small} data-resolved-meta>{`rev ${q.rev} · ${q.by} · ${q.at.slice(0, 10)}`}</span>
              <span className="vg-grow" style={{ flex: 1 }} />
              <button className="vg-btn" data-question-reopen onClick={() => sendPlanOp({ op: "reopen-question", id: q.id })} title="Open it again">
                <RotateCcw size={12} strokeWidth={1.5} /> Reopen
              </button>
            </div>
            <p style={{ ...textStyle, margin: 0 }}>{q.text}</p>
            {q.note && <p style={{ ...small, margin: 0 }} data-resolved-note>{q.state === "closed" ? "answer" : "why"}: {q.note}</p>}
          </div>
        ))}
      </div>
    </details>
  );
}

/** Add a question; at the cap, close the answered ones first (one confirm). */
export function AddQuestion({ plan }: { plan: Plan }) {
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const full = plan.open.length >= PLAN_CAPS.open;
  const answered = plan.open.filter((q) => looksAnswered(q) === "answered");
  const add = () => { if (text.trim() && !full) { sendPlanOp({ op: "add", section: "open", item: { text: text.trim() } }); setText(""); } };
  return (
    <div data-question-add style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input data-question-add-input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="Ask a question the plan has to answer" maxLength={PLAN_CAPS.question} style={field} />
        <button className="vg-btn" data-question-add-go disabled={!text.trim() || full} onClick={add}><Plus size={12} strokeWidth={1.5} /> Add question</button>
      </div>
      {full && (
        <div data-question-cap className="vg-queue" style={{ "--p": 210 } as React.CSSProperties}>
          <b>{`${plan.open.length} open questions — the cap is ${PLAN_CAPS.open}. Close or drop one to add another.`}</b>
          {answered.length ? (
            <>
              <span style={small}>{`These look answered (their text starts "ANSWERED"): ${answered.map((q) => q.id).join(", ")}`}</span>
              {!confirming ? (
                <div><button className="vg-btn" data-tone="go" data-question-close-answered onClick={() => setConfirming(true)}>
                  <Check size={12} strokeWidth={1.5} /> Close all answered ({answered.length})
                </button></div>
              ) : (
                <div data-question-close-answered-confirm style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={small}>{`Close ${answered.map((q) => q.id).join(", ")} as answered?`}</span>
                  <button className="vg-btn" data-tone="go" data-question-close-answered-go
                    onClick={() => { sendPlanOps(answered.map((q) => ({ op: "close-question", id: q.id, note: "closed with the other answered questions" }))); setConfirming(false); }}>
                    Close {answered.length}
                  </button>
                  <button className="vg-btn" onClick={() => setConfirming(false)}>Cancel</button>
                </div>
              )}
            </>
          ) : <span style={small}>None of them says it is answered yet.</span>}
        </div>
      )}
    </div>
  );
}

/** "9 open questions (cap 10) · 7 look answered", near the top of Everything. */
export function QuestionsSummary({ plan, onJump }: { plan: Plan; onJump: () => void }) {
  const n = plan.open.length;
  if (!n && !plan.resolved?.length) return null;
  const answered = plan.open.filter((q) => looksAnswered(q) === "answered").length;
  return (
    <button type="button" data-questions-summary onClick={onJump} className="vg-btn"
      style={{ position: "sticky", top: 0, zIndex: 2, alignSelf: "flex-start", display: "inline-flex", gap: 8, alignItems: "center" }}
      title="Go to the questions">
      <Chip kind="question" id="questions" label={`${n} open question${n === 1 ? "" : "s"}`} focusable={false} />
      <span>{`(cap ${PLAN_CAPS.open})${answered ? ` · ${answered} look${answered === 1 ? "s" : ""} answered` : ""}${plan.resolved?.length ? ` · ${plan.resolved.length} closed or dropped` : ""}`}</span>
    </button>
  );
}
