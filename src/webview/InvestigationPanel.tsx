// The INVESTIGATION BOARD (2026-09-29, src/server/investigations.ts): pin
// nodes from as many threads as a bug crosses (the tooltip's clipboard
// button), write what you found beside each, and hand the lot to an agent.
//
// Always MOUNTED so a pin taken while the board is closed still lands: the
// pin opens it. Every change is saved at once (the server validates and
// writes `.vibegraph/investigations/<name>.json`); "Hand off" renders the
// Markdown an agent reads — also in the export bundle and on MCP
// `vibegraph_investigation`.

import React, { useEffect, useRef, useState } from "react";
import { ClipboardList, ExternalLink, Plus, Trash2, X, Send, Copy } from "lucide-react";
import { bridge, type ExtensionMessage } from "./types";
import { belowToolbar, heightBelowToolbar } from "./TopToolbar";

interface Pin {
  file: string; irNodeId: string; label: string; kind?: string;
  entryPointId: string | null; note: string; addedAt: string;
}
interface Investigation { version: 1; name: string; question: string; pins: Pin[]; createdAt: string; updatedAt: string }
interface Listed { name: string; question: string; pins: number; updatedAt: string }
interface State { list: Listed[]; current?: Investigation | null; handoff?: { name: string; path: string; text: string }; error?: string }

const mono = "var(--font-mono)";
const small: React.CSSProperties = { fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 };
const iconBtn: React.CSSProperties = {
  background: "none", border: "1px solid var(--border-edge)", borderRadius: 4, color: "var(--text-secondary)",
  cursor: "pointer", padding: "4px 8px", display: "flex", alignItems: "center", gap: 4, fontSize: "var(--fs-11)", fontFamily: "var(--font-ui)",
};
const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--bg-canvas)", color: "var(--text-primary)",
  border: "1px solid var(--border-edge)", borderRadius: 4, padding: 8, fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", resize: "vertical",
};

