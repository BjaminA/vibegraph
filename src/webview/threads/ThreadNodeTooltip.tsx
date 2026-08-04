// Floating per-node tooltip for the thread view (U3.1 — updateUI-plan §5
// expanded). Shows the pertinent function source for a thread node and
// gives the user two ways to change it:
//
//   1. **Edit in place.** Monaco editor (mini) reuses the existing
//      edit-node-open / edit-node-save WS round-trip — same path the
//      pencil-edit + MonacoOverlay use. Every save routes through the
//      libcst CST-patch validator, so format-and-diff guarantees still
//      apply.
//
//   2. **Ask Claude.** A textarea below the editor; submitting fires the
//      existing chat-send flow with the function pre-seeded as
//      contextNode. The chat panel opens to render the stream — we don't
//      duplicate stream-rendering inside the tooltip.
//
// Terminal nodes (external / dynamic / return) have no editable source;
// the body collapses to a read-only "external library call" placeholder
// and the Ask-Claude footer is hidden (no node to act on).
//
// Smart positioning: tries to place the tooltip to the right of the
// anchor, falls back to left, then top, then a centred viewport
// fallback. Clamped 8px inside the viewport on every side.

import React, { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { CODE_WRAP_OPTIONS } from "../monaco_options";
import { X, Check, AlertCircle, ExternalLink, Pin, FileCode } from "lucide-react";
import { bridge, type ExtensionMessage, type ThreadRunResult, type ThreadSynthProposal, type ThreadDataProposal } from "../types";
import { defineVibegraphDark, VIBEGRAPH_DARK } from "../themes/vibegraph-dark";

export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ThreadNodeTooltipProps {
  nodeId: string;           // react-flow node id (e.g. "cli:main")
  irNodeId: string | null;  // IR-side id used by edit-node-open
  file: string | null;      // relative path; null for terminals
  kind: string;
  label: string;
  // W6 — the call's source expression (truncated preview), so the body
  // can show the real call (`torch.stack([self.head(x) for …])`) rather
  // than just the dotted target `label`.
  preview?: string | null;
  // M17.1 — via-local terminals (e.g. `parser.add_subparsers()` where
  // `parser = argparse.ArgumentParser(...)`) carry a resolved dotted
  // path the external-call resolver can actually import. When present,
  // the tooltip uses it as `qualifiedName` in the resolve-external-call
  // payload instead of the raw `label`. `viaLocal` is the receiver
  // variable name, shown in the header.
  qualifiedTarget?: string;
  viaLocal?: string;
  // R4 — dynamic terminals on a runtime-bound local receiver (e.g.
  // `conn.execute` where `conn = _get_conn()`) carry the binding callee
  // so the body can state the honest reason the target is runtime-only,
  // instead of the resolver's doomed module-import attempt.
  receiverBoundFrom?: string;
  // §5.5a — how that receiver was bound (local-call|param|loop), so the
  // body can name the binding form even when there's no binding callee.
  receiverBoundKind?: "local-call" | "param" | "loop";
  // M-RUN3 — structural runnability (ThreadView computes via planRunToNode):
  // the run-to-here button only renders when the node can actually produce a
  // value. Absent (older callers/tests) → keep the legacy always-offer.
  runnable?: boolean;
  anchor: AnchorRect;
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
  // U3.1 lets the same tooltip survive a hover-leave when the user
  // mouses INTO the tooltip itself. Mouse handlers bubble to ThreadView
  // which clears its leave timer.
  onTooltipEnter: () => void;
  onTooltipLeave: () => void;
}

interface Placement {
  left: number;
  top: number;
  arrow: "left" | "right" | "top" | "centre";
}

// Tooltip box dimensions — generous enough to read a small function
// without scrolling, small enough to leave canvas visible behind it.
// Height is a fixed pixel value (not maxHeight) because Monaco's
// `height="100%"` needs a parent with a definite height to compute
// against — `maxHeight` on a flex column leaves the editor child at
// its minimum (~5px) and we get an invisible editor.
const TOOLTIP_W = 480;
const TOOLTIP_H = 400;
const MARGIN = 12;        // gap between anchor and tooltip
const VIEWPORT_PAD = 8;   // min distance from viewport edges

function placeTooltip(anchor: AnchorRect): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Preferred: right of the anchor.
  const rightLeft = anchor.left + anchor.width + MARGIN;
  if (rightLeft + TOOLTIP_W + VIEWPORT_PAD <= vw) {
    return {
      left: rightLeft,
      top: clamp(anchor.top, VIEWPORT_PAD, vh - TOOLTIP_H - VIEWPORT_PAD),
      arrow: "left",
    };
  }
  // Fallback 1: left of the anchor.
  const leftLeft = anchor.left - MARGIN - TOOLTIP_W;
  if (leftLeft >= VIEWPORT_PAD) {
    return {
      left: leftLeft,
      top: clamp(anchor.top, VIEWPORT_PAD, vh - TOOLTIP_H - VIEWPORT_PAD),
      arrow: "right",
    };
  }
  // Fallback 2: above the anchor.
  const topTop = anchor.top - MARGIN - TOOLTIP_H;
  if (topTop >= VIEWPORT_PAD) {
    return {
      left: clamp(anchor.left + anchor.width / 2 - TOOLTIP_W / 2,
        VIEWPORT_PAD, vw - TOOLTIP_W - VIEWPORT_PAD),
      top: topTop,
      arrow: "top",
    };
  }
  // Fallback 3: centred — last resort when the canvas is cramped.
  return {
    left: vw / 2 - TOOLTIP_W / 2,
    top: vh / 2 - TOOLTIP_H / 2,
    arrow: "centre",
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function ThreadNodeTooltip(props: ThreadNodeTooltipProps) {
  const {
    nodeId, irNodeId, file, kind, label, preview, qualifiedTarget, viaLocal,
    receiverBoundFrom, receiverBoundKind, runnable,
    anchor, pinned, onPin, onClose, onTooltipEnter, onTooltipLeave,
  } = props;

  const [source, setSource] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg?: string } | null>(null);
  // M13.2 — when kind=external, the tooltip resolves the qualified name
  // (the label IS the callTarget for external thread nodes, per
  // scripts/extract_thread.py) via the new WS round-trip.
  const [externalResolved, setExternalResolved] = useState<{
    kind: "stdlib" | "third_party" | "unresolved";
    signature: string | null;
    signatureSource: "inspect" | "stub" | null;
    docstring: string | null;
    module: string | null;
    sourceFile: string | null;
    error: string | null;
  } | null>(null);

  const isTerminal = kind === "external" || kind === "dynamic" || kind === "return";
  const canEdit = !isTerminal && !!irNodeId && !!file;
  // M-RUN SM1 — "run to here": run the real path to this node, capture its
  // value. M-RUN3 — affordance honesty: when ThreadView supplied structural
  // runnability, a node with no capturable value shows NO button (instead of
  // declining after the click).
  // Sitting-2 — a RETURN node is a terminal for EDITING but not for running:
  // capture_probe exists precisely to grab a return's value, and a pure-
  // expression return (no call step to run from — the live Standardizer.apply)
  // is only runnable HERE. planRunToNode already vets it structurally.
  const canRun = (!isTerminal || kind === "return") && !!irNodeId && !!file && runnable !== false;
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<ThreadRunResult | null>(null);
  // SM2.d — synthesized-args proposal awaiting the user's confirm. When set
  // (ok), the panel shows the made-up inputs and a confirm button; nothing
  // has executed. Cleared when a run starts or a result arrives.
  const [synthProposal, setSynthProposal] = useState<ThreadSynthProposal | null>(null);
  // Editable copy of the synthesized args — a degenerate synth value (0, "",
  // []) is the failure mode worth fixing by hand. The edited literals are
  // re-validated server-side through check_literals at the injection boundary
  // (runThreadToNodeCore._validateLiterals), so the chokepoint stays single-
  // source; an invalid edit comes back as an honest harness-error run result.
  const [synthEdits, setSynthEdits] = useState<Record<string, string>>({});
  // M-RUN2.1 — editable copy of the example-instance constructor args
  // (method runs). Same chokepoint story as synthEdits: edits re-validate
  // server-side through check_literals --mode instance before injection.
  const [instanceEdits, setInstanceEdits] = useState<Record<string, string> | null>(null);
  // SM3 — once the user confirms the SIDE-EFFECT consent, hold its token so it
  // rides through any subsequent synth round-trip and the final run. Distinct
  // from the synth consent (which is the act of clicking Run with the inputs).
  const [effectConsent, setEffectConsent] = useState<string | null>(null);
  // M-RUN2.3 — the drafted example data file awaiting consent, and (after
  // "use & run") the consented file that rides every subsequent dispatch
  // for this node, so re-consenting to effects doesn't lose the file.
  const [dataProposal, setDataProposal] = useState<ThreadDataProposal | null>(null);
  const [dataFile, setDataFile] = useState<{ path: string; content: string; consent: string } | null>(null);
  const [dataDrafting, setDataDrafting] = useState(false);
  useEffect(() => {
    const onResult = (e: Event) => {
      const r = (e as CustomEvent).detail as ThreadRunResult;
      if (r?.nodeId !== nodeId) return;
      setRunResult(r);
      setSynthProposal(null);
      setRunning(false);
    };
    const onProposal = (e: Event) => {
      const p = (e as CustomEvent).detail as ThreadSynthProposal;
      if (p?.nodeId !== nodeId) return;
      setSynthProposal(p);
      setSynthEdits(p.ok ? { ...(p.accepted ?? {}) } : {});
      setInstanceEdits(p.ok && p.instance ? { ...p.instance.args } : null);
      setRunning(false);
    };
    const onDataProposal = (e: Event) => {
      const p = (e as CustomEvent).detail as ThreadDataProposal;
      if (p?.nodeId !== nodeId) return;
      setDataProposal(p);
      setDataDrafting(false);
    };
    document.addEventListener("vg-thread-run-result", onResult);
    document.addEventListener("vg-thread-synth-proposal", onProposal);
    document.addEventListener("vg-thread-data-proposal", onDataProposal);
    return () => {
      document.removeEventListener("vg-thread-run-result", onResult);
      document.removeEventListener("vg-thread-synth-proposal", onProposal);
      document.removeEventListener("vg-thread-data-proposal", onDataProposal);
    };
  }, [nodeId]);
  // M-RUN2.3 — a consented example file rides every dispatch for this node.
  const dataDetail = () => (dataFile ? { synthData: dataFile } : {});
  const startRun = () => {
    setRunResult(null);
    setSynthProposal(null);
    setEffectConsent(null);
    setRunning(true);
    document.dispatchEvent(new CustomEvent("vg-run-thread-to-node", { detail: { nodeId, irNodeId, file, ...dataDetail() } }));
  };
  // SM2.d — user confirmed the synthesized inputs: run for real (phase 2).
  // Carries any prior side-effect consent so a both-gates run sends both.
  const confirmSynthRun = (args: Record<string, string>) => {
    const instArgs = instanceEdits;
    setSynthProposal(null);
    setRunResult(null);
    setRunning(true);
    document.dispatchEvent(new CustomEvent("vg-run-thread-to-node", { detail: {
      nodeId, irNodeId, file, synthArgs: args,
      // M-RUN2.1 — the confirmed (possibly hand-edited) instance args ride
      // along; the server re-derives the class from the IR, never from us.
      ...(instArgs ? { synthInstanceArgs: instArgs } : {}),
      ...(effectConsent ? { effectConsent } : {}),
      ...dataDetail(),
    } }));
  };
  // SM3 — user confirmed the SIDE-EFFECT consent. Store the token and re-fire:
  // ThreadView re-routes (a no-arg node runs now; an arg-needing node goes back
  // for synth, which will then surface the separate synth consent).
  const confirmEffectConsent = (token: string) => {
    setEffectConsent(token);
    setRunResult(null);
    setSynthProposal(null);
    setRunning(true);
    document.dispatchEvent(new CustomEvent("vg-run-thread-to-node", { detail: { nodeId, irNodeId, file, effectConsent: token, ...dataDetail() } }));
  };
  // M-RUN2.3 — ask Claude to draft the missing example file (nothing runs).
  const requestDataDraft = (missingPath: string) => {
    setDataDrafting(true);
    document.dispatchEvent(new CustomEvent("vg-synth-thread-data", { detail: { nodeId, irNodeId, file, path: missingPath } }));
  };
  // M-RUN2.3 — the user approved the drafted file: hold it (content +
  // hash-bound token) and run. When the offer sits inside the effect gate,
  // the click covers both scopes — the button says so explicitly.
  const confirmDataUse = (p: ThreadDataProposal) => {
    if (!p.path || !p.content || !p.dataConsentToken) return;
    const df = { path: p.path, content: p.content, consent: p.dataConsentToken };
    setDataFile(df);
    setDataProposal(null);
    setRunResult(null);
    setRunning(true);
    const token = effectConsent ?? sideEffectGate?.token ?? null;
    if (token) setEffectConsent(token);
    document.dispatchEvent(new CustomEvent("vg-run-thread-to-node", { detail: {
      nodeId, irNodeId, file, synthData: df, ...(token ? { effectConsent: token } : {}),
    } }));
  };
  // SM3 — the side-effect consent gate, from either entry path: a no-arg run
  // that hit the floor (runResult requires-confirmation), or an arg-needing
  // run blocked before synth (synthProposal blockedByEffect). One dialog,
  // listing the detected effects + the scope-bound token to confirm.
  const sideEffectGate =
    (synthProposal?.blockedByEffect && synthProposal.effects?.length && synthProposal.effectConsentToken)
      ? { effects: synthProposal.effects, token: synthProposal.effectConsentToken, trustToken: synthProposal.trustUnverifiedToken ?? null }
      : (runResult?.outcome === "requires-confirmation" && runResult.effects?.length && runResult.effectConsentToken)
        ? { effects: runResult.effects, token: runResult.effectConsentToken, trustToken: runResult.trustUnverifiedToken ?? null }
        : null;
  // Sitting-2 — grant the session-wide "stop asking about unverifiable calls"
  // and re-fire: proven effects (if any) come back as a smaller gate; a fully
  // unverifiable path just runs.
  const confirmTrustUnverified = (trustToken: string) => {
    setRunResult(null);
    setSynthProposal(null);
    setRunning(true);
    document.dispatchEvent(new CustomEvent("vg-run-thread-to-node", { detail: { nodeId, irNodeId, file, trustUnverified: trustToken, ...dataDetail() } }));
  };

  // Fetch the function source via the existing edit-node-open round-trip.
  useEffect(() => {
    if (!canEdit) return;
    setSource(null);
    setError(null);
    setSaveResult(null);
    bridge.postMessage({
      type: "edit-node-open",
      payload: { nodeId: irNodeId!, filePath: file ?? undefined },
    });
    const handler = (msg: ExtensionMessage) => {
      if (msg.type === "edit-node-source" && msg.payload.nodeId === irNodeId) {
        if (msg.payload.error) {
          setError(msg.payload.error);
        } else {
          setSource(msg.payload.source);
          setValue(msg.payload.source);
        }
      } else if (msg.type === "edit-node-saved" && msg.payload.nodeId === irNodeId) {
        setSaving(false);
        if (msg.payload.success) {
          setSaveResult({ ok: true });
          // Don't auto-close on save — the user may want to keep iterating
          // or fire an Ask-Claude follow-up.
          setTimeout(() => setSaveResult(null), 2000);
        } else {
          setSaveResult({ ok: false, msg: msg.payload.error ?? "Save failed" });
        }
      }
    };
    bridge.onMessage(handler);
    return () => bridge.removeListener(handler);
  }, [canEdit, irNodeId, file]);

  // M13.2 — when this tooltip is showing an external library call,
  // request signature + docstring resolution from the server.
  //
  // For most external terminals the qualifiedName lives in `label`
  // (scripts/extract_thread.py carries the callTarget verbatim).
  //
  // M17.1 — for via-local terminals (e.g. `parser.add_subparsers()`
  // where `parser` is a local), the raw label (`parser.add_subparsers`)
  // is not importable. The thread node carries an extra
  // `qualifiedTarget` field — the resolved dotted path
  // (`argparse.ArgumentParser.add_subparsers`) — which we send instead.
  //
  // Replies are tagged with nodeId so concurrent hover swaps don't
  // race — we only set state for our nodeId.
  useEffect(() => {
    if (kind !== "external") {
      setExternalResolved(null);
      return;
    }
    setExternalResolved(null);
    const qualifiedName = qualifiedTarget || label;
    bridge.postMessage({
      type: "resolve-external-call",
      payload: { nodeId, qualifiedName },
    });
    const handler = (msg: ExtensionMessage) => {
      if (msg.type === "external-call-resolved" && msg.payload.nodeId === nodeId) {
        setExternalResolved({
          kind: msg.payload.kind,
          signature: msg.payload.signature,
          signatureSource: msg.payload.signatureSource,
          docstring: msg.payload.docstring,
          module: msg.payload.module,
          sourceFile: msg.payload.sourceFile,
          error: msg.payload.error,
        });
      }
    };
    bridge.onMessage(handler);
    return () => bridge.removeListener(handler);
  }, [kind, label, qualifiedTarget, nodeId]);

  // Esc always dismisses. Pinned tooltips also dismiss on Esc — single
  // recovery hatch, no surprise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const placement = useMemo(() => placeTooltip(anchor), [anchor]);

  const handleSave = () => {
    if (!canEdit) return;
    setSaving(true);
    setSaveResult(null);
    bridge.postMessage({
      type: "edit-node-save",
      payload: { nodeId: irNodeId!, newSource: value, filePath: file ?? undefined },
    });
  };

  // M10-chat-removal: the U3.1 "Ask Claude" prompt input dispatched
  // vg-chat-about-node into the now-unmounted ChatPanel. Plain-language
  // edits live in NodeEditorPanel's Intent mode; the footer keeps Save.

  return (
    <div
      data-thread-tooltip
      data-tooltip-kind={kind}
      onMouseEnter={onTooltipEnter}
      onMouseLeave={onTooltipLeave}
      style={{
        position: "fixed",
        left: placement.left,
        top: placement.top,
        width: TOOLTIP_W,
        height: TOOLTIP_H,
        background: "var(--bg-node)",
        border: "1px solid color-mix(in oklab, var(--accent-thread) 35%, var(--border-edge))",
        borderRadius: 8,
        boxShadow: "var(--shadow-panel)",
        zIndex: 1100, // above MonacoOverlay (1000) but below TopToolbar's modal layer
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
        animation: "vg-view-enter-kf var(--motion-view-dur) var(--motion-view-ease) both",
      }}
    >
      {/* ── header ── */}
      <div
        style={{
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid var(--border-edge)",
          flexShrink: 0,
        }}
      >
        <span style={{
          color: "var(--accent-thread)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          opacity: 0.85,
        }}>{kind}</span>
        <span style={{
          color: "var(--text-primary)",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          fontWeight: 600,
          maxWidth: 220,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }} title={label}>{label}</span>
        {file && (
          <span style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            opacity: 0.75,
            maxWidth: 130,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }} title={file}>{file}</span>
        )}
        <div style={{ flex: 1 }} />
        {file && (
          <button
            data-open-source-file
            onClick={() => {
              document.dispatchEvent(new CustomEvent("vg-open-source-file", { detail: { filePath: file } }));
              onClose();
            }}
            title={`Open source file (${file})`}
            aria-label="Open source file"
            style={{
              background: "transparent",
              border: "1px solid var(--border-edge)",
              borderRadius: 4,
              color: "var(--text-secondary)",
              padding: "3px 6px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              transition: "all 0.12s",
            }}
          >
            <FileCode size={13} strokeWidth={1.75} />
          </button>
        )}
        <button
          onClick={onPin}
          title={pinned ? "Pinned (click to unpin)" : "Pin tooltip"}
          aria-label={pinned ? "Unpin" : "Pin"}
          style={{
            background: pinned
              ? "color-mix(in oklab, var(--accent-thread) 18%, transparent)"
              : "transparent",
            border: `1px solid ${pinned
              ? "color-mix(in oklab, var(--accent-thread) 55%, transparent)"
              : "var(--border-edge)"}`,
            borderRadius: 4,
            color: pinned ? "var(--accent-thread)" : "var(--text-secondary)",
            padding: "3px 6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            transition: "all 0.12s",
          }}
        >
          <Pin size={13} strokeWidth={1.75} />
        </button>
        <button
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close tooltip"
          style={{
            background: "transparent",
            border: "1px solid var(--border-edge)",
            borderRadius: 4,
            color: "var(--text-secondary)",
            padding: "3px 6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      </div>

      {/* ── editor / placeholder ── */}
      {/* Sitting-2 — while a consent/synth gate is open, the gate is the
          decision surface: the editor yields its height floor so the gate's
          action rows fit inside the fixed 400px box (they used to clip off
          the bottom on long offense lists). Restores to 200 when the gate
          resolves. */}
      <div style={{ flex: "1 1 0", minHeight: sideEffectGate || (synthProposal && synthProposal.ok) ? 88 : 200, position: "relative", overflow: "hidden" }}>
        {!canEdit ? (
          kind === "external" ? (
            // M-FS2 — the friendly copy must describe what resolution
            // actually tried (qualifiedTarget when present), not the raw
            // receiver label: the old mix produced "`reconciler` isn't a
            // module" for a call resolved as reconcile.Reconciler.shortages.
            <ExternalCallBody resolved={externalResolved} qualifiedName={qualifiedTarget || label} callSource={preview} />
          ) : (
            <div style={{
              padding: "16px 18px",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <ExternalLink size={14} strokeWidth={1.5} />
              {kind === "dynamic"
                // R4 + §5.5a — when the receiver is a runtime-bound local,
                // name HOW it was bound ("a local binding from _get_conn()"
                // / "a function parameter" / "a loop variable") instead of
                // the generic line.
                ? receiverBoundFrom
                  ? `Dynamic dispatch — receiver '${label.split(".")[0]}' is a local binding from ${receiverBoundFrom}(); method target resolved at runtime.`
                  : receiverBoundKind === "param"
                    ? `Dynamic dispatch — receiver '${label.split(".")[0]}' is a function parameter; method target resolved at runtime.`
                    : receiverBoundKind === "loop"
                      ? `Dynamic dispatch — receiver '${label.split(".")[0]}' is a loop variable; method target resolved at runtime.`
                      : "Dynamic dispatch — call target resolved at runtime."
                : kind === "return"
                  ? "Return statement — no further source to inspect."
                  // M26.2 — honest copy for a resolution gap: the most
                  // common cause live is a function created seconds ago
                  // (chat/MCP edit) whose thread hasn't re-derived yet;
                  // the M26.2 in-place upgrade swaps this tooltip to the
                  // editor when the fresh thread lands.
                  : kind === "unresolved"
                    ? "Couldn't resolve this call yet — if it was just created, the graph is still re-linking."
                    : "No source available for this node."}
            </div>
          )
        ) : error ? (
          <div style={{
            padding: "16px 18px",
            color: "var(--accent-error)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <AlertCircle size={14} strokeWidth={1.5} />
            {error}
          </div>
        ) : source === null ? (
          <div style={{
            padding: "16px 18px",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}>Loading…</div>
        ) : (
          <Editor
            height="100%"
            language="python"
            value={value}
            onChange={(v) => setValue(v ?? "")}
            beforeMount={defineVibegraphDark}
            theme={VIBEGRAPH_DARK}
            options={{
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              // Wrap long lines (shared policy — code never runs off-screen).
              ...CODE_WRAP_OPTIONS,
              padding: { top: 8, bottom: 8 },
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 6,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
            }}
          />
        )}
      </div>

      {/* ── save status ── */}
      {saveResult && (
        <div style={{
          padding: "4px 12px",
          background: saveResult.ok
            ? "color-mix(in oklab, var(--accent-thread) 10%, transparent)"
            : "color-mix(in oklab, var(--accent-error) 10%, transparent)",
          color: saveResult.ok ? "var(--accent-thread)" : "var(--accent-error)",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          borderTop: "1px solid var(--border-edge)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          {saveResult.ok ? <Check size={13} strokeWidth={1.5} /> : <AlertCircle size={13} strokeWidth={1.5} />}
          {saveResult.ok ? "Saved" : saveResult.msg}
        </div>
      )}

      {/* ── M-RUN SM1: run-to-here ── */}
      {canRun && (
        <div style={{
          padding: "8px 10px",
          borderTop: "1px solid var(--border-edge)",
          display: "flex", flexDirection: "column", gap: 6,
          // Long consent stacks must never push their action rows past the
          // fixed-height tooltip clip: shrink and scroll instead.
          minHeight: 0, overflowY: "auto",
        }}>
          <button
            onClick={startRun}
            disabled={running}
            data-run-to-here
            title="Run the real path to this node and capture its value"
            style={{
              alignSelf: "flex-start",
              background: running ? "var(--border-edge)" : "color-mix(in oklab, var(--accent-thread) 16%, transparent)",
              border: "1px solid color-mix(in oklab, var(--accent-thread) 50%, transparent)",
              borderRadius: 4, color: "var(--accent-thread)", padding: "4px 10px",
              cursor: running ? "wait" : "pointer", fontSize: 11,
              fontFamily: "var(--font-mono)", fontWeight: 600,
            }}
          >
            {running ? "Running…" : "▷ Run to here"}
          </button>

          {/* ── SM3: side-effect consent gate ──
              DANGER framing (real side effects WILL run), deliberately
              distinct from the synth honesty gate below. Lists every detected
              effect for INFORMED consent; confirming sends the scope-bound
              token the server re-validates against a fresh scan. */}
          {sideEffectGate && (
            <div data-effect-gate style={{
              background: "color-mix(in oklab, var(--accent-error) 8%, var(--bg-canvas))",
              border: "1px solid color-mix(in oklab, var(--accent-error) 45%, transparent)",
              borderRadius: 6, padding: "8px 10px", fontSize: 11, fontFamily: "var(--font-mono)", lineHeight: 1.5,
              // Sitting-2 — the gate is a shrinkable flex column: when the
              // tooltip is short, the EFFECT LIST absorbs the shrink (and
              // scrolls) so the confirm/Cancel row below stays visible
              // without scrolling, at any offense count.
              display: "flex", flexDirection: "column", minHeight: 0,
            }}>
              <div style={{ color: "var(--accent-error)", fontWeight: 600 }}>
                This path runs real side effects — confirm to run
              </div>
              <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 10 }}>
                Running executes these for real, up to this node:
              </div>
              <div data-effect-list style={{
                marginTop: 6, display: "flex", flexDirection: "column", gap: 2,
                // The list is the gate's only shrinkable child: capped when
                // space allows, shrunk-and-scrolled when it doesn't — so the
                // action rows never leave the tooltip.
                flex: "0 1 auto", minHeight: 60, maxHeight: 144, overflowY: "auto", paddingRight: 4,
              }}>
                {sideEffectGate.effects.map((ef, i) => (
                  <div key={i} style={{ color: "var(--text-primary)" }}>
                    <span style={{ color: "var(--accent-error)" }}>
                      {ef.kind === "effect" ? `${ef.effectKind} effect` : `${ef.kind} call`}
                    </span>
                    {" · "}{ef.target}
                    <span style={{ color: "var(--text-muted)" }}> ({ef.file}:{ef.line})</span>
                  </div>
                ))}
              </div>
              {/* M-RUN2.3 — a listed fs read targets a file that doesn't
                  exist yet: offer a drafted example (nothing runs on click;
                  the full content gets its own consent below). */}
              {runResult?.missingData?.map((m) => (
                <div key={m.path} data-missing-data={m.path} style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--accent-warning)" }}>
                    {m.path} doesn't exist yet
                  </span>
                  <button
                    data-synth-data-offer={m.path}
                    disabled={dataDrafting}
                    onClick={() => requestDataDraft(m.path)}
                    style={{
                      background: "color-mix(in oklab, var(--accent-chat) 14%, transparent)",
                      border: "1px solid color-mix(in oklab, var(--accent-chat) 40%, transparent)",
                      borderRadius: 4, color: "var(--accent-chat)", padding: "2px 8px",
                      cursor: dataDrafting ? "not-allowed" : "pointer", fontSize: 10,
                      fontFamily: "var(--font-mono)", fontWeight: 600, opacity: dataDrafting ? 0.5 : 1,
                    }}
                  >{dataDrafting ? "drafting…" : "Ask Claude to draft an example file"}</button>
                </div>
              ))}
              {/* M-TRAINED.3 — a missing ARTIFACT is never a drafting offer:
                  name the producer thread instead. */}
              {runResult?.missingArtifacts?.map((m) => (
                <div key={m.path} data-missing-artifact={m.path} style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--accent-warning)" }}>
                    {m.path} doesn't exist yet — {m.producers.length
                      ? `produced by ${m.producers.map((p) => p.qualifiedName).join(", ")}`
                      : "no producer found in this project"}
                  </span>
                  {m.producers.map((p) => (
                    <button
                      key={p.entryPointId}
                      data-artifact-run-producer={p.entryPointId}
                      onClick={() => document.dispatchEvent(new CustomEvent("vg-open-thread", { detail: { entryPointId: p.entryPointId } }))}
                      title="Open the producing thread — run it from its save-site node (usual consent gates)"
                      style={{
                        background: "color-mix(in oklab, var(--accent-thread) 14%, transparent)",
                        border: "1px solid color-mix(in oklab, var(--accent-thread) 40%, transparent)",
                        borderRadius: 4, color: "var(--accent-thread)", padding: "2px 8px",
                        cursor: "pointer", fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
                      }}
                    >Open producer thread</button>
                  ))}
                </div>
              ))}
              {/* Sitting-2 — session category-trust for unverifiable calls.
                  The floor cannot name the library behind `model.train` (that
                  unknowability IS the refusal), so the honest grant is
                  per-category, never "trust all torch". Proven fs/db/network
                  effects are excluded and keep per-run consent. */}
              {sideEffectGate.trustToken && (
                <div data-trust-unverified-row style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
                  <button
                    data-trust-unverified
                    onClick={() => confirmTrustUnverified(sideEffectGate.trustToken!)}
                    title="Proven file/db/network effects still ask every run; this only stops re-asking about calls whose purity can't be verified. Lasts until the server restarts."
                    style={{
                      background: "color-mix(in oklab, var(--accent-warning) 14%, transparent)",
                      border: "1px solid color-mix(in oklab, var(--accent-warning) 40%, transparent)",
                      borderRadius: 4, color: "var(--accent-warning)", padding: "2px 8px",
                      cursor: "pointer", fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
                    }}
                  >Run & stop asking about unverifiable calls</button>
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                    this session · proven effects still ask
                  </span>
                </div>
              )}
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => confirmEffectConsent(sideEffectGate.token!)}
                  data-effect-confirm
                  style={{
                    background: "color-mix(in oklab, var(--accent-error) 16%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--accent-error) 50%, transparent)",
                    borderRadius: 4, color: "var(--accent-error)", padding: "4px 10px",
                    cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
                  }}
                >▷ Run with side effects</button>
                <button
                  onClick={() => { setRunResult(null); setSynthProposal(null); }}
                  style={{
                    background: "transparent", border: "1px solid var(--border-edge)",
                    borderRadius: 4, color: "var(--text-muted)", padding: "4px 10px",
                    cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)",
                  }}
                >Cancel</button>
              </div>
            </div>
          )}

          {/* ── SM2.d: synthesized-args confirm gate ──
              This is an INTERPRETATION-honesty gate, not a danger gate: the
              SM3 floor already proved the run is side-effect-free. We show
              the made-up inputs so a fabricated value (e.g. 0 → a spurious
              ZeroDivisionError) isn't misread as a real bug. Distinct from
              the side-effect refusal below, which uses blockedByEffect. */}
          {synthProposal && synthProposal.ok && (
            <div data-synth-proposal style={{
              background: "color-mix(in oklab, var(--accent-thread) 8%, var(--bg-canvas))",
              border: "1px solid color-mix(in oklab, var(--accent-thread) 40%, transparent)",
              borderRadius: 6, padding: "8px 10px", fontSize: 11, fontFamily: "var(--font-mono)", lineHeight: 1.5,
            }}>
              <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>These inputs are synthesized — confirm to run</div>
              <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 10 }}>
                Made-up values, not from a real call — edit any below if needed. Read the result in that light.
              </div>
              {/* M-RUN2.1 — the example instance the method would run on:
                  the constructor call, editable per arg like the args below. */}
              {synthProposal.instance && (
                <div data-synth-instance style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 10 }}>
                    example instance (made up — the method runs on it):
                  </div>
                  <div style={{ color: "var(--text-primary)" }}>
                    _obj = {synthProposal.instance.className}({Object.keys(instanceEdits ?? {}).length === 0 ? "" : "…"})
                  </div>
                  {Object.keys(instanceEdits ?? {}).map((p) => (
                    <div key={p} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{p} = </span>
                      <input
                        data-synth-instance-arg={p}
                        value={instanceEdits?.[p] ?? ""}
                        onChange={(ev) => setInstanceEdits((s) => ({ ...(s ?? {}), [p]: ev.target.value }))}
                        spellCheck={false}
                        style={{
                          flex: 1, minWidth: 0, background: "var(--bg-canvas)",
                          border: "1px solid var(--border-edge)", borderRadius: 3,
                          color: "var(--text-primary)", padding: "2px 6px",
                          fontSize: 11, fontFamily: "var(--font-mono)",
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {Object.keys(synthProposal.accepted).map((p) => (
                  <div key={p} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{p} = </span>
                    <input
                      data-synth-arg={p}
                      value={synthEdits[p] ?? ""}
                      onChange={(ev) => setSynthEdits((s) => ({ ...s, [p]: ev.target.value }))}
                      spellCheck={false}
                      style={{
                        flex: 1, minWidth: 0, background: "var(--bg-canvas)",
                        border: "1px solid var(--border-edge)", borderRadius: 3,
                        color: "var(--text-primary)", padding: "2px 6px",
                        fontSize: 11, fontFamily: "var(--font-mono)",
                      }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button
                  onClick={() => confirmSynthRun(synthEdits)}
                  data-synth-confirm
                  style={{
                    background: "color-mix(in oklab, var(--accent-thread) 16%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--accent-thread) 50%, transparent)",
                    borderRadius: 4, color: "var(--accent-thread)", padding: "4px 10px",
                    cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
                  }}
                >▷ Run with these inputs</button>
                <button
                  onClick={() => setSynthProposal(null)}
                  style={{
                    background: "transparent", border: "1px solid var(--border-edge)",
                    borderRadius: 4, color: "var(--text-muted)", padding: "4px 10px",
                    cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)",
                  }}
                >Cancel</button>
              </div>
            </div>
          )}
          {/* synth FAILURE (not the effect-block case — that's the gate above) */}
          {synthProposal && !synthProposal.ok && !synthProposal.blockedByEffect && (
            <div data-synth-proposal data-synth-blocked="0"
              data-synth-arraylike={synthProposal.arraylikeParams?.length ? "1" : "0"}
              style={{
                background: "color-mix(in oklab, var(--bg-canvas) 75%, transparent)",
                borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "var(--font-mono)", lineHeight: 1.5,
              }}>
              <div style={{ color: "var(--accent-warning)", fontWeight: 600 }}>
                {/* Sitting-3 — a tensor/array param is a feasibility verdict
                    ("can't seed this in isolation"), not a synth hiccup. */}
                {synthProposal.arraylikeParams?.length
                  ? "This node needs real array data — can't run it in isolation"
                  : "Couldn't synthesize valid inputs"}
              </div>
              {synthProposal.error && (
                <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 10, wordBreak: "break-word" }}>
                  {synthProposal.error.slice(0, 400)}
                </div>
              )}
            </div>
          )}

          {/* ── M-RUN2.3: drafted example-file consent gate ──
              Full content shown — informed consent means seeing every byte
              you approve. The token binds to THIS content; the file only
              ever exists in the run's throwaway project copy. */}
          {dataProposal && dataProposal.ok && (
            <div data-data-proposal style={{
              background: "color-mix(in oklab, var(--bg-canvas) 75%, transparent)",
              borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "var(--font-mono)", lineHeight: 1.5,
            }}>
              <div style={{ color: "var(--accent-warning)", fontWeight: 600 }}>
                This example file is made up — review it before running
              </div>
              <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 10 }}>
                {dataProposal.path} · drafted by Claude from the reading code · used only in a throwaway copy of your project
              </div>
              <pre className="vg-code-wrap" data-data-content style={{
                margin: "6px 0 0", padding: 6, borderRadius: 4, background: "var(--bg-canvas)",
                color: "var(--text-primary)", fontSize: 10, maxHeight: 160, overflowY: "auto",
              }}>{dataProposal.content}</pre>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button
                  data-data-confirm
                  onClick={() => confirmDataUse(dataProposal)}
                  style={{
                    background: "color-mix(in oklab, var(--accent-thread) 16%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--accent-thread) 50%, transparent)",
                    borderRadius: 4, color: "var(--accent-thread)", padding: "4px 10px",
                    cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
                  }}
                >{effectConsent || sideEffectGate ? "▷ Run with the listed effects + this example file" : "▷ Run with this example file"}</button>
                <button
                  onClick={() => setDataProposal(null)}
                  style={{
                    background: "transparent", border: "1px solid var(--border-edge)",
                    borderRadius: 4, color: "var(--text-muted)", padding: "4px 10px",
                    cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)",
                  }}
                >Cancel</button>
              </div>
            </div>
          )}
          {dataProposal && !dataProposal.ok && (
            <div data-data-proposal data-data-failed style={{
              background: "color-mix(in oklab, var(--bg-canvas) 75%, transparent)",
              borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "var(--font-mono)",
            }}>
              <div style={{ color: "var(--accent-warning)", fontWeight: 600 }}>Couldn't draft an example file</div>
              {dataProposal.error && (
                <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 10, wordBreak: "break-word" }}>
                  {dataProposal.error.slice(0, 300)}
                </div>
              )}
            </div>
          )}

          {runResult && !sideEffectGate && (() => {
            const o = runResult.outcome;
            // Honest tone per outcome — never a blank or a false success.
            const ok = o === "ok" || o === "value-opaque";
            const tone = ok ? "var(--accent-thread)"
              : (o === "import-error" || o === "runtime-error" || o === "harness-error" || o === "timeout")
                ? "var(--accent-error)" : "var(--accent-warning)";
            const headline: Record<string, string> = {
              ok: "captured value", "value-opaque": "captured value (non-deterministic repr)",
              "probe-not-reached": "Probe not reached with these inputs",
              "stop-not-enforced": "Ran past this node — a try/except swallowed the stop",
              "import-error": "Couldn't run — a dependency isn't in the environment",
              "runtime-error": "The code raised before reaching this node",
              "timeout": "Timed out", "value-ambiguous": "Nothing to capture at this node",
              "needs-inputs": "The function needs arguments before it can run",
              "unsupported-target": "Can't run here yet", "requires-confirmation": "Couldn't determine effects to confirm (scan unavailable) — not run",
              "harness-error": "Run harness error",
            };
            return (
              <div data-run-result data-run-outcome={o} style={{
                background: "color-mix(in oklab, var(--bg-canvas) 75%, transparent)",
                borderRadius: 6, padding: "6px 8px", fontSize: 11, fontFamily: "var(--font-mono)", lineHeight: 1.5,
              }}>
                <div style={{ color: tone, fontWeight: 600 }}>{headline[o] ?? o}</div>
                {runResult.value !== null && (
                  // A repr is often multi-line (any torch.nn.Module prints its
                  // whole layer stack). It scrolls in its own box rather than
                  // pushing the provenance line out of view — provenance must
                  // stay visible WITH the value it qualifies.
                  <div className="vg-code-wrap" data-run-value style={{
                    marginTop: 4, color: "var(--text-primary)",
                    maxHeight: 160, overflowY: "auto", paddingRight: 4,
                  }}>
                    <span style={{ color: "var(--text-muted)" }}>{label} = </span>{runResult.value}
                  </div>
                )}
                {/* Provenance travels WITH the value — never detached. For a
                    synthesized run, the made-up inputs are shown inline so the
                    value is read in light of the fabricated premise. */}
                {ok && (
                  <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 10 }}>
                    {runResult.provenance === "synthesized-input"
                      ? `ran with synthesized input: ${[
                          runResult.synthInstance ? `example instance ${runResult.synthInstance}` : null,
                          runResult.synthArgs || null,
                          runResult.synthData ? `example file ${runResult.synthData}` : null,
                        ].filter(Boolean).join(" · ") || "(none)"}`
                      : "ran with real input"}
                    {runResult.sandboxed ? " · in a throwaway copy of your project" : ""}
                    {runResult.valueOpaque ? " · value is non-deterministic (memory address)" : ""}
                  </div>
                )}
                {/* M-RUN2.3 post-run tier — the crash names a missing project
                    data file: offer a drafted example right on the card. */}
                {o === "runtime-error" && runResult.missingData?.map((m) => (
                  <div key={m.path} data-missing-data={m.path} style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--accent-warning)" }}>{m.path} doesn't exist yet</span>
                    <button
                      data-synth-data-offer={m.path}
                      disabled={dataDrafting}
                      onClick={() => requestDataDraft(m.path)}
                      style={{
                        background: "color-mix(in oklab, var(--accent-chat) 14%, transparent)",
                        border: "1px solid color-mix(in oklab, var(--accent-chat) 40%, transparent)",
                        borderRadius: 4, color: "var(--accent-chat)", padding: "2px 8px",
                        cursor: dataDrafting ? "not-allowed" : "pointer", fontSize: 10,
                        fontFamily: "var(--font-mono)", fontWeight: 600, opacity: dataDrafting ? 0.5 : 1,
                      }}
                    >{dataDrafting ? "drafting…" : "Ask Claude to draft an example file"}</button>
                  </div>
                ))}
              {/* M-TRAINED.3 — a missing ARTIFACT is never a drafting offer:
                    name the producer thread instead. */}
                {runResult.missingArtifacts?.map((m) => (
                  <div key={m.path} data-missing-artifact={m.path} style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--accent-warning)" }}>
                      {m.path} doesn't exist yet — {m.producers.length
                        ? `produced by ${m.producers.map((p) => p.qualifiedName).join(", ")}`
                        : "no producer found in this project"}
                    </span>
                    {m.producers.map((p) => (
                      <button
                        key={p.entryPointId}
                        data-artifact-run-producer={p.entryPointId}
                        onClick={() => document.dispatchEvent(new CustomEvent("vg-open-thread", { detail: { entryPointId: p.entryPointId } }))}
                        title="Open the producing thread — run it from its save-site node (usual consent gates)"
                        style={{
                          background: "color-mix(in oklab, var(--accent-thread) 14%, transparent)",
                          border: "1px solid color-mix(in oklab, var(--accent-thread) 40%, transparent)",
                          borderRadius: 4, color: "var(--accent-thread)", padding: "2px 8px",
                          cursor: "pointer", fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
                        }}
                      >Open producer thread</button>
                    ))}
                  </div>
                ))}
                {(runResult.stderr || runResult.error) && (
                  <pre className="vg-code-wrap" style={{ margin: "4px 0 0", color: "var(--accent-error)", fontSize: 10 }}>
                    {(runResult.stderr || runResult.error || "").slice(0, 600)}
                  </pre>
                )}
                {/* Sitting-2 — a failed run hands its evidence to the chat:
                    prefill only (the human reviews and sends; the chat's
                    Claude has the IR context + edit tools to propose a fix). */}
                {!ok && (runResult.stderr || runResult.error) && (
                  <div style={{ marginTop: 6 }}>
                    <button
                      data-run-ask-claude
                      onClick={() => {
                        const evidence = (runResult.stderr || runResult.error || "").slice(-600);
                        const premise = runResult.missingArtifacts?.length
                          ? `\n\nMissing artifact(s): ${runResult.missingArtifacts.map((m) =>
                              `${m.path}${m.producers.length ? ` (produced by ${m.producers.map((p) => p.qualifiedName).join(", ")})` : " (no producer found)"}`,
                            ).join("; ")}`
                          : "";
                        document.dispatchEvent(new CustomEvent("vg-chat-prefill", { detail: {
                          text: `Running the thread to \`${label}\` (${irNodeId ?? nodeId}) failed: ${headline[o] ?? o}.${premise}\n\n\`\`\`\n${evidence}\n\`\`\`\n\nWhat needs to happen to make this run work?`,
                        } }));
                      }}
                      title="Prefill the chat with this error — review and send; nothing is sent automatically"
                      style={{
                        background: "color-mix(in oklab, var(--accent-chat) 14%, transparent)",
                        border: "1px solid color-mix(in oklab, var(--accent-chat) 40%, transparent)",
                        borderRadius: 4, color: "var(--accent-chat)", padding: "2px 8px",
                        cursor: "pointer", fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
                      }}
                    >Ask Claude about this error</button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── action row: Save ── */}
      {canEdit && (
        <div style={{
          padding: "8px 10px",
          borderTop: "1px solid var(--border-edge)",
          background: "color-mix(in oklab, var(--bg-canvas) 40%, var(--bg-node))",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", gap: 6, alignItems: "stretch", justifyContent: "flex-end" }}>
            <button
              onClick={handleSave}
              disabled={saving || source === null || value === source}
              title="Save edits (CST-patched)"
              style={{
                background: saving
                  ? "var(--border-edge)"
                  : value !== source
                    ? "color-mix(in oklab, var(--accent-thread) 18%, transparent)"
                    : "transparent",
                border: `1px solid ${value !== source
                  ? "color-mix(in oklab, var(--accent-thread) 55%, transparent)"
                  : "var(--border-edge)"}`,
                borderRadius: 4,
                color: value !== source ? "var(--accent-thread)" : "var(--text-muted)",
                padding: "4px 10px",
                cursor: (saving || value === source) ? "not-allowed" : "pointer",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                transition: "all 0.12s",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── M13.2 — external-call body ─────────────────────────────────────────────
//
// Replaces the static "External library call — source not available."
// placeholder. While `resolved` is null we show a Resolving… state;
// when the server replies we render signature + docstring + module
// footer (or a richer "unresolved" message including the reason if
// the resolver couldn't classify).

// W6 — map the resolver's raw `error` to honest, less-alarming copy at the
// RENDER layer (the resolver output is unchanged). Distinguishes "package
// not installed in the analysis environment" from a genuinely unknown name,
// without claiming more than the error states.
function friendlyUnresolved(qualifiedName: string, error: string | null): { headline: string; note: string | null } {
  const base = qualifiedName.split(".")[0];
  const notInEnv = !!error && /No module named|not importable/i.test(error);
  if (notInEnv) {
    const isKnownThirdParty = /^(torch|numpy|pandas|scipy|sklearn|tensorflow|keras|cv2|PIL|matplotlib|requests|django|flask)$/.test(base);
    const what = isKnownThirdParty
      ? `\`${base}\` is a third-party package not installed in the analysis environment`
      : `\`${base}\` isn't a module available in the analysis environment`;
    return {
      headline: `External call to ${qualifiedName} — ${what}, so its source can't be resolved.`,
      note: "Expected for libraries the analyzer doesn't import — not an error in your code.",
    };
  }
  return {
    headline: `External call to ${qualifiedName} — source not resolvable in the analysis environment.`,
    note: error,
  };
}

function ExternalCallBody({
  resolved, qualifiedName, callSource,
}: {
  resolved: {
    kind: "stdlib" | "third_party" | "unresolved";
    signature: string | null;
    signatureSource: "inspect" | "stub" | null;
    docstring: string | null;
    module: string | null;
    sourceFile: string | null;
    error: string | null;
  } | null;
  qualifiedName: string;
  callSource?: string | null;
}) {
  // W6 — the call expression verbatim (e.g. `torch.stack([self.head(x) for
  // …])`), shown above the resolution status so the node detail leads with
  // the actual call. Wrapped (.vg-code-wrap), never clipped.
  const callRow = callSource && callSource.trim() && callSource.trim() !== qualifiedName ? (
    <div className="vg-code-wrap" style={{
      fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-secondary)",
      padding: "10px 18px 0", lineHeight: 1.5,
    }}>
      {callSource}
    </div>
  ) : null;
  // Loading — show the call verbatim immediately; resolution status below.
  if (!resolved) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 12 }}>
        {callRow}
        <div style={{
          padding: "6px 18px 0",
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <ExternalLink size={14} strokeWidth={1.5} />
          Resolving signature for <code>{qualifiedName}</code>…
        </div>
      </div>
    );
  }

  if (resolved.kind === "unresolved") {
    const { headline, note } = friendlyUnresolved(qualifiedName, resolved.error);
    return (
      <div style={{
        color: "var(--text-muted)",
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        display: "flex", flexDirection: "column", gap: 8,
        paddingBottom: 16,
      }}>
        {callRow}
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            <ExternalLink size={14} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 2 }} />
            <span className="vg-code-wrap">{headline}</span>
          </div>
          {note && (
            <div className="vg-code-wrap" style={{
              color: "var(--text-muted)", opacity: 0.7, fontSize: 11, paddingLeft: 22,
            }}>
              {note}
            </div>
          )}
        </div>
      </div>
    );
  }

  // stdlib | third_party
  const sigText = resolved.signature ?? "(…)";
  // First three lines of docstring as a preview; if longer, "…" suffix.
  const docLines = (resolved.docstring ?? "").split("\n");
  const docPreview = docLines.slice(0, 3).join("\n").trim();
  const hasMore = docLines.length > 3 || docLines.slice(3).some((l) => l.trim());

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 10,
      overflowY: "auto",
      height: "100%",
    }}>
      {callRow}
      <div style={{ padding: "12px 18px 0", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Signature row */}
      <div style={{
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        color: "var(--text-primary)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        <span style={{ color: "var(--accent-thread)" }}>{qualifiedName.split(".").pop()}</span>
        <span>{sigText}</span>
        {resolved.signatureSource === "stub" && (
          <span style={{
            color: "var(--text-muted)",
            fontSize: 10,
            marginLeft: 8,
            opacity: 0.7,
          }}>
            (C-extension; signature not introspectable)
          </span>
        )}
      </div>

      {/* Docstring preview */}
      {docPreview && (
        <div style={{
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          color: "var(--text-secondary)",
          whiteSpace: "pre-wrap",
          lineHeight: 1.5,
          paddingTop: 6,
          borderTop: "1px solid var(--border-edge)",
        }}>
          {docPreview}
          {hasMore && (
            <span style={{ color: "var(--text-muted)", opacity: 0.6 }}> …</span>
          )}
        </div>
      )}

      {/* Module footer */}
      <div style={{
        marginTop: "auto",
        paddingTop: 8,
        borderTop: "1px solid var(--border-edge)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--text-muted)",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <ExternalLink size={11} strokeWidth={1.5} />
        <span>{resolved.kind === "stdlib" ? "stdlib" : "third-party"}</span>
        <span>·</span>
        <code>{resolved.module ?? "?"}</code>
        {resolved.sourceFile && (
          <>
            <span>·</span>
            <span title={resolved.sourceFile} style={{
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              maxWidth: 240,
            }}>
              {resolved.sourceFile}
            </span>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
