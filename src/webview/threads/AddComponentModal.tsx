// M12.4 — post-drop modal per PLAN-v3.md §4.4.
//
// Opens once the user has dropped a kind on a target AND M12.3's
// resolver has produced a single InsertionPoint (either directly, or
// via the InsertionPointPicker for ambiguous cases). Monaco editor
// pre-filled with the §3.3 default template for the kind. Insert is
// always enabled (revised §4.4): the CST op is the gate. On commit
// failure, the modal stays open and surfaces the inline error with
// the M12.1 errorKind.

import React, { useState, useEffect, useMemo } from "react";
import Editor from "@monaco-editor/react";
import { X, Check, AlertCircle, FileText } from "lucide-react";
import type { AddKind } from "./useAddComponentDrag";
import type { InsertionPoint } from "./insertionPoint";
import { defineVibegraphDark, VIBEGRAPH_DARK } from "../themes/vibegraph-dark";
import { bridge, type ExtensionMessage } from "../types";

// §3.3 default body templates. Deterministic, parse-valid skeletons —
// the user edits in Monaco; defaults exist so a "slam Insert" produces
// a no-op-but-syntactically-valid file change.
const DEFAULT_TEMPLATES: Record<AddKind, string> = {
  call:         "func_name(arg)\n",
  function_def: "def name():\n    pass\n",
  class_def:    "class Name:\n    pass\n",
  assignment:   "name = value\n",
  if_stmt:      "if condition:\n    pass\n",
  for_loop:     "for item in iterable:\n    pass\n",
  while_loop:   "while condition:\n    pass\n",
  return_stmt:  "return None\n",
  raise_stmt:   'raise Exception("...")\n',
  describe:     "",  // M12.5: Claude path uses a different modal.
};

// Preposition for the header label. PLAN-v3 §4.4: "Add for_loop after
// `query()`" / "Add if_stmt inside `cmd_create`'s body".
function prepositionFor(point: InsertionPoint): string {
  switch (point) {
    case "before":     return "before";
    case "after":      return "after";
    case "inside_top": return "at the top of";
    case "inside_end": return "inside";
  }
}

// Extract M15 placement context from the source. Cheap regex-based —
// the resolver does the real classification work; we just feed it
// hints to short-circuit obvious matches.
function extractContext(source: string): {
  newName?: string; decorators?: string[]; baseClass?: string;
} {
  const out: { newName?: string; decorators?: string[]; baseClass?: string } = {};
  // Function name from `def <name>(`
  const defMatch = source.match(/\bdef\s+(\w+)\s*\(/);
  if (defMatch) out.newName = defMatch[1];
  // Class name + bases from `class <name>(<base>):`
  const classMatch = source.match(/\bclass\s+(\w+)\s*(?:\(\s*([^)]+?)\s*\))?\s*:/);
  if (classMatch) {
    out.newName = classMatch[1];
    if (classMatch[2]) out.baseClass = classMatch[2].split(",")[0].trim();
  }
  // Decorators — all `@…` lines.
  const decs: string[] = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("@")) decs.push(trimmed);
  }
  if (decs.length) out.decorators = decs;
  return out;
}

// Kind labels for the header (human-readable; matches AddComponentKindPicker).
const KIND_LABEL: Record<AddKind, string> = {
  call: "call",
  function_def: "function",
  class_def: "class",
  assignment: "assignment",
  if_stmt: "if-block",
  for_loop: "for-loop",
  while_loop: "while-loop",
  return_stmt: "return",
  raise_stmt: "raise",
  describe: "description",
};

interface Props {
  kind: AddKind;
  insertionPoint: InsertionPoint;
  targetLabel: string;       // user-readable target ("cmd_create", "print", "module")
  busy: boolean;             // true while WS round-trip in flight
  error: string | null;
  errorKind: string | null;
  anchorPoint: { x: number; y: number };
  // M15.2 — the file the user dropped on. For statement-kind inserts
  // this is also the commit file. For function_def / class_def the
  // modal runs the M15 placement resolver and offers the user a choice.
  dropTargetFile: string;
  onClose: () => void;
  // onSubmit now passes the chosen file path so App can route the
  // commit to the right place (M15 may have re-pointed it).
  onSubmit: (source: string, filePath: string) => void;
}

// Kinds that trigger M15 placement resolution. Statement-level kinds
// always land where the user dropped — they're inserting INTO an
// existing function's body. function_def / class_def are file-scope
// constructs whose location is a real decision.
const KINDS_NEEDING_PLACEMENT: ReadonlySet<AddKind> = new Set([
  "function_def", "class_def",
]);