function freshName(list: Listed[]): string {
  const d = new Date();
  const base = `investigation-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const taken = new Set(list.map((l) => l.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

function blank(name: string): Investigation {
  const now = new Date().toISOString();
  return { version: 1, name, question: "", pins: [], createdAt: now, updatedAt: now };
}

export function InvestigationPanel({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const [list, setList] = useState<Listed[]>([]);
  const [current, setCurrent] = useState<Investigation | null>(null);
  const [handoff, setHandoff] = useState<State["handoff"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const currentRef = useRef(current);
  currentRef.current = current;
  const listRef = useRef(list);
  listRef.current = list;
  const adoptNext = useRef(false);
  const request = (type: "investigation-get" | "investigation-delete", name: string) => {
    adoptNext.current = true;
    setHandoff(null);
    bridge.postMessage({ type, payload: { name } } as never);
  };

  const save = (inv: Investigation) => {
    setCurrent(inv);
    bridge.postMessage({ type: "investigation-save", payload: { investigation: inv } } as never);
  };

  useEffect(() => {
    const handler = (msg: ExtensionMessage) => {
      if ((msg as { type: string }).type !== "investigation-state") return;
      const s = (msg as unknown as { payload: State }).payload;
      setList(s.list);
      setError(s.error ?? null);
      // A save's echo must not replace the draft: the person may have typed
      // since it was sent. Only a get or a delete hands the board a new one.
      if (s.current !== undefined && adoptNext.current) {
        adoptNext.current = false;
        setCurrent(s.current);
      }
      if (s.handoff) setHandoff(s.handoff);
    };
    bridge.onMessage(handler);
    bridge.postMessage({ type: "investigation-list" } as never);
    return () => bridge.removeListener(handler);
  }, []);

  // A pin from any tooltip: into the open investigation, or a new one.
  useEffect(() => {
    const onPin = (e: Event) => {
      const d = (e as CustomEvent).detail as Partial<Pin> | undefined;
      if (!d?.file || !d.irNodeId) return;
      const inv = currentRef.current ?? blank(freshName(listRef.current));
      if (inv.pins.some((p) => p.file === d.file && p.irNodeId === d.irNodeId)) { onOpen(); return; }
      const pin: Pin = {
        file: d.file, irNodeId: d.irNodeId, label: d.label ?? d.irNodeId, ...(d.kind ? { kind: d.kind } : {}),
        entryPointId: d.entryPointId ?? null, note: "", addedAt: new Date().toISOString(),
      };
      save({ ...inv, pins: [...inv.pins, pin] });
      setHandoff(null);
      onOpen();
    };
    document.addEventListener("vg-investigation-pin", onPin);
    return () => document.removeEventListener("vg-investigation-pin", onPin);
  }, [onOpen]);

  if (!open) return null;

  const patchPin = (i: number, patch: Partial<Pin>) => {
    if (!current) return;
    setCurrent({ ...current, pins: current.pins.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  };
  const commit = () => { if (current) save(current); };

  return (
    <div data-investigation-panel style={{
      position: "absolute", top: belowToolbar(16), right: 16, width: 460, boxSizing: "border-box",
      maxHeight: heightBelowToolbar(16), overflowY: "auto", background: "var(--bg-node)",
      border: "1px solid var(--border-edge)", borderRadius: 6, padding: 16, zIndex: 60,
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ClipboardList size={14} strokeWidth={1.5} color="var(--text-muted)" />
        <span style={{ fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text-primary)" }}>Investigation</span>
        <select
          data-investigation-select
          value={current?.name ?? ""}
          onChange={(e) => request("investigation-get", e.target.value)}
          style={{ ...field, width: "auto", flex: 1, padding: "4px 8px", fontFamily: mono, fontSize: "var(--fs-11)" }}
        >
          {!current && <option value="">(none yet — pin a node)</option>}
          {current && !list.some((l) => l.name === current.name) && <option value={current.name}>{current.name}</option>}
          {list.map((l) => <option key={l.name} value={l.name}>{l.name} · {l.pins}</option>)}
        </select>
        <button data-investigation-new title="Start a new investigation" style={iconBtn}
          onClick={() => { setHandoff(null); save(blank(freshName(list))); }}>
          <Plus size={12} strokeWidth={1.5} />
        </button>
        <button onClick={onClose} title="Close" aria-label="Close investigation board"
          style={{ ...iconBtn, border: "none" }}>
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {!current ? (
        <div style={small}>
          Pin nodes from any thread with the clipboard button in a node's tooltip. Each pin keeps where it came
          from; write what you found beside it, then hand the board to an agent as one document.
        </div>
      ) : (
        <>
          <textarea
            data-investigation-question
            placeholder="What are you investigating? (the symptom, where it shows, what you suspect)"
            value={current.question}
            rows={3}
            onChange={(e) => setCurrent({ ...current, question: e.target.value })}
            onBlur={commit}
            style={field}
          />
          {current.pins.length === 0 && <div style={small}>No pins yet. Open a thread and use a node's clipboard button.</div>}
          {current.pins.map((p, i) => (
            <div key={`${p.file}|${p.irNodeId}`} data-investigation-pin={p.irNodeId}
              style={{ display: "flex", flexDirection: "column", gap: 4, borderLeft: "2px solid color-mix(in oklab, var(--accent-thread) 55%, transparent)", paddingLeft: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: mono, fontSize: "var(--fs-12)", color: "var(--text-primary)", fontWeight: 600 }}>{p.label}</span>
                <span style={{ ...small, fontFamily: mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={p.file}>{p.file}</span>
                {p.entryPointId && (
                  <button title={`Open the thread this was pinned on (${p.entryPointId})`} style={{ ...iconBtn, border: "none", padding: 2 }}
                    onClick={() => document.dispatchEvent(new CustomEvent("vg-open-thread", { detail: { entryPointId: p.entryPointId } }))}>
                    <ExternalLink size={12} strokeWidth={1.5} />
                  </button>
                )}
                <button data-investigation-remove title="Remove this pin" style={{ ...iconBtn, border: "none", padding: 2 }}
                  onClick={() => save({ ...current, pins: current.pins.filter((_, j) => j !== i) })}>
                  <Trash2 size={12} strokeWidth={1.5} />
                </button>
              </div>
              {p.entryPointId && <div style={{ ...small, fontFamily: mono }}>on {p.entryPointId}</div>}
              <textarea
                data-investigation-note
                placeholder="What you found here"
                value={p.note}
                rows={2}
                onChange={(e) => patchPin(i, { note: e.target.value })}
                onBlur={commit}
                style={field}
              />
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button data-investigation-handoff disabled={current.pins.length === 0}
              title="Write the handoff: the question, every pin with its note and its code as it is now — for an agent"
              style={{ ...iconBtn, color: "var(--accent-thread)", opacity: current.pins.length ? 1 : 0.5 }}
              onClick={() => { commit(); bridge.postMessage({ type: "investigation-handoff", payload: { name: current.name } } as never); }}>
              <Send size={12} strokeWidth={1.5} /> Hand off
            </button>
            <div style={{ flex: 1 }} />
            <button data-investigation-delete title="Delete this investigation" style={iconBtn}
              onClick={() => request("investigation-delete", current.name)}>
              <Trash2 size={12} strokeWidth={1.5} /> Delete
            </button>
          </div>
          {handoff && handoff.name === current.name && (
            <div data-investigation-handoff-text style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ ...small, display: "flex", alignItems: "center", gap: 8 }}>
                <span>Written to <span style={{ fontFamily: mono }}>{handoff.path}</span> — also in the export and on MCP <span style={{ fontFamily: mono }}>vibegraph_investigation</span>.</span>
                <button style={{ ...iconBtn, padding: "2px 6px" }}
                  onClick={() => { navigator.clipboard?.writeText(handoff.text).then(() => setCopied(true), () => setCopied(false)); }}>
                  <Copy size={12} strokeWidth={1.5} /> {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre style={{ margin: 0, maxHeight: 240, overflow: "auto", background: "var(--bg-canvas)", border: "1px solid var(--border-edge)", borderRadius: 4, padding: 8, fontFamily: mono, fontSize: "var(--fs-11)", color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                {handoff.text}
              </pre>
            </div>
          )}
        </>
      )}
      {error && <div data-investigation-error style={{ ...small, color: "var(--accent-error)" }}>{error}</div>}
    </div>
  );
}
