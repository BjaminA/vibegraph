// A stated rule and a proposed change to one, in the ItemFrame (2026-10-05,
// GUI brief M5). The header carries the rule's id, who stated it, and its
// LIVE verdict (the one `vibegraph-knowledge check` prints); the `rule`
// bullet draws the checkable half with typed chips; the history is folded.

import React from "react";
import { Check, X, Trash2, ShieldCheck } from "lucide-react";
import type { ChipRef, ItemFact } from "../../shared/kinds";
import { kindOfPath } from "../../shared/kinds";
import { ItemFrame } from "../panels/ItemFrame";
import { Verdict } from "../panels/Chip";
import { sendRulesOp, type RuleRowView } from "../useRulesState";
import { proposalWhyInWords, readableRule } from "../../shared/rule_readable";
import { claimCorrectionInWords, claimInWords, isClaimCheck } from "../../shared/rule_claim_types";

type CheckShape = Record<string, unknown> & { rule?: string };
const fn = (id: string): ChipRef => ({ kind: "function", id });
const path = (p: string): ChipRef => ({ kind: kindOfPath(p), id: p });
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The checkable half as chips joined by short verbs; the three grammar
 *  verbs are drawn, any other verb falls back to its described text. */
export function checkParts(check: CheckShape | undefined, described?: string): Array<ChipRef | string> | null {
  if (!check?.rule) return null;
  const tests = check.allowTests ? ["+ tests"] : [];
  switch (check.rule) {
    case "callers-only": {
      const where = [...strs(check.files).map(path), ...strs(check.functions).map(fn)];
      return ["callers of", fn(String(check.target)), "only in", ...where, ...tests];
    }
    case "import-only":
      return ["only", ...strs(check.files).map(path), "import", { kind: "module", id: String(check.tool) }, ...tests];
    case "calls-through":
      return ["every caller of", fn(String(check.target)), "also calls", fn(String(check.through))];
    case "claim":
      if (isClaimCheck(check)) return [claimInWords(check)];
  }
  return described ? [described] : [check.rule];
}

// the rule's first sentence, whole (2026-10-21: it was cut at 90 characters)
const firstSentence = (t: string) => { const m = /^(.+?[.;:])(\s|$)/s.exec(t); return m ? m[1] : t; };

function scopeParts(c: RuleRowView["constraint"], threads: string[]): Array<ChipRef | string> {
  const s = c.scope as { all?: boolean; files?: string[]; entryPointIds?: string[]; stack?: string[] };
  if (s.all) return [`all threads${threads.length ? ` · routed to ${threads.length}` : ""}`];
  return [
    ...(s.files ?? []).map(path),
    ...(s.entryPointIds ?? []).map((e): ChipRef => ({ kind: "process", id: e, at: e })),
    ...(s.stack?.length ? ["uses", ...s.stack.map((t): ChipRef => ({ kind: "module", id: t }))] : []),
  ];
}

const show = (v: unknown) => (v === null || v === undefined ? "(none)" : typeof v === "string" ? v : JSON.stringify(v));

function History({ c }: { c: RuleRowView["constraint"] }) {
  const ch = [...(c.changes ?? [])].reverse();
  return (
    <>
      <p>stated {c.createdAt.slice(0, 10)} by {c.source}</p>
      {ch.map((x, i) => (
        <p key={i} data-rule-history-entry>
          {x.at.slice(0, 10)} · {x.who ? `${x.who} (${x.by})` : x.by} · {x.field}: {show(x.before)} → {show(x.after)}{x.why ? ` — ${x.why}` : ""}
        </p>
      ))}
    </>
  );
}

