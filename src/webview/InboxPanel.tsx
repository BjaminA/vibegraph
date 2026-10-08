// The INBOX panel (2026-10-06, direction review M11): every decision waiting
// for a person in one place — the list `vibegraph-knowledge inbox` prints and
// the Stop hook counts at the end of every Claude turn. Agree / Reject run
// each store's own operation (plan agree, rule ratify, groups ratify, scope
// ratify…); the panel writes nothing itself. Grouped by kind, the evidence
// with each item.

import React, { useState } from "react";
import { Check, X } from "lucide-react";
import { SheetPortal, SheetBody, type SheetSlot } from "./panels/PanelSheet";
import { sendInboxDecision, type InboxState } from "./useInboxState";

const KIND_LABEL: Record<string, string> = {
  plan: "Plan proposals", objective: "Proposed objective", "rule-change": "Changes to rules", rule: "Rules an agent stated",
  groups: "Architecture groups", scope: "Scoped boxes", skill: "Skill drafts", spec: "Software specs", questions: "Open questions",
  brief: "The Brief",
};
const small: React.CSSProperties = { fontSize: "var(--fs-12)", color: "var(--text-muted)", lineHeight: 1.5 };
const btn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--border-edge)", borderRadius: 4, padding: "4px 8px",
  background: "transparent", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", cursor: "pointer",
};

export function InboxPanel({ open, slot, state }: { open: boolean; slot: SheetSlot | null; state: InboxState }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!open || !slot) return null;
  const kinds = [...new Set(state.items.map((i) => i.kind))];
  const section = picked && kinds.includes(picked) ? picked : "all";
  const nav = [{ id: "all", label: "Everything", count: state.items.length }, ...kinds.map((k) => ({ id: k, label: KIND_LABEL[k] ?? k, count: state.items.filter((i) => i.kind === k).length }))];
  const rows = state.items.filter((i) => section === "all" || i.kind === section);
  const decide = (id: string, d: "agree" | "reject") => { setBusy(id); sendInboxDecision(id, d); };
  return (
    <SheetPortal slot={slot} subtitle={state.pending ? `${state.pending} decision${state.pending === 1 ? " waits" : "s wait"} for you` : "nothing waits for you"}>
      <SheetBody nav={nav} active={section} onNav={setPicked}>
        <div data-inbox style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={small}>Agents propose; you decide. The same list is <code>vibegraph-knowledge inbox</code> in a terminal outside Claude Code, and the end of every Claude turn says how many wait.</div>
          {state.message && <div data-inbox-message style={{ ...small, color: "var(--accent-thread)" }}>{state.message}</div>}
          {state.error && <div data-inbox-error style={{ ...small, color: "var(--accent-error)" }}>{state.error}</div>}
          {!rows.length && <div style={small}>Nothing here.</div>}
          {rows.map((i) => (
            <div key={i.id} data-inbox-item={i.id} data-inbox-kind={i.kind} style={{ border: "1px solid var(--border-edge)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{i.title}</span>
                <span style={{ ...small, fontFamily: "var(--font-mono)" }}>{i.id}</span>
              </div>
              {i.detail.map((d, k) => <div key={k} style={{ ...small, fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{d}</div>)}
              {i.decidable && (
                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  <button data-inbox-agree={i.id} disabled={busy === i.id} onClick={() => decide(i.id, "agree")} style={btn}><Check size={16} strokeWidth={1.5} />Agree</button>
                  <button data-inbox-reject={i.id} disabled={busy === i.id} onClick={() => decide(i.id, "reject")} style={btn}><X size={16} strokeWidth={1.5} />Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </SheetBody>
    </SheetPortal>
  );
}
