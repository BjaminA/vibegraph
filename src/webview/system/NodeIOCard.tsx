// IN → PROCESS → OUT, the inspector's card for one box (2026-10-06). Three
// bands read left to right as the data moves: what reaches it (one row per
// sender, with the keys the call spells and the rules on that edge), what it
// does (the vocabulary's words, each with its evidence a click away), and who
// takes what it produces (through a store: who reads it next). Chips are the
// software-spec chips (Chip.tsx) — a key is a JSON chip, a rule a rule chip,
// a box its kind's chip; a word is an op pill in its accent. Choosing a row
// lights that path on the map. Every line comes from node_io.ts; nothing here
// derives.

import React, { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { ArchModelRecord, ArchNodeRecord } from "../../shared/protocol";
import { nodeIO, verbOf, type IoRow, type NodeIO, type Vocabulary } from "../../shared/node_io";
import type { KindId } from "../../shared/kinds";
import { Chip } from "../panels/Chip";
import { opIcon } from "./opIcons";

export interface LitPath { nodes: string[]; edges: string[] }
const KEY_CAP = 6;

function kindOf(n: ArchNodeRecord | undefined): KindId {
  if (!n) return "module";
  if (n.zoneOf || n.id.startsWith("zone:")) return "zone";
  if (n.id.startsWith("store:") || n.category === "database" || n.category === "storage") return "store";
  if (n.kind === "actor" || n.category === "external") return "external";
  if (n.kind === "cluster" || n.kind === "hub") return "process";
  return "module";
}

const band: React.CSSProperties = { marginTop: 12, paddingLeft: 8, borderLeft: "2px solid var(--border-edge)" };
const head = (tone: string): React.CSSProperties => ({ fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: tone, marginBottom: 4 });
const quiet: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)" };

function Row({ r, side, byId, nodeId, lit, onLight }: { r: IoRow; side: "in" | "out"; byId: Map<string, ArchNodeRecord>; nodeId: string; lit: boolean; onLight?: (p: LitPath | null) => void }) {
  const path: LitPath = { nodes: [nodeId, r.node, ...(r.path ?? []).map((p) => p.node)], edges: [r.edge] };
  const keys = r.keys.slice(0, KEY_CAP);
  return (
    <div data-io-row={side} data-io-node={r.node} data-io-op={r.op} data-active={lit ? "true" : "false"}
      role={onLight ? "button" : undefined} tabIndex={onLight ? 0 : undefined}
      onClick={onLight ? () => onLight(lit ? null : path) : undefined}
      onKeyDown={onLight ? (e) => { if (e.key === "Enter") onLight(lit ? null : path); } : undefined}
      title={[r.text ? `the call: ${r.text}` : "", r.ref ? `at ${r.ref.file}` : "", `via ${r.via}`].filter(Boolean).join("\n")}
      style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, padding: "4px 4px", borderRadius: 6, cursor: onLight ? "pointer" : "default",
        background: lit ? "color-mix(in oklab, var(--accent-thread) 12%, transparent)" : "transparent",
      }}>
      <Chip kind={kindOf(byId.get(r.node))} id={r.node} label={r.label} focusable={false} />
      <span data-io-op-label style={{ ...quiet, color: "var(--text-secondary)" }}>{r.op === "hop" ? r.via : r.op}</span>
      {keys.map((k) => <Chip key={k} kind="json" id={k} focusable={false} />)}
      {r.keys.length > KEY_CAP && <span style={quiet}>{`+${r.keys.length - KEY_CAP}`}</span>}
      {r.keysFrom === "plan" && <span style={quiet}>(planned keys)</span>}
      {r.rules.map((x) => <Chip key={x} kind="rule" id={x} label={x.length > 40 ? `${x.slice(0, 39)}…` : x} focusable={false} />)}
      {r.path?.length ? (
        <span data-io-path style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <ArrowRight size={16} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
          {r.path.map((p) => (
            <span key={p.node} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Chip kind={kindOf(byId.get(p.node))} id={p.node} label={p.label} focusable={false} />
              <span style={quiet}>{p.ops.map(verbOf).join("/")}</span>
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

export function NodeIOCard({ model, nodeId, vocab, onLight }: { model: ArchModelRecord; nodeId: string; vocab?: Vocabulary; onLight?: (p: LitPath | null) => void }) {
  const io: NodeIO = nodeIO(model, nodeId, vocab);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const [lit, setLit] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const light = (key: string) => (p: LitPath | null) => { setLit(p ? key : null); onLight?.(p); };
  return (
    <div data-node-io={nodeId}>
      <div data-io-band="in" style={band}>
        <div style={head("var(--accent-io)")}>{`In · ${io.in.length}`}</div>
        {io.in.length ? io.in.map((r) => <Row key={`${r.edge}:${r.op}`} r={r} side="in" byId={byId} nodeId={nodeId} lit={lit === `in:${r.edge}:${r.op}`} onLight={onLight ? light(`in:${r.edge}:${r.op}`) : undefined} />)
          : <div style={quiet}>{io.silent.find((s) => /sending data in|outside caller/.test(s)) ?? "—"}</div>}
      </div>
      <div data-io-band="process" style={band}>
        <div style={head("var(--text-primary)")}>Process</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {io.process.map((p) => {
            const Icon = opIcon(p.icon);
            return (
              <button key={p.word} data-io-word={p.word} data-project={p.project ? "true" : undefined} className="vg-op" aria-expanded={why === p.word}
                onClick={() => setWhy(why === p.word ? null : p.word)} title={p.definition}
                style={{ ["--a" as string]: `var(${p.accent})`, cursor: "pointer" } as React.CSSProperties}>
                <Icon size={16} strokeWidth={1.5} aria-hidden />{p.label}
              </button>
            );
          })}
        </div>
        {why && (() => {
          const p = io.process.find((x) => x.word === why)!;
          return (
            <div data-io-evidence={why} style={{ marginTop: 4, ...quiet }}>
              <div style={{ color: "var(--text-secondary)" }}>{p.definition}</div>
              {p.evidence.map((e) => <div key={e} style={{ fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{`· ${e}`}</div>)}
            </div>
          );
        })()}
        {!io.process.length && <div style={quiet}>{io.silent.find((s) => /operation word/.test(s))}</div>}
      </div>
      <div data-io-band="out" style={band}>
        <div style={head("var(--accent-io-write)")}>{`Out · ${io.out.length}`}</div>
        {io.out.length ? io.out.map((r) => <Row key={`${r.edge}:${r.op}`} r={r} side="out" byId={byId} nodeId={nodeId} lit={lit === `out:${r.edge}:${r.op}`} onLight={onLight ? light(`out:${r.edge}:${r.op}`) : undefined} />)
          : <div style={quiet}>{io.silent.find((s) => /reader|leaving/.test(s)) ?? "—"}</div>}
      </div>
      {io.silent.some((s) => /payload keys/.test(s)) && <div style={{ ...quiet, marginTop: 8 }}>{io.silent.find((s) => /payload keys/.test(s))}</div>}
    </div>
  );
}
