// The Plan panel's items (2026-10-05, GUI brief M4): each planned item in the
// one ItemFrame — its chip and name, status and verdict pills, up to three
// bullets of typed chips from `plan check`'s structured facts, and the prose
// verdict folded ("Why realised · 14 files · 9 entry points").

import React from "react";
import { Check, Trash2, ArrowUpRight, ExternalLink, Undo2 } from "lucide-react";
import type { Plan, PlanFinding, PlanSection, WriteCell } from "../../shared/plan_types";
import { planItemId } from "../../shared/plan_types";
import { planItemFacts } from "../../shared/plan_facts";
import { ItemFrame } from "../panels/ItemFrame";
import { Chip, Verdict } from "../panels/Chip";
import { sendPlanOp, promotePlanRule } from "../usePlanState";

const small: React.CSSProperties = { fontSize: "var(--fs-12)", color: "var(--text-muted)", lineHeight: 1.5 };

function Fold({ it, finding }: { it: any; finding?: PlanFinding }) {
  const changed = it.agreedAs
    ? Object.keys({ ...it, ...it.agreedAs }).filter((k) => k !== "status" && k !== "agreedAs" && JSON.stringify(it[k]) !== JSON.stringify(it.agreedAs[k]))
    : [];
  return (
    <>
      {finding?.detail && <p data-plan-detail>{finding.detail}</p>}
      {finding?.missing?.length ? <p>missing on the real thread: {finding.missing.map((m) => `${m}${finding.missingWhy?.[m] ? ` (${finding.missingWhy[m]})` : ""}`).join("; ")}</p> : null}
      {finding?.suggestions?.length ? <p>did you mean: {finding.suggestions.join(", ")}</p> : null}
      {(it.source || it.groundedIn !== undefined) && (
        <p data-plan-grounded={it.groundedIn === null ? "inferred" : "quoted"}>
          {it.source ? `from ${it.source} · ` : ""}
          {it.groundedIn === null ? "inferred — not in the documents" : it.groundedIn ? `“${it.groundedIn}”` : ""}
        </p>
      )}
      {changed.length > 0 && (
        <p data-plan-change style={{ color: "var(--accent-warning)" }}>
          changed by an agent: {changed.map((k) => `${k}: ${JSON.stringify(it.agreedAs[k]) ?? "(absent)"} → ${JSON.stringify(it[k]) ?? "(absent)"}`).join("; ")}
        </p>
      )}
    </>
  );
}

export function PlanItem({ plan, section, it, finding, off }: { plan: Plan; section: PlanSection; it: any; finding?: PlanFinding; off?: boolean }) {
  const id = planItemId(section, it);
  const view = planItemFacts(plan, section, it, finding);
  const facts = finding?.facts ?? view.facts;
  const numbers = finding?.numbers ?? view.numbers;
  const status = it.status as string;
  const summary = finding
    ? [`Why ${finding.verdict === "not-built" ? "not built" : finding.verdict}`, ...Object.entries(numbers).map(([k, n]) => `${n} ${k}`)].join(" · ")
    : it.agreedAs || it.groundedIn !== undefined || it.source ? "Where it came from" : null;
  return (
    <ItemFrame
      data-plan-item={`${section}:${id}`} data-plan-status={status} data-plan-verdict={finding?.verdict}
      chip={view.chip} name={view.name}
      badges={<>
        {off && <span data-plan-off-objective title="What it serves shares no word with the objective — a word-match guess, not a verdict. Say how it serves the objective, or drop it."><Verdict v="guess" label="serves the objective?" /></span>}
        <Verdict v={status} label={status === "promoted" ? `promoted · ${it.constraintId}` : undefined} />
        {finding && <Verdict v={finding.verdict} />}
      </>}
      facts={facts}
      details={summary ? { summary, body: <Fold it={it} finding={finding} /> } : null}
      actions={<>
        {status === "proposed" && it.agreedAs && (
          <button className="vg-btn" data-plan-reject onClick={() => sendPlanOp({ op: "reject", section, id })} title="Reject the change — the agreed version comes back">
            <Undo2 size={12} strokeWidth={1.5} /> Reject change
          </button>
        )}
        {status === "proposed" && (
          <button className="vg-btn" data-tone="go" data-plan-agree onClick={() => sendPlanOp({ op: "agree", section, id })} title="Agree to this planned item">
            <Check size={12} strokeWidth={1.5} /> Agree
          </button>
        )}
        {status !== "promoted" && (
          <button className="vg-btn" data-plan-drop onClick={() => sendPlanOp({ op: "drop", section, id })} title="Drop it (kept on the record)">
            <Trash2 size={12} strokeWidth={1.5} /> Drop
          </button>
        )}
        {section === "policies" && status !== "promoted" && (
          <button className="vg-btn" data-plan-promote onClick={() => promotePlanRule(id)}
            title="Copy it into .vibegraph/constraints.json as a human-stated rule — checked by `check` and the hooks, and it may block">
            <ArrowUpRight size={12} strokeWidth={1.5} /> Promote
          </button>
        )}
        {section === "policies" && status === "promoted" && it.constraintId && (
          <Chip kind="rule" id={it.constraintId} label={`§ ${it.constraintId}`} />
        )}
        {finding?.entryPointId && (
          <button className="vg-btn" data-plan-open-thread onClick={() => document.dispatchEvent(new CustomEvent("vg-open-thread", { detail: { entryPointId: finding.entryPointId } }))}
            title="Open the real thread it matched">
            <ExternalLink size={12} strokeWidth={1.5} /> Thread
          </button>
        )}
      </>}
    />
  );
}

/** Who may write which zone (the plan), and who does (the code). */
export function WriteMatrix({ findings, matrix }: { findings: PlanFinding[]; matrix: WriteCell[] }) {
  if (!matrix.length) return null;
  const zones = [...new Set(matrix.map((c) => c.zone))];
  const who = [...new Set(matrix.map((c) => c.principal))];
  const cellOf = (p: string, z: string) => matrix.find((c) => c.principal === p && c.zone === z);
  const verdict = (z: string) => findings.find((f) => f.section === "stores" && f.id === `${z}:writers`);
  return (
    <div data-plan-write-matrix style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: "var(--fs-12)" }}>
        <thead><tr><th />{zones.map((z) => (
          <th key={z} data-verdict={verdict(z)?.verdict} title={verdict(z)?.detail} style={{ textAlign: "left", padding: 4 }}>
            <Chip kind="zone" id={z} />{verdict(z) ? <> <Verdict v={verdict(z)!.verdict} /></> : null}
          </th>))}</tr></thead>
        <tbody>
          {who.map((p) => (
            <tr key={p}>
              <td style={{ padding: 4 }}><Chip kind="identity" id={p} /></td>
              {zones.map((z) => {
                const c = cellOf(p, z);
                const state = !c ? "" : c.writes.length ? (c.allowed ? "writes" : "violation") : "allowed";
                return (
                  <td key={z} data-write-cell={`${p}|${z}`} data-state={state || "none"} title={c?.writes.join("\n") || undefined} style={{ padding: 4 }}>
                    {state === "violation" ? <Verdict v="violated" label="writes — not allowed" /> : state === "writes" ? <Verdict v="pass" label={`writes (${c!.writes.length})`} /> : state === "allowed" ? <span style={small}>allowed</span> : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