export function AddComponentModal({
  kind, insertionPoint, targetLabel,
  busy, error, errorKind,
  anchorPoint, dropTargetFile, onClose, onSubmit,
}: Props) {
  const template = DEFAULT_TEMPLATES[kind] ?? "";
  const [source, setSource] = useState(template);

  // M15.2 placement state. `targetFile` is the file the commit will
  // write to — defaults to dropTargetFile and gets overridden by the
  // M15 resolver for function/class kinds.
  const [targetFile, setTargetFile] = useState<string>(dropTargetFile);
  const [placement, setPlacement] = useState<{
    rules: Array<{ rule: string; file: string | null; confidence: number; reason: string }>;
    best: { rule: string; file: string } | null;
    ambiguous: boolean;
    candidates: string[];
  } | null>(null);

  // Reset the editor when the kind changes (shouldn't happen mid-modal,
  // but covers the case where a new drop opens the modal with a
  // different kind without unmounting).
  useEffect(() => { setSource(template); }, [kind, template]);

  // M15.2 — run placement when the modal opens for a kind that needs
  // it. Re-runs when the source changes (debounced) so editing the
  // template updates the proposal in real-ish time.
  useEffect(() => {
    if (!KINDS_NEEDING_PLACEMENT.has(kind)) {
      setTargetFile(dropTargetFile);
      setPlacement(null);
      return;
    }
    const requestId = `place-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let cancelled = false;
    const t = window.setTimeout(() => {
      bridge.postMessage({
        type: "place-new-code",
        payload: {
          requestId,
          source,
          context: extractContext(source),
          dropTargetFile,
        },
      });
    }, 200); // debounce
    const handler = (msg: ExtensionMessage) => {
      if (msg.type !== "place-new-code-result") return;
      if (msg.payload.requestId !== requestId) return;
      if (cancelled) return;
      setPlacement({
        rules: msg.payload.rules,
        best: msg.payload.best,
        ambiguous: msg.payload.ambiguous,
        candidates: msg.payload.candidates,
      });
      // Adopt the best file as the commit target. User can override
      // via the dropdown.
      if (msg.payload.best) setTargetFile(msg.payload.best.file);
      else if (msg.payload.candidates.length > 0) setTargetFile(msg.payload.candidates[0]);
    };
    bridge.onMessage(handler);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      bridge.removeListener(handler);
    };
  }, [kind, source, dropTargetFile]);

  // Escape / Enter shortcuts. Enter commits when Monaco isn't focused
  // on a multiline edit — we let Monaco own Enter inside its container
  // and only catch Ctrl/Cmd+Enter at the modal level for explicit
  // submit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !busy) {
        e.preventDefault();
        onSubmit(source, targetFile);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, source, targetFile, onClose, onSubmit]);

  // Smart placement: avoid covering the drop target. Clamp to viewport.
  const MODAL_W = 480;
  const MODAL_H = 400;
  const left = useMemo(() => Math.max(
    16, Math.min(window.innerWidth - MODAL_W - 16, anchorPoint.x + 16),
  ), [anchorPoint.x]);
  const top = useMemo(() => Math.max(
    16, Math.min(window.innerHeight - MODAL_H - 16, anchorPoint.y + 16),
  ), [anchorPoint.y]);

  return (
    <>
      {/* Backdrop. Click swallows → close (unless busy). */}
      <div
        onClick={() => !busy && onClose()}
        style={{
          position: "fixed", inset: 0, zIndex: 1149,
          background: "color-mix(in oklab, var(--bg-canvas) 35%, transparent)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
        }}
      />
      <div
        role="dialog"
        aria-label={`Add ${KIND_LABEL[kind]} ${prepositionFor(insertionPoint)} ${targetLabel}`}
        style={{
          position: "fixed",
          left, top,
          width: MODAL_W, height: MODAL_H,
          zIndex: 1150,
          background: "var(--bg-node)",
          border: "1px solid var(--border-edge)",
          borderRadius: 10,
          boxShadow: "var(--shadow-panel)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "var(--font-mono)",
          color: "var(--text-primary)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border-edge)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Add <span style={{ color: "var(--accent-thread)" }}>{KIND_LABEL[kind]}</span>{" "}
            <span style={{ color: "var(--text-muted)" }}>{prepositionFor(insertionPoint)}</span>{" "}
            <code style={{
              background: "color-mix(in oklab, var(--accent-thread) 10%, transparent)",
              padding: "1px 6px", borderRadius: 4, fontSize: 12,
            }}>{targetLabel}</code>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            title="Cancel"
            style={{
              background: "none", border: "none",
              color: "var(--text-muted)",
              cursor: busy ? "not-allowed" : "pointer",
              padding: 2, display: "flex", alignItems: "center",
            }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Monaco editor */}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <Editor
            height="100%"
            defaultLanguage="python"
            value={source}
            theme={VIBEGRAPH_DARK}
            beforeMount={(monaco) => defineVibegraphDark(monaco)}
            onChange={(v) => setSource(v ?? "")}
            options={{
              fontSize: 13,
              fontFamily: "var(--font-mono), 'JetBrains Mono', monospace",
              lineNumbers: "off",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 12, bottom: 12 },
              renderLineHighlight: "none",
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              scrollbar: { vertical: "hidden", horizontal: "hidden" },
              // M15.3 / M12 modal — turn off Monaco's keyword
              // autocompletion. The kind templates are short and
              // mostly typed-over; the completion menu eats spaces
              // (e.g. between `def` and the function name) and is
              // more friction than help at this size.
              quickSuggestions: false,
              suggestOnTriggerCharacters: false,
              acceptSuggestionOnEnter: "off",
              tabCompletion: "off",
              wordBasedSuggestions: "off",
            }}
          />
        </div>

        {/* Inline error row — visible only on failure */}
        {error && (
          <div style={{
            padding: "8px 16px",
            borderTop: "1px solid color-mix(in oklab, var(--accent-error) 40%, transparent)",
            background: "color-mix(in oklab, var(--accent-error) 8%, transparent)",
            display: "flex", alignItems: "flex-start", gap: 8,
            fontSize: 11, color: "var(--accent-error)",
            maxHeight: 90, overflowY: "auto",
          }}>
            <AlertCircle size={14} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              {errorKind && (
                <span style={{
                  display: "inline-block",
                  padding: "1px 6px",
                  marginRight: 6,
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  background: "color-mix(in oklab, var(--accent-error) 18%, transparent)",
                  borderRadius: 3,
                }}>{errorKind}</span>
              )}
              <span style={{ wordBreak: "break-word" }}>{error}</span>
            </div>
          </div>
        )}

        {/* M15.2 — "Will write to:" row. Only shows for kinds whose
            file placement is a real decision (function_def / class_def).
            For other kinds we silently use dropTargetFile. */}
        {KINDS_NEEDING_PLACEMENT.has(kind) && (
          <div
            data-modal-placement-row
            style={{
              padding: "8px 16px",
              borderTop: "1px solid var(--border-edge)",
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 11, fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
            }}
          >
            <FileText size={12} strokeWidth={1.5} />
            <span>Will write to:</span>
            {placement && placement.ambiguous && placement.candidates.length > 1 ? (
              <select
                data-modal-placement-select
                value={targetFile}
                onChange={(e) => setTargetFile(e.target.value)}
                style={{
                  background: "var(--bg-node)",
                  border: "1px solid var(--border-edge)",
                  borderRadius: 4,
                  color: "var(--text-primary)",
                  padding: "2px 6px",
                  fontSize: 11,
                  fontFamily: "inherit",
                }}
              >
                {placement.candidates.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <code
                data-modal-placement-file
                title={placement?.best?.rule ? `rule: ${placement.best.rule}` : undefined}
                style={{
                  color: "var(--accent-thread)",
                  background: "color-mix(in oklab, var(--accent-thread) 10%, transparent)",
                  padding: "1px 6px", borderRadius: 4,
                }}
              >
                {targetFile}
              </code>
            )}
            {placement?.best && (
              <span style={{ opacity: 0.7 }}>· {placement.best.rule}</span>
            )}
            {placement?.ambiguous && (
              <span style={{ opacity: 0.7 }}>· ambiguous</span>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: "10px 16px",
          borderTop: "1px solid var(--border-edge)",
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8,
        }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              background: "transparent",
              border: "1px solid var(--border-edge)",
              borderRadius: 5,
              color: "var(--text-muted)",
              padding: "5px 12px",
              fontSize: 11,
              fontFamily: "inherit",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(source, targetFile)}
            disabled={busy}
            style={{
              background: "color-mix(in oklab, var(--accent-thread) 22%, transparent)",
              border: "1px solid color-mix(in oklab, var(--accent-thread) 60%, transparent)",
              borderRadius: 5,
              color: "var(--accent-thread)",
              padding: "5px 14px",
              fontSize: 11,
              fontFamily: "inherit",
              fontWeight: 600,
              cursor: busy ? "wait" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <Check size={14} strokeWidth={1.8} />
            {busy ? "Inserting…" : "Insert"}
          </button>
        </div>
      </div>
    </>
  );
}
