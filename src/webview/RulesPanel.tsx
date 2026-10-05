// The RULES panel (2026-10-05, GUI brief M5): the stated rules where a person
// can review them. Until now they lived half-way down the Agent Manager's
// legacy form, with no id, no verdict, no proposals and no way to accept one
// — every review step was CLI-only. Sections:
//   Awaiting you   agent-stated rules (Ratify / Remove) and proposed changes
//                  (before / after, Accept / Reject) — a person's steps
//   All rules · Violated · Unverifiable · By thread · History
// Each rule shows its LIVE verdict from the function `check` prints. The
// buttons are the CLI's person steps through the same functions; the
// history names the person.

import React, { useState } from "react";
import type { StackIndexRecord } from "../shared/protocol";
import { SheetPortal, SheetBody, type SheetSlot } from "./panels/PanelSheet";
import { Chip, Verdict } from "./panels/Chip";
import { ConstraintsPanel, type PolicyPrefill } from "./ConstraintsPanel";
import { RuleItem, ProposalItem } from "./rules/ruleItems";
import type { RulesState } from "./useRulesState";

type Section = "awaiting" | "all" | "violated" | "unverifiable" | "threads" | "history";
const small: React.CSSProperties = { fontSize: "var(--fs-12)", color: "var(--text-muted)", lineHeight: 1.5 };
const heading: React.CSSProperties = { fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text-secondary)", margin: "4px 0 0" };

export function RulesPanel({ open, slot, state, stack, prefill, onPrefillConsumed, focusRule, threadLabel }: {
  open: boolean;
  slot: SheetSlot | null;
  state: RulesState;
  stack: StackIndexRecord | null;
  prefill?: PolicyPrefill | null;
  onPrefillConsumed?: () => void;
  /** a rule chip clicked elsewhere: open on it */
  focusRule?: string | null;
  threadLabel: (entryPointId: string) => string;
}) {
  const [picked, setPicked] = useState<Section | null>(null);
  if (!open || !slot) return null;
  const { rules } = state;
  const awaiting = rules.filter((r) => r.awaiting);
  const section: Section = picked ?? (prefill ? "all" : awaiting.length ? "awaiting" : "all");
  const of = (v: string) => rules.filter((r) => r.verdict === v);
  const byThread = new Map<string, typeof rules>();
  for (const r of rules) for (const t of r.threads) byThread.set(t, [...(byThread.get(t) ?? []), r]);
  const history = rules.flatMap((r) => (r.constraint.changes ?? []).map((ch) => ({ id: r.constraint.id, ch })))
    .sort((a, b) => b.ch.at.localeCompare(a.ch.at));
  const nav: Array<{ id: Section; label: string; count?: number }> = [
    { id: "awaiting", label: "Awaiting you", count: state.pending },
    { id: "all", label: "All rules", count: rules.length },
    { id: "violated", label: "Violated", count: of("violated").length },
    { id: "unverifiable", label: "Unverifiable", count: of("unverifiable").length },
    { id: "threads", label: "By thread", count: byThread.size },
    { id: "history", label: "History", count: history.length },
  ];
  const list = (rows: typeof rules, review = false) => rows
    .slice().sort((a, b) => (a.constraint.id === focusRule ? -1 : b.constraint.id === focusRule ? 1 : 0))
    .map((r) => <RuleItem key={r.constraint.id} row={r} review={review} />);
  const subtitle = `${rules.length} stated · checked after every edit${state.pending ? ` · ${state.pending} await${state.pending === 1 ? "s" : ""} you` : ""}`;

  return (
    <SheetPortal slot={slot} subtitle={subtitle}>
    <SheetBody nav={nav} active={section} onNav={setPicked}>
    <div data-rules-panel data-rules-section={section} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {state.error && <div data-rules-error style={{ ...small, color: "var(--accent-error)" }}>{state.error}</div>}
      {state.message && !state.error && <div data-rules-message style={small}>{state.message}</div>}
      {!state.loaded && <div style={small}>Checking the rules against the code…</div>}
      {state.loaded && (
        <div className="vg-score" data-rules-summary>
          <Verdict v="pass" label={`${state.summary.pass} pass`} />
          <Verdict v="violated" label={`${state.summary.violated} violated`} />
          <Verdict v="unverifiable" label={`${state.summary.unverifiable} unverifiable`} />
          <span style={small}>the verdicts <code>vibegraph-knowledge check</code> prints</span>
        </div>
      )}

      {section === "awaiting" && (
        <div className="vg-queue" data-rules-queue>
          <b>Awaiting you · a person's step (an agent cannot take these)</b>
          {!awaiting.length && <div style={small}>Nothing waits for you: every rule is human-stated and no change is proposed.</div>}
          {awaiting.flatMap((r) => [
            ...(r.constraint.proposals ?? []).map((p) => <ProposalItem key={`${r.constraint.id}:${p.id}`} row={r} p={p} />),
            ...(r.constraint.source !== "human" ? [<RuleItem key={r.constraint.id} row={r} review />] : []),
          ])}
        </div>
      )}
      {section === "all" && (
        <>
          {list(rules, true)}
          {!rules.length && <div style={small}>No rules stated. A rule says what the code cannot reveal; its checkable half is verified after every edit.</div>}
          <ConstraintsPanel constraints={rules.map((r) => r.constraint)} stack={stack ?? undefined} prefill={prefill} onPrefillConsumed={onPrefillConsumed} formOnly />
        </>
      )}
      {section === "violated" && (of("violated").length ? list(of("violated")) : <div style={small}>No rule is violated.</div>)}
      {section === "unverifiable" && (of("unverifiable").length
        ? <>{<div style={small}>Unverifiable is not a pass: the code did not let the checker decide. Each says why in its fold.</div>}{list(of("unverifiable"))}</>
        : <div style={small}>Every checked rule could be decided.</div>)}
      {section === "threads" && [...byThread].sort((a, b) => a[0].localeCompare(b[0])).map(([ep, rs]) => (
        <section key={ep} data-rules-thread={ep} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 style={heading}><Chip kind="process" id={ep} label={threadLabel(ep)} at={ep} /> <span style={small}>{rs.length} rule{rs.length === 1 ? "" : "s"}</span></h3>
          {list(rs)}
        </section>
      ))}
      {section === "history" && (history.length ? history.map(({ id, ch }, i) => (
        <div key={i} data-rules-history style={{ ...small, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <Chip kind="rule" id={id} />
          <span>{ch.at.slice(0, 10)} · {ch.who ? `${ch.who} (${ch.by})` : ch.by} · {ch.field}{ch.why ? ` — ${ch.why}` : ""}</span>
        </div>
      )) : <div style={small}>No changes recorded yet.</div>)}
    </div>
    </SheetBody>
    </SheetPortal>
  );
}
