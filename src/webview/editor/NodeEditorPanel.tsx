// M18.1 — <NodeEditorPanel> scaffold (PLAN-v3-revised §F).
//
// The right-side editor panel is the spine of the M18 pivot: "code is
// the medium". Clicking any node opens its *enclosing function* in an
// editable Monaco; saving routes the whole function body through
// op_replace_function_body (M18.2/M18.3).
//
// M28.3 — the panel is **Edit-only**. It once had a second "Intent" mode
// (plain-language → one-shot single-function rewrite), but that was a
// strict subset of the Claude chat now docked permanently beneath this
// column, so Intent is unmounted (parts.tsx IntentBar/ModeToggle + the
// server place-intent path stay on disk, parked — the M10→M25 precedent).
// Hand-editing + Save is the one capability the chat doesn't replace.
//
// Source is fetched self-contained via the existing get-file-source WS
// flow (the M9.4 ExternalEffectsPanel.EditContextBody is the precedent),
// then sliced to the target's [line, endLine] span by resolveEditTarget.
//
// Chrome (header / mode toggle / bodies / dirty prompt / footer) lives
// in parts.tsx; this file owns the state machine.

import React, { useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { CODE_WRAP_OPTIONS } from "../monaco_options";
import { defineVibegraphDark, VIBEGRAPH_DARK } from "../themes/vibegraph-dark";
import { bridge, type AstNode, type ProjectFileData, type ExtensionMessage } from "../types";
import {
  resolveEditTarget, sliceTargetSource, loadedKeyToName, type EditTarget,
} from "./resolveEditTarget";
// M28.3 — the panel is Edit-only now. The Intent mode (plain-language →
// one-shot single-function rewrite) was a strict subset of the Claude
// chat (now docked permanently under this column), so it's UNMOUNTED:
// ModeToggle + IntentBar are no longer imported, and handleGenerate /
// place-intent stay on disk parked (park-don't-delete, the M10→M25
// precedent). Hand-editing + Save is the one thing the chat doesn't
// replace, so it stays.
import {
  Header, EmptyState, CenterMsg, DirtyPrompt, Footer,
} from "./parts";

// Dock geometry mirrors CodeView.Dock — App tiles the two surfaces
// side-by-side when both are open. Defaults to the solo full-width dock.
export interface Dock {
  right: number | string;
  width: number | string;
  minWidth: number;
  // M28.3 — bottom inset reserving room for the chat docked beneath the
  // code column. 0 (default) → the panel runs full height.
  bottom?: number;
}
const SOLO_DOCK: Dock = { right: 0, width: "44%", minWidth: 480 };

export interface NodeEditorPanelProps {
  open: boolean;
  node: AstNode | null;
  filePath: string | null;
  projectData: Record<string, ProjectFileData>;
  astNodes: AstNode[];
  onClose: () => void;
  dock?: Dock;
}

// Editor sits just under CodeView (990) / MonacoOverlay (1000) and well
// under the TopToolbar (1010); when co-open with CodeView the two are
// tiled (App-computed docks) so z-order no longer governs occlusion.
const PANEL_Z = 988;

export function NodeEditorPanel(props: NodeEditorPanelProps) {
  const { open, node, filePath, projectData, astNodes, onClose, dock = SOLO_DOCK } = props;

  const target = useMemo(
    () => resolveEditTarget(node, filePath, projectData, astNodes),
    [node, filePath, projectData, astNodes],
  );

  // Source cache — which file the `source` string holds.
  const [source, setSource] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [srcError, setSrcError] = useState<string | null>(null);

  // Editor content + the originally-loaded slice (dirty = they differ).
  const [value, setValue] = useState<string>("");
  const [original, setOriginal] = useState<string>("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Dirty-guard machinery: a switch requested while dirty parks the new
  // target in `pendingTarget` (prompt shown); `dismissedKey` records a
  // "keep editing" so the same request doesn't immediately re-prompt.
  const [pendingTarget, setPendingTarget] = useState<EditTarget | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const [note, setNote] = useState<string | null>(null);
  // M18.3 — Save round-trip state. `saving` gates the buttons; `saveError`
  // drives the inline error row (errorKind-aware) on rejection.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; errorKind: string | null } | null>(null);

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const dirty = loadedKey !== null && value !== original;

  // ── fetch source for the target's file ────────────────────────────
  useEffect(() => {
    if (!open || !target) return;
    const file = target.filePath;
    if (file === sourceFile) return; // already have it
    setSource(null);
    setSrcError(null);
    bridge.postMessage({ type: "get-file-source", payload: { filePath: file } });
    const handler = (msg: ExtensionMessage) => {
      if (msg.type === "file-source" && msg.payload.filePath === file) {
        setSource(msg.payload.source);
        setSourceFile(file);
      } else if (msg.type === "file-source-error" && msg.payload.filePath === file) {
        setSrcError(msg.payload.message ?? "Failed to load file.");
        setSourceFile(file);
      }
    };
    bridge.onMessage(handler);
    return () => bridge.removeListener(handler);
  }, [open, target?.filePath, sourceFile]);

  // ── load the resolved target's source into the editor ─────────────
  useEffect(() => {
    if (!open || !target || source == null || sourceFile !== target.filePath) return;
    if (target.key === loadedKey) return;       // already showing it
    if (target.key === dismissedKey) return;    // user chose "keep editing"
    if (dirty) { setPendingTarget(target); return; }
    const sliced = sliceTargetSource(source, target);
    setValue(sliced);
    setOriginal(sliced);
    setLoadedKey(target.key);
    setPendingTarget(null);
    setDismissedKey(null);
  }, [open, target, source, sourceFile, loadedKey, dismissedKey, dirty]);

  // M28.3 — re-sync the loaded slice after an EXTERNAL edit (chat / MCP).
  // A chat edit rebroadcasts a fresh envelope (useWebSocketHandler replaces
  // projectData), but the edit target's key is stable (same function id),
  // so the load effect above won't re-slice — the editor would keep showing
  // the PRE-edit body right next to the chat that just changed it (caught in
  // the M28.3 smoke). Mirror CodeView's R-1a live-refresh: re-fetch the file
  // and re-slice. Guarded on !dirty && !saving so an in-progress hand edit
  // is never clobbered; `target` is recomputed from the fresh projectData so
  // its line span already reflects the new parse. Fires on a fresh envelope
  // only (projectData identity changes per project-update).
  useEffect(() => {
    if (!open || !target || dirty || saving || loadedKey === null) return;
    const file = target.filePath;
    const handler = (msg: ExtensionMessage) => {
      if (msg.type !== "file-source" || msg.payload.filePath !== file) return;
      bridge.removeListener(handler);
      const sliced = sliceTargetSource(msg.payload.source, target);
      setSource(msg.payload.source);
      setSourceFile(file);
      setValue(sliced);
      setOriginal(sliced);
    };
    bridge.onMessage(handler);
    bridge.postMessage({ type: "get-file-source", payload: { filePath: file } });
    return () => bridge.removeListener(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectData]);

  // Esc closes the panel (mirrors CodeView / MonacoOverlay).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Bug fix — keep editor keystrokes inside the panel. react-flow attaches
  // a window-level keydown listener for Space-pan (panActivationKeyCode);
  // when this panel floats over a thread/diagram canvas, a Space typed in
  // Monaco bubbles to window and react-flow preventDefault'd it, so the
  // spacebar did nothing. A native bubble-phase stop at the panel root —
  // an ancestor of Monaco's textarea, below window — prevents ANY
  // window-level handler from seeing editor keys. Escape is let through so
  // the close handler above still fires.
  useEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (!el) return;
    const stop = (e: KeyboardEvent) => { if (e.key !== "Escape") e.stopPropagation(); };
    el.addEventListener("keydown", stop);
    return () => el.removeEventListener("keydown", stop);
  }, [open]);

  if (!open) return null;

  const fileLabel = filePath ? filePath.split("/").pop() ?? filePath : null;

  // ── dirty-guard actions ───────────────────────────────────────────
  const discardAndSwitch = () => {
    // Revert content so we're no longer dirty, drop the loaded key, and
    // clear the dismissal — the load effect then loads the pending
    // (== current) target on the next tick.
    setValue(original);
    setLoadedKey(null);
    setPendingTarget(null);
    setDismissedKey(null);
  };
  const keepEditing = () => {
    if (pendingTarget) setDismissedKey(pendingTarget.key);
    setPendingTarget(null);
  };

  // ── Save / Cancel ─────────────────────────────────────────────────
  // M18.3 — Mode A commit. The whole buffer goes through
  // op_replace_function_body (or op_replace_module_body) on the server;
  // on success the file is re-parsed and the graph rebroadcasts, so we
  // just clear the dirty state. On failure the inline error row shows the
  // op's (errorKind-tagged) reason.
  const handleSave = () => {
    if (!target || saving) return;
    // Edit-only: always commit the resolved edit target (the enclosing
    // function, or the module body for top-level edits).
    const commitIsModule = target.isModule;
    const commitNodeId = target.isModule ? null : target.node.id;
    setSaving(true);
    setSaveError(null);
    const onReply = (msg: ExtensionMessage) => {
      if (msg.type !== "replace-body-saved") return;
      bridge.removeListener(onReply);
      setSaving(false);
      if (msg.payload.success) {
        setOriginal(value); // dirty cleared; graph updates via project-update
        setNote("Saved — graph updated.");
        window.setTimeout(() => setNote(null), 2000);
      } else {
        setSaveError({
          message: msg.payload.error ?? "Save failed.",
          errorKind: msg.payload.errorKind ?? null,
        });
      }
    };
    bridge.onMessage(onReply);
    bridge.postMessage({
      type: "replace-body-save",
      payload: {
        nodeId: commitNodeId,
        newSource: value,
        filePath: target.filePath,
        isModule: commitIsModule,
        allowSignatureChange: target.signatureEditable,
      },
    });
  };
  const handleCancel = () => { setValue(original); setSaveError(null); };

  // M28.3 — Intent mode (place-intent → proposal → review) is PARKED: the
  // Claude chat docked under this column supersedes it. The server
  // `place-intent` handler and `intent-proposal` message stay on disk; the
  // handleGenerate driver was here and was removed from the live panel.

  return (
    <div
      ref={panelRef}
      data-node-editor-panel
      data-mode="edit"
      data-dirty={dirty ? "true" : "false"}
      style={{
        position: "fixed",
        top: 0,
        bottom: dock.bottom ?? 0,
        right: dock.right,
        width: dock.width,
        minWidth: dock.minWidth,
        boxSizing: "border-box",
        // The TopToolbar (z 1010) floats top-right and sits above this
        // panel; reserve its band so the breadcrumb + mode toggle clear
        // it instead of rendering behind it.
        paddingTop: 48,
        background: "var(--bg-canvas)",
        borderLeft: "2px solid color-mix(in oklab, var(--accent-thread) 27%, transparent)",
        display: "flex",
        flexDirection: "column",
        zIndex: PANEL_Z,
        boxShadow: "-8px 0 40px hsl(0 0% 0% / 0.6)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <Header fileLabel={fileLabel} fnName={target?.fnName ?? null} onClose={onClose} />

      {/* Edit-only Monaco of the enclosing function. Plain-language edits
          now live in the Claude chat docked beneath this column. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
        {!target ? (
          <EmptyState />
        ) : srcError ? (
          <CenterMsg color="var(--accent-error)">{srcError}</CenterMsg>
        ) : source === null || loadedKey === null ? (
          <CenterMsg color="var(--text-muted)">Loading…</CenterMsg>
        ) : (
          <Editor
            height="100%"
            language="python"
            value={value}
            beforeMount={defineVibegraphDark}
            theme={VIBEGRAPH_DARK}
            onMount={(ed) => { editorRef.current = ed; }}
            onChange={(v) => setValue(v ?? "")}
            options={{
              readOnly: false,
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              ...CODE_WRAP_OPTIONS,
              renderLineHighlight: "all",
              padding: { top: 12, bottom: 12 },
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 8,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
            }}
          />
        )}

        {/* Dirty-guard prompt — overlays the editor body. */}
        {pendingTarget && (
          <DirtyPrompt
            fromName={loadedKeyToName(loadedKey)}
            toName={pendingTarget.fnName}
            onDiscard={discardAndSwitch}
            onKeep={keepEditing}
          />
        )}
      </div>

      <Footer
        dirty={dirty}
        saving={saving}
        note={note}
        saveError={saveError}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </div>
  );
}
