// The project's own direction, at the top of the Direction panel (2026-10-16;
// src/server/project_direction.ts). Read from the code at a press — zero
// tokens — and decided rule by rule: a proposed rule waits for the person;
// an agreed one carries the two switches every direction rule has
// (direction/DeliverySwitches.tsx, 2026-10-20): told up front with the
// threads it is about, and/or explained when an edit breaks its check. Never
// a gate. Every press shows at once and is held until the server answers.

import React, { useEffect, useState } from "react";
import { ScanSearch, Check, X, RotateCcw } from "lucide-react";
import { bridge, type ExtensionMessage } from "./types";
import type { ProjectDirectionPayload, ProjectRule, DirectionStatus } from "../shared/project_direction_wire";
import type { Delivery } from "../shared/generic_skills_wire";
import { DeliverySwitches, useHeld } from "./direction/DeliverySwitches";

const mono = "var(--font-mono)";
const small: React.CSSProperties = { fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 };
const btn: React.CSSProperties = { display: "inline-flex", gap: 4, alignItems: "center", border: "1px solid var(--border-edge)", borderRadius: 4, padding: "4px 8px", background: "transparent", color: "var(--text-primary)", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)" };

/** Where a rule was read from, in words (its basis id is for the store). */
const sourceOf = (basis: string) => {
  const [kind, ...rest] = basis.split(":");
  const what = rest.join(":");
  if (kind === "funnel") return `read from how the code reaches ${what}`;
  if (kind === "guard") return `read from every write to ${what.split("/").pop()}`;
  if (kind === "plan") return `the plan's agreed principle ${what.split(":").pop()}`;
  return `from ${basis}`;
};

