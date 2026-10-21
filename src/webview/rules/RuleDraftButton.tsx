// "Propose rules from the architecture" (2026-10-19, PLAN-M-RULES M2), in the
// Rules panel. Estimate first, spending nothing; then the one model call
// (src/server/rule_draft_server.ts). What it proposes is a MODEL's: each rule
// cites the facts it rests on, lands agent-stated in "Awaiting you", and only
// a person's Ratify makes it the project's. What the gate refused, and what
// the model suspected with no fact behind it, are shown — never stored.

import React from "react";
import { Sparkles } from "lucide-react";
import { bridge, type ExtensionMessage } from "../types";

interface Result { stored: string[]; checkProposals: string[]; refused: Array<{ text: string; reason: string }>; withoutEvidence: string[] }
const small: React.CSSProperties = { fontSize: "var(--fs-12)", color: "var(--text-muted)", lineHeight: 1.5 };

export function RuleDraftButton() {
  const [estimate, setEstimate] = React.useState<{ facts: number; tokens: number } | null>(null);
  const [busy, setBusy] = React.useState<"estimate" | "run" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Result | null>(null);
  React.useEffect(() => {
    const h = (m: ExtensionMessage) => {
      const x = m as unknown as { type: string; payload?: any };
      if (x.type !== "rule-draft-result") return;
      const p = x.payload ?? {};
      setBusy(null);
      if (!p.ok) { setError(p.error ?? "failed"); setEstimate(null); return; }
      if (p.action === "estimate") { setEstimate({ facts: p.facts ?? 0, tokens: p.tokens ?? 0 }); setError(null); }
      else { setEstimate(null); setResult({ stored: p.stored ?? [], checkProposals: p.checkProposals ?? [], refused: p.refused ?? [], withoutEvidence: p.withoutEvidence ?? [] }); }
    };
    bridge.onMessage(h);
    return () => bridge.removeListener(h);
  }, []);
  const send = (type: "rule-draft-estimate" | "rule-draft-run") => { setBusy(type === "rule-draft-run" ? "run" : "estimate"); setError(null); setResult(null); bridge.postMessage({ type } as never); };

  return (
    <div data-rule-draft className="vg-queue" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {!estimate && (
          <button type="button" className="vg-btn" data-rule-draft-ask disabled={!!busy} onClick={() => send("rule-draft-estimate")}
            title="Ask a model which rules this codebase should keep, from its architecture: the processes, the tools by role, the funnels, the hops, silent-fail settings, unguarded flows and the rule-shaped sentences in its prose. The estimate comes first.">
            <Sparkles size={16} strokeWidth={1.5} aria-hidden />{busy === "estimate" ? "Reading the architecture…" : "Propose rules from the architecture"}
          </button>
        )}
        {estimate && (
          <>
            <span data-rule-draft-estimate style={small}>{`${estimate.facts} facts, 1 model call, ~${Math.max(1, Math.round(estimate.tokens / 1000))}k tokens`}</span>
            <button type="button" className="vg-btn" data-rule-draft-run disabled={!!busy} onClick={() => send("rule-draft-run")}>{busy === "run" ? "Proposing… (a minute or two)" : "Propose"}</button>
            <button type="button" className="vg-btn" disabled={!!busy} onClick={() => setEstimate(null)}>Cancel</button>
          </>
        )}
      </div>
      {!estimate && !result && !error && (
        <div style={small}>Each proposal must cite the facts it rests on and use the project's own names for its scope; its check is run against the code first. They wait here for you — nothing is the project's until you ratify it.</div>
      )}
      {error && <div data-rule-draft-error style={{ ...small, color: "var(--accent-error)" }}>{error}</div>}
      {result && (
        <div data-rule-draft-result style={small}>
          <div><b data-rule-draft-stored={result.stored.length}>{result.stored.length}</b> proposed{result.stored.length ? ` (${result.stored.join(", ")}) — below, awaiting you` : ""}.</div>
          {result.checkProposals.length > 0 && (
            <div data-rule-draft-checks>{result.checkProposals.length} check{result.checkProposals.length === 1 ? "" : "s"} proposed on rules you already have ({result.checkProposals.join(", ")}) — accept or reject each below.</div>
          )}
          {result.refused.length > 0 && (
            <details data-rule-draft-refused><summary>{result.refused.length} refused by the gate</summary>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>{result.refused.map((r, i) => <li key={i}>"{r.text.slice(0, 100)}" — {r.reason}</li>)}</ul>
            </details>
          )}
          {result.withoutEvidence.length > 0 && (
            <details data-rule-draft-without><summary>{result.withoutEvidence.length} suspected with no fact behind them — for you to consider</summary>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>{result.withoutEvidence.map((w, i) => <li key={i}>{w.slice(0, 160)}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
