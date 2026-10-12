// "Classify N unclassified tools" (2026-10-12), on the Tools lens. Estimate
// first, spending nothing; then the one model call (src/server/
// classify_server.ts). Its answers are a MODEL's classification: they wait in
// the inbox for a person, and they never loosen the run floor.

import React from "react";
import { Sparkles } from "lucide-react";
import type { ArchModelRecord } from "../../shared/protocol";
import { bridge, type ExtensionMessage } from "../types";

type Estimate = { tools: number; names: string[]; tokens: number };

export function ClassifyTools({ model }: { model: ArchModelRecord }) {
  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const [busy, setBusy] = React.useState<"estimate" | "run" | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  React.useEffect(() => {
    const h = (m: ExtensionMessage) => {
      const x = m as unknown as { type: string; payload?: any };
      if (x.type !== "classify-result") return;
      const p = x.payload ?? {};
      setBusy(null);
      if (!p.ok) { setNote(p.error ?? "failed"); setEstimate(null); return; }
      if (p.action === "estimate") { setEstimate({ tools: p.tools, names: p.names ?? [], tokens: p.tokens }); setNote(null); }
      else { setEstimate(null); setNote(p.detail ?? "done"); }
    };
    bridge.onMessage(h);
    return () => bridge.removeListener(h);
  }, []);
  const unclassified = model.nodes.filter((n) => n.kind === "tool" && n.category === "unknown" && n.origin !== "project").length;
  if (!unclassified && !note) return null;
  const send = (type: "classify-estimate" | "classify-run") => { setBusy(type === "classify-run" ? "run" : "estimate"); setNote(null); bridge.postMessage({ type } as never); };
  const btn: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 4, border: "1px solid var(--border-edge)", borderRadius: 4,
    padding: "4px 8px", cursor: busy ? "default" : "pointer", background: "transparent",
    color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", opacity: busy ? 0.6 : 1,
  };
  const quiet: React.CSSProperties = { color: "var(--text-muted)", padding: "0 4px", fontSize: "var(--fs-11)" };
  return (
    <span data-classify-tools style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {!estimate && unclassified > 0 && (
        <button data-classify-ask disabled={!!busy} onClick={() => send("classify-estimate")} style={btn}
          title="Ask a model what the unclassified tools are, from how this code uses them and what its docs say — the estimate comes first; nothing is decided until a person ratifies it in the inbox">
          <Sparkles size={16} strokeWidth={1.5} />{busy === "estimate" ? "Counting…" : `Classify ${unclassified} unclassified tool${unclassified === 1 ? "" : "s"}`}
        </button>
      )}
      {estimate && (
        <>
          <span data-classify-estimate style={quiet} title={estimate.names.join(", ")}>{`${estimate.tools} tool${estimate.tools === 1 ? "" : "s"}, 1 call, ~${Math.max(1, Math.round(estimate.tokens / 1000))}k tokens`}</span>
          <button data-classify-run disabled={!!busy} onClick={() => send("classify-run")} style={btn}>{busy === "run" ? "Classifying… (a minute or two)" : "Classify"}</button>
          <button disabled={!!busy} onClick={() => setEstimate(null)} style={btn}>Cancel</button>
        </>
      )}
      {note && <span data-classify-note style={quiet}>{note}</span>}
    </span>
  );
}
