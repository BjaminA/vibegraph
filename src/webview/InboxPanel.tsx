// The INBOX panel (2026-10-06, direction review M11): every decision waiting
// for a person in one place — the list `vibegraph-knowledge inbox` prints and
// the Stop hook counts at the end of every Claude turn. Agree / Reject run
// each store's own operation (plan agree, rule ratify, groups ratify, scope
// ratify…); the panel writes nothing itself. Grouped by kind.
//
// 2026-10-08 (Ben: "agree / reject are laggy / broken; chip-ify the inbox"):
// every item is the panels' one ItemFrame — its subject as a chip, each
// detail line a bullet with its references as chips (src/shared/inbox_view.ts)
// — and a decision answers the click at once: the item leaves the list while
// the server decides, and comes back with the reason if it refused. Before,
// the buttons stayed disabled until a reply that, on a refusal, never cleared
// them.

import React, { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { SheetPortal, SheetBody, type SheetSlot } from "./panels/PanelSheet";
import { ItemFrame } from "./panels/ItemFrame";
import { Verdict } from "./panels/Chip";
import { sendInboxDecision, type InboxState } from "./useInboxState";
import { inboxFacts, inboxSubject } from "../shared/inbox_view";

const KIND_LABEL: Record<string, string> = {
  plan: "Plan proposals", objective: "Proposed objective", "rule-change": "Changes to rules", rule: "Rules an agent stated",
  groups: "Architecture groups", scope: "Scoped boxes", skill: "Skill drafts", spec: "Software specs", questions: "Open questions",
  brief: "The Brief", decision: "Decisions", sensor: "Drift to decide", drift: "Notes",
};
const small: React.CSSProperties = { fontSize: "var(--fs-12)", color: "var(--text-muted)", lineHeight: 1.5 };

export function InboxPanel({ open, slot, state }: { open: boolean; slot: SheetSlot | null; state: InboxState }) {
  const [picked, setPicked] = useState<string | null>(null);
  // the items a click is waiting on, hidden until the server answers; the
  // server answers one socket's messages in order, so each reply settles the
  // oldest click
  const [deciding, setDeciding] = useState<string[]>([]);
  const seen = useRef(state.answered);
  useEffect(() => {
    const n = state.answered - seen.current;
    seen.current = state.answered;
    if (n > 0) setDeciding((x) => x.slice(n));
  }, [state.answered]);
  if (!open || !slot) return null;
  const items = state.items.filter((i) => !deciding.includes(i.id));
  const kinds = [...new Set(items.map((i) => i.kind))];
  const section = picked && kinds.includes(picked) ? picked : "all";
  const nav = [{ id: "all", label: "Everything", count: items.length }, ...kinds.map((k) => ({ id: k, label: KIND_LABEL[k] ?? k, count: items.filter((i) => i.kind === k).length }))];
  const rows = items.filter((i) => section === "all" || i.kind === section);
  const waiting = deciding.length;
  const decide = (id: string, d: "agree" | "reject") => {
    if (deciding.includes(id)) return;
    setDeciding((x) => [...x, id]);
    sendInboxDecision(id, d);
  };
  const pending = items.filter((i) => i.decidable).length;
  return (
    <SheetPortal slot={slot} subtitle={pending ? `${pending} decision${pending === 1 ? " waits" : "s wait"} for you` : "nothing waits for you"}>
      <SheetBody nav={nav} active={section} onNav={setPicked}>
        <div data-inbox style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={small}>Agents propose; you decide. The same list is <code>vibegraph-knowledge inbox</code> in a terminal outside Claude Code, and the end of every Claude turn says how many wait.</div>
          {waiting > 0 && <div data-inbox-deciding style={small}>{`deciding ${waiting}…`}</div>}
          {!waiting && state.message && <div data-inbox-message style={small}>{state.message}</div>}
          {!waiting && state.error && <div data-inbox-error style={{ ...small, color: "var(--accent-error)" }}>{state.error}</div>}
          {!rows.length && <div style={small}>Nothing here.</div>}
          {rows.map((i) => {
            const subject = inboxSubject(i);
            return (
              <ItemFrame key={i.id} data-inbox-item={i.id} data-inbox-kind={i.kind}
                chip={subject ?? undefined} name={i.title} facts={inboxFacts(i)}
                badges={i.decidable ? null : <Verdict v="prose" label="note" />}
                actions={i.decidable ? (
                  <>
                    <button type="button" className="vg-btn" data-tone="go" data-inbox-agree={i.id} onClick={() => decide(i.id, "agree")}><Check size={16} strokeWidth={1.5} />Agree</button>
                    <button type="button" className="vg-btn" data-tone="no" data-inbox-reject={i.id} onClick={() => decide(i.id, "reject")}><X size={16} strokeWidth={1.5} />Reject</button>
                  </>
                ) : null}
              />
            );
          })}
        </div>
      </SheetBody>
    </SheetPortal>
  );
}