function Rule({ r, status, delivery, onDecide, onDeliver }: {
  r: ProjectRule; status: DirectionStatus; delivery: Delivery;
  onDecide: (decision: "agree" | "drop") => void; onDeliver: (patch: Partial<Delivery>) => void;
}) {
  return (
    <div data-direction-rule={r.id} data-direction-status={status} className="vg-msg-enter"
      style={{ border: "1px solid var(--border-edge)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 4, opacity: status === "dropped" ? 0.6 : 1 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontFamily: mono, fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>{r.id}</span>
        <span style={{ fontSize: "var(--fs-13)", color: "var(--text-primary)", lineHeight: 1.5 }}>{r.text}</span>
      </div>
      <span style={small}>why: {r.why}</span>
      <span style={{ ...small, fontFamily: mono }}>
        {sourceOf(r.basis)}{r.check ? ` · checked by ${String(r.check.rule)}` : " · nothing checks it"}
      </span>
      {(r.changed || r.missing) && (
        <span className="vg-keep-accent" style={{ fontSize: "var(--fs-11)", color: "var(--accent-warning)" }}>
          {r.missing ? "the code no longer shows this — drop it, or keep it as a rule for new code" : "the facts it was read from moved since you agreed — read the why again"}
        </span>
      )}
      {status === "agreed" && (
        <DeliverySwitches value={delivery} canCheck={!!r.check} data={{ "direction-switch": r.id }} onChange={onDeliver}
          upfrontHint="Claude Code gets this rule once per session, with the first prompt that reaches a thread it is about." />
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        {status !== "agreed" && <button data-direction-agree={r.id} style={btn} onClick={() => onDecide("agree")}><Check size={16} strokeWidth={1.5} />{status === "dropped" ? "Agree after all" : "Agree"}</button>}
        {status !== "dropped" && <button data-direction-drop={r.id} style={btn} onClick={() => onDecide("drop")}><X size={16} strokeWidth={1.5} />Drop</button>}
        {status === "agreed" && r.changed && <button style={btn} onClick={() => onDecide("agree")}><RotateCcw size={16} strokeWidth={1.5} />Still agree</button>}
      </div>
    </div>
  );
}

export function ProjectDirectionSection() {
  const [state, setState] = useState<ProjectDirectionPayload | null>(null);
  const [reading, setReading] = useState(false);
  const statusHeld = useHeld<DirectionStatus>();
  const deliveryHeld = useHeld<Delivery>();
  useEffect(() => {
    const onMsg = (m: ExtensionMessage) => {
      // a decision made in the Inbox: read the rules again
      if ((m as { type: string; payload?: { message?: string } }).type === "inbox-state" && (m as { payload?: { message?: string } }).payload?.message) { bridge.postMessage({ type: "project-direction-get" } as never); return; }
      if ((m as { type: string }).type !== "project-direction") return;
      setState((m as unknown as { payload: ProjectDirectionPayload }).payload);
      setReading(false);
    };
    bridge.onMessage(onMsg);
    bridge.postMessage({ type: "project-direction-get" } as never);
    return () => bridge.removeListener(onMsg);
  }, []);
  // every reply answers one press of either kind
  useEffect(() => { statusHeld.answered(); deliveryHeld.answered(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const fallback = state?.defaultDelivery ?? { upfront: true, onCheck: true };
  const statusOf = (r: ProjectRule) => statusHeld.shown(r.id, r.status);
  const deliveryOf = (r: ProjectRule) => { const d = deliveryHeld.shown(r.id, r.delivery ?? fallback); return { upfront: d.upfront, onCheck: d.onCheck && !!r.check }; };
  const decide = (r: ProjectRule, decision: "agree" | "drop") => {
    statusHeld.press(r.id, decision === "agree" ? "agreed" : "dropped");
    bridge.postMessage({ type: "project-direction-decide", payload: { id: r.id, decision } } as never);
  };
  const deliver = (r: ProjectRule, patch: Partial<Delivery>) => {
    deliveryHeld.press(r.id, { ...deliveryOf(r), ...patch });
    bridge.postMessage({ type: "project-direction-deliver", payload: { id: r.id, ...patch } } as never);
  };

  const rules = state?.direction.rules ?? [];
  const group = (status: DirectionStatus) => rules.filter((r) => statusOf(r) === status);
  const read = () => { setReading(true); bridge.postMessage({ type: "project-direction-census" } as never); };
  const show = (r: ProjectRule) => <Rule key={r.id} r={r} status={statusOf(r)} delivery={deliveryOf(r)} onDecide={(d) => decide(r, d)} onDeliver={(p) => deliver(r, p)} />;
  return (
    <section data-project-direction style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: "var(--fs-14)", fontWeight: 600, color: "var(--text-primary)" }}>This project's direction</span>
        <button data-direction-census style={{ ...btn, marginLeft: "auto" }} onClick={read} disabled={reading}>
          <ScanSearch size={16} strokeWidth={1.5} />{reading ? "Reading…" : "Read from the code"}
        </button>
      </div>
      <span style={small}>
        Not generic: what THIS code already does, as rules — a tool reached through the project's own module, a data zone whose every
        write runs behind one check, and the plan's agreed principles. Zero tokens. Agree or drop each; an agreed rule gets the two switches.
      </span>
      {state?.note && <span data-direction-note style={{ ...small, color: "var(--text-secondary)" }}>{state.note}</span>}
      {state?.error && <span style={{ fontSize: "var(--fs-11)", color: "var(--accent-error)" }}>{state.error}</span>}
      {!rules.length && <span style={small}>No project direction yet — <em>Read from the code</em> finds the patterns it already follows.</span>}
      {group("proposed").length > 0 && <span className="vg-keep-accent" style={{ fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--accent-warning)" }}>Waiting for you ({group("proposed").length})</span>}
      {group("proposed").map(show)}
      {group("agreed").length > 0 && <span style={{ fontSize: "var(--fs-12)", fontWeight: 600 }}>Agreed ({group("agreed").length})</span>}
      {group("agreed").map(show)}
      {group("dropped").length > 0 && (
        <details>
          <summary style={{ ...small, cursor: "pointer" }}>Dropped ({group("dropped").length}) — never proposed again</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>{group("dropped").map(show)}</div>
        </details>
      )}
    </section>
  );
}