export function RuleItem({ row, review }: { row: RuleRowView; review?: boolean }) {
  const c = row.constraint;
  const check = (c.checks?.[0] ?? c.check) as CheckShape | undefined;
  const lead = row.checks[0];
  const parts = checkParts(check, lead?.described);
  // 2026-10-22 (Ben: "not very user readable friendly - seems more like meta
  // data"): the reason, whether it is checked and the sentence it came from,
  // in plain words (src/shared/rule_readable.ts); who proposed it, its scope
  // and the facts it rests on in the fold. The stored rule is unchanged.
  const r = readableRule({ text: c.text, note: c.note, source: c.source, cite: c.cite, checked: !!check || !!c.policy });
  const title = firstSentence(r.statement);
  // RC1 — a claim the code corrected, or narrowed, says what Claude had said
  const corrections = [...(c.checks ?? []), ...(c.check ? [c.check] : [])].flatMap((k) => (isClaimCheck(k) ? [claimCorrectionInWords(k)] : [])).filter(Boolean);
  const facts: ItemFact[] = [
    parts ? { label: "rule", parts } : c.policy ? { label: "rule", text: `${c.policy.rule} ${c.policy.tool}${c.policy.with ? ` → ${c.policy.with}` : ""}` }
      : { label: "rule", text: r.statement !== title ? r.statement : undefined },
    { label: "why", text: r.why ?? undefined },
    // RC4 — a check that passes whatever bypasses its funnel is said, not counted as enforcement
    { label: "checked", text: row.checks.find((x) => x.trivial)?.trivial ? `Checked, but this check cannot catch a bypass: ${row.checks.find((x) => x.trivial)!.trivial}.` : r.check ?? undefined },
    { label: "corrected", text: corrections.length ? corrections.join(" ") : undefined },
    { label: "from", text: r.quote ? `"${r.quote.text}" (${r.quote.where})` : undefined },
    { label: "source", text: [r.source, ...r.notes].filter(Boolean).join(" ") || undefined },
    { label: "scope", parts: scopeParts(c, row.threads) },
    { label: "based on", text: r.basedOn.length ? `${r.basedOn.join(", ")}${r.model ? ` (drafted by ${r.model})` : ""}` : undefined },
  ];
  const offenders = row.checks.flatMap((r) => r.offenders);
  const extraClauses = row.checks.length > 1 ? ` · ${row.checks.length} clauses` : "";
  return (
    <ItemFrame
      data-rule-row={c.id} data-constraint-source={c.source} data-rule-verdict={row.verdict ?? "prose"}
      proposed={c.source === "agent"}
      chip={{ kind: "rule", id: c.id }}
      name={title}
      badges={<>
        <Verdict v={c.source} label={c.source === "human" ? "human" : undefined} />
        {row.verdict ? <span data-rule-live={row.verdict}><Verdict v={row.verdict} /></span> : <Verdict v="prose" />}
      </>}
      facts={facts}
      details={{
        // 2026-10-22 — the fold holds who proposed it, its scope and what it rests on, too
        summary: `Source, scope and history · ${(c.changes?.length ?? 0)} change${c.changes?.length === 1 ? "" : "s"}${extraClauses}${offenders.length ? ` · ${offenders.length} offender${offenders.length === 1 ? "" : "s"}` : ""}`,
        body: <>
          {row.checks.map((r, i) => <p key={i} data-rule-reason>{r.described} → {r.verdict}: {r.reason}{r.offenders.length ? ` (${r.offenders.slice(0, 5).join(", ")}${r.offenders.length > 5 ? ` +${r.offenders.length - 5}` : ""})` : ""}</p>)}
          <History c={c} />
        </>,
      }}
      actions={review && c.source !== "human" ? <>
        <button className="vg-btn" data-tone="go" data-rule-ratify={c.id} onClick={() => sendRulesOp("ratify", c.id)}
          title="You reviewed it: it becomes human-stated and may gate (constraints ratify)">
          <ShieldCheck size={12} strokeWidth={1.5} /> Ratify
        </button>
        <button className="vg-btn" data-tone="no" data-rule-remove={c.id} onClick={() => sendRulesOp("remove", c.id)}
          title="Remove the rule (constraints remove)">
          <Trash2 size={12} strokeWidth={1.5} /> Remove
        </button>
      </> : null}
    />
  );
}

/** A change an agent proposed: the rule before and after, side by side. */
export function ProposalItem({ row, p }: { row: RuleRowView; p: NonNullable<RuleRowView["constraint"]["proposals"]>[number] }) {
  const c = row.constraint as unknown as Record<string, unknown> & RuleRowView["constraint"];
  const patch = p.patch as Record<string, unknown>;
  const fields = Object.keys(patch);
  const render = (field: string, v: unknown) =>
    field === "check" ? (checkParts(v as CheckShape)?.map((x) => (typeof x === "string" ? x : x.id)).join(" ") ?? show(v)) : show(v);
  return (
    <ItemFrame
      data-rule-proposal={`${c.id}:${p.id}`}
      proposed
      chip={{ kind: "rule", id: c.id }}
      name={`Change proposed by ${p.by === "agent" ? "an agent" : p.by}`}
      badges={<Verdict v="proposed" label={`proposal ${p.id}`} />}
      facts={[{ label: "why", text: proposalWhyInWords(p.why) }]}
      actions={<>
        <button className="vg-btn" data-tone="go" data-rule-accept={`${c.id}:${p.id}`} onClick={() => sendRulesOp("accept", c.id, p.id)}
          title={`Apply it (constraint accept ${c.id} ${p.id})`}>
          <Check size={12} strokeWidth={1.5} /> Accept
        </button>
        <button className="vg-btn" data-tone="no" data-rule-reject={`${c.id}:${p.id}`} onClick={() => sendRulesOp("reject", c.id, p.id)}
          title={`Drop it (constraint reject ${c.id} ${p.id})`}>
          <X size={12} strokeWidth={1.5} /> Reject
        </button>
      </>}
    >
      <div className="vg-diff" data-rule-diff>
        {fields.map((f) => (
          <React.Fragment key={f}>
            <div className="vg-was"><small>{f} · before</small>{render(f, c[f])}</div>
            <div className="vg-now"><small>{f} · after</small>{render(f, patch[f])}</div>
          </React.Fragment>
        ))}
      </div>
    </ItemFrame>
  );
}
