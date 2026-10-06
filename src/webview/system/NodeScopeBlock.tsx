// "Scope this node" in the inspector (2026-10-06, part 3): ask Claude to
// describe a box the code says little about, in the vocabulary's words,
// citing what it was shown (src/server/node_scope.ts). The reply waits here
// as a PROPOSAL — every word and row with its citations, an uncited one faded
// as INFERRED, what the gate refused counted — until the person ratifies or
// rejects it. Only a ratified scope joins In → Process → Out.

import React, { useEffect, useState } from "react";
import { Sparkles, Check, X } from "lucide-react";
import { bridge, type ExtensionMessage } from "../types";
import type { ArchNodeRecord } from "../../shared/protocol";
import type { NodeScopeRecord, ScopeBody, Vocabulary } from "../../shared/node_io";
import { CORE_VOCABULARY } from "../../shared/node_io";
import { Chip } from "../panels/Chip";
import { opIcon } from "./opIcons";

const quiet: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)" };
const btn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--border-edge)", borderRadius: 4, padding: "4px 8px",
  background: "transparent", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", cursor: "pointer",
};
const cites = (ev: string[]) => (ev.length ? ev.join(", ") : "INFERRED — no citation");

function Body({ b, byId, vocab }: { b: ScopeBody; byId: Map<string, ArchNodeRecord>; vocab: Vocabulary }) {
  const [why, setWhy] = useState(false);
  return (
    <div>
      {b.summary && <div data-scope-summary style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", color: "var(--text-primary)", marginBottom: 4 }}>{b.summary}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {b.words.map((w) => {
          const def = vocab.words.find((x) => x.id === w.word);
          const Icon = opIcon(def?.icon ?? "");
          return (
            <span key={w.word} data-scope-word={w.word} data-inferred={w.evidence.length ? undefined : "true"} className="vg-op" title={`${def?.definition ?? w.word}\n${cites(w.evidence)}`}
              style={{ ["--a" as string]: `var(${def?.accent ?? "--text-secondary"})`, borderStyle: "dashed", opacity: w.evidence.length ? 1 : 0.55 } as React.CSSProperties}>
              <Icon size={16} strokeWidth={1.5} aria-hidden />{def?.label ?? w.word}
            </span>
          );
        })}
      </div>
      {(["in", "out"] as const).map((side) => b[side].map((r) => (
        <div key={`${side}:${r.node}`} data-scope-row={side} data-inferred={r.evidence.length ? undefined : "true"} title={cites(r.evidence)}
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 4, opacity: r.evidence.length ? 1 : 0.55 }}>
          <span style={quiet}>{side === "in" ? "from" : "to"}</span>
          <Chip kind={byId.get(r.node)?.kind === "cluster" ? "process" : "module"} id={r.node} label={byId.get(r.node)?.label ?? r.node} focusable={false} />
          {r.what && <span style={{ ...quiet, color: "var(--text-secondary)" }}>{r.what}</span>}
        </div>
      )))}
      <button data-scope-why onClick={() => setWhy(!why)} style={{ ...btn, border: "none", padding: "4px 0", color: "var(--text-muted)" }}>
        {why ? "hide the citations" : `citations${b.refused.length ? ` · ${b.refused.length} refused by the gate` : ""}`}
      </button>
      {why && (
        <div data-scope-citations style={{ ...quiet, fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {b.words.map((w) => <div key={w.word}>{`${w.word}: ${cites(w.evidence)}`}</div>)}
          {[...b.in, ...b.out].map((r) => <div key={r.node}>{`${r.node}: ${cites(r.evidence)}`}</div>)}
          {b.refused.map((r, i) => <div key={i} data-scope-refused style={{ color: "var(--accent-warning)" }}>{`refused ${r.item}: ${r.reason}`}</div>)}
        </div>
      )}
    </div>
  );
}

export function NodeScopeBlock({ nodeId, scope, byId, vocab = CORE_VOCABULARY, empty }: {
  nodeId: string; scope?: NodeScopeRecord; byId: Map<string, ArchNodeRecord>; vocab?: Vocabulary;
  /** the IR said nothing about what the box does: the ask is the main action */
  empty: boolean;
}) {
  const [busy, setBusy] = useState<null | "scope" | "ratify" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    const h = (m: ExtensionMessage) => {
      const x = m as unknown as { type: string; payload?: { node?: string; ok?: boolean; error?: string } };
      if (x.type !== "arch-scope-result" || x.payload?.node !== nodeId) return;
      setBusy(null);
      setError(x.payload.ok ? null : x.payload.error ?? "failed");
    };
    bridge.onMessage(h);
    return () => bridge.removeListener(h);
  }, [nodeId]);
  const send = (type: "arch-scope" | "arch-scope-ratify" | "arch-scope-reject") => {
    setBusy(type === "arch-scope" ? "scope" : type === "arch-scope-ratify" ? "ratify" : "reject");
    setError(null);
    bridge.postMessage({ type, payload: { node: nodeId, ...(type === "arch-scope" && note.trim() ? { guidance: note.trim() } : {}) } } as never);
  };
  const p = scope?.proposed, r = scope?.ratified;
  return (
    <div data-node-scope={nodeId} data-scope-state={p ? "proposed" : r ? "ratified" : "none"} style={{ marginTop: 12, paddingLeft: 8, borderLeft: "2px dashed var(--proposed-border)" }}>
      {r && !p && (
        <div data-scope-ratified style={{ ...quiet, marginBottom: 4 }}>
          {`scoped by ${r.model}, ratified ${String(r.ratifiedAt ?? r.at).slice(0, 10)} — its words and rows are in the bands above, marked scoped`}
          {r.summary && <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>{r.summary}</div>}
        </div>
      )}
      {p && (
        <div data-scope-proposal>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--proposed-border)", marginBottom: 4 }}>
            {`Proposed scope · ${p.model}`}
          </div>
          <Body b={p} byId={byId} vocab={vocab} />
          <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
            <button data-scope-ratify disabled={!!busy} onClick={() => send("arch-scope-ratify")} style={btn}><Check size={16} strokeWidth={1.5} />Ratify</button>
            <button data-scope-reject disabled={!!busy} onClick={() => send("arch-scope-reject")} style={btn}><X size={16} strokeWidth={1.5} />Reject</button>
          </div>
        </div>
      )}
      {!p && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {empty && !r && <div style={quiet}>The code does not say what this box does. Claude can describe it from its call sites{byId.get(nodeId)?.roleStatedBy ? " and its software spec" : ""}, citing each claim — you ratify.</div>}
          <input data-scope-note value={note} onChange={(e) => setNote(e.target.value)} placeholder="what to look at (optional)"
            style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-edge)", borderRadius: 4, padding: "4px 8px", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)" }} />
          <button data-scope-ask disabled={!!busy} onClick={() => send("arch-scope")} style={{ ...btn, alignSelf: "flex-start" }}>
            <Sparkles size={16} strokeWidth={1.5} />{busy === "scope" ? "Scoping… (about a minute)" : r ? "Re-scope with Claude" : "Scope with Claude"}
          </button>
        </div>
      )}
      {error && <div data-scope-error style={{ ...quiet, color: "var(--accent-error)", marginTop: 4 }}>{error}</div>}
    </div>
  );
}
