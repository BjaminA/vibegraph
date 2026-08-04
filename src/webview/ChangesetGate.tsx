// PLAN-v7 Stage 4 — the changeset gate: one build increment reviewed as a
// single unit (files + contents + the behavioural check), with the
// verification floor's verdict rendered honestly. "Accept & build" is
// enabled ONLY when the floor is green (parse per file + behavioural check
// ran and passed); a failed floor still renders — an honest decline with
// reasons, not a hidden one. Reject drops the overlay; nothing was written.
//
// Fixed top-center, --proposed-* family (a changeset is a PLAN for code,
// gated exactly like the ghost architecture). Third proposal-bar sibling —
// but a changeset needs file expansion, so it is a panel, not a bar row.

import React, { useEffect, useState } from "react";
import { Check, X, ChevronRight, ChevronDown, FileCode2, FlaskConical, TriangleAlert, Sparkles, PenLine, Loader2 } from "lucide-react";
import { bridge, type PendingChangeset } from "./types";
import { GateButton } from "./controls/GateButton";

// Plain-language names for the effect scanner's kinds (the raw vocabulary —
// "fs", "db" — read as jargon at the consent gate; Ben's sitting).
const EFFECT_LABEL: Record<string, string> = {
  fs: "file-system",
  db: "database",
  http: "network",
  subprocess: "subprocess",
  log: "logging",
};

export function ChangesetGate({ pending }: { pending: PendingChangeset }) {
  const { changeset, floor } = pending;
  const [openFile, setOpenFile] = useState<string | null>(null);
  // M-GF3.5 — the Modify flow: inline instruction → changeset-modify →
  // the server re-drafts + re-floors and a fresh proposal replaces this one.
  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyText, setModifyText] = useState("");
  const [modifying, setModifying] = useState(false);

  const accept = () => document.dispatchEvent(new CustomEvent("vg-changeset-accept"));
  const reject = () => document.dispatchEvent(new CustomEvent("vg-changeset-reject"));
  const consent = () => document.dispatchEvent(new CustomEvent("vg-changeset-consent"));
  // Sitting-2 — session category-trust: stop re-asking about unverifiable
  // calls (proven effects still gate per-run). Routes the trustToken.
  const trustConsent = () => document.dispatchEvent(new CustomEvent("vg-changeset-consent", { detail: { trust: true } }));

  const submitModify = () => {
    const instruction = modifyText.trim();
    if (!instruction || modifying) return;
    setModifying(true);
    bridge.postMessage({
      type: "changeset-modify",
      payload: { instruction, runItemId: pending.runItemId, label: changeset.label },
    });
  };

  // A new proposal arrived (the re-draft) → this is a fresh decision.
  useEffect(() => {
    setModifying(false);
    setModifyOpen(false);
    setModifyText("");
  }, [pending]);

  // M-GF3.5 — Escape is the implicit reject (the header × made visible).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !modifying) {
        e.preventDefault();
        reject();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modifying]);

  // PLAN-v7 6b — the check scanned effectful and awaits explicit consent:
  // token minted, not yet consented. The gate renders every offense (informed
  // consent) + the danger-framed run affordance; nothing runs until clicked.
  const consentPending = floor.check.pure === false && !!floor.check.consentToken && !floor.check.consented;

  const mono = "var(--font-mono)";

  return (
    <div
      data-changeset-gate
      style={{
        position: "fixed", top: "calc(var(--vg-toolbar-bottom, 43px) + 12px)", left: "50%", transform: "translateX(-50%)",
        zIndex: 1015, width: 560, maxHeight: "70vh", overflowY: "auto",
        background: "color-mix(in oklab, var(--bg-node) 94%, transparent)",
        border: "1px solid var(--proposed-border)", borderRadius: 8,
        padding: 16, boxShadow: "0 0 14px var(--proposed-glow)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", flexDirection: "column", gap: 12,
        fontFamily: mono,
      }}
    >
      {/* header — the honesty label */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", color: "var(--accent-chat)" }}>
          <Sparkles size={16} strokeWidth={1.5} />
        </span>
        <span style={{ fontSize: "var(--fs-12)", color: "var(--text-primary)", fontWeight: 700 }}>
          {changeset.label}
        </span>
        <span
          data-changeset-badge
          style={{
            fontSize: "var(--fs-11)", color: "var(--text-muted)", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.08em", marginLeft: "auto",
          }}
        >
          {modifying
            ? "Re-drafting with your instruction…"
            : changeset.drafted ? "Builder draft — not yet written" : "Proposed changeset — not yet written"}
        </span>
        {modifying && <Loader2 size={14} strokeWidth={1.5} className="vg-spin" color="var(--accent-chat)" />}
        {/* M-GF3.5 — the × IS the reject: closing the gate declines the
            changeset (build-run-reject when a run item is gated). */}
        <button
          data-changeset-reject
          onClick={reject}
          disabled={modifying}
          title="Dismiss — rejects this changeset (Esc)"
          style={{
            background: "none", border: "none", color: "var(--text-muted)",
            cursor: modifying ? "not-allowed" : "pointer", padding: 2,
            display: "flex", alignItems: "center",
          }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* files + per-file floor */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {floor.files.map((f) => {
          const file = changeset.files.find((cf) => cf.path === f.path);
          const lines = (f.formatted ?? file?.content ?? "").split("\n").length;
          const open = openFile === f.path;
          // 6c — the op is part of what the human approves: a create ("+"),
          // an append ("+»"), or a node replacement ("~") each read honestly.
          const op = file?.op ?? "create_file";
          const opPrefix = op === "create_file" ? "+" : op === "append_end" ? "+»" : "~";
          const opDetail = op === "append_end" ? " · append" : op === "replace_node" ? ` · replaces ${file?.nodeId ?? "?"}` : "";
          return (
            <div key={f.path} data-changeset-file={f.path} data-file-ok={f.ok ? "true" : "false"} data-file-op={op}>
              <div
                onClick={() => setOpenFile(open ? null : f.path)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                  padding: "4px 8px", borderRadius: 6,
                  background: "color-mix(in oklab, var(--bg-canvas) 60%, transparent)",
                }}
              >
                {open ? <ChevronDown size={16} strokeWidth={1.5} color="var(--text-muted)" />
                  : <ChevronRight size={16} strokeWidth={1.5} color="var(--text-muted)" />}
                <FileCode2 size={16} strokeWidth={1.5} color="var(--proposed-accent)" />
                <span style={{ fontSize: "var(--fsm-12)", color: "var(--text-primary)" }}>{opPrefix} {f.path}</span>
                <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
                  {lines} lines{f.newNodes != null ? ` · ${f.newNodes} nodes` : ""}{opDetail}
                </span>
                <span style={{ marginLeft: "auto", fontSize: "var(--fs-11)", color: f.ok ? "var(--accent-thread)" : "var(--accent-error)" }}>
                  {f.ok ? "✓ parses" : "✗"}
                </span>
              </div>
              {!f.ok && f.error && (
                <div style={{ fontSize: "var(--fs-11)", color: "var(--accent-error)", padding: "2px 32px" }}>{f.error}</div>
              )}
              {open && (
                <pre
                  data-changeset-file-content
                  style={{
                    margin: "4px 0 8px 32px", padding: 8, borderRadius: 6, overflowX: "auto",
                    background: "var(--bg-canvas)", border: "1px dashed var(--proposed-border)",
                    fontSize: "var(--fsm-12)", color: "var(--text-secondary)", maxHeight: 220,
                  }}
                >
                  {f.formatted ?? file?.content ?? ""}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      {/* behavioural check — the floor's second half */}
      <div
        data-changeset-check
        data-check-ok={floor.check.ok ? "true" : "false"}
        style={{
          display: "flex", flexDirection: "column", gap: 4, padding: "6px 8px",
          borderRadius: 6, background: "color-mix(in oklab, var(--bg-canvas) 60%, transparent)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FlaskConical size={16} strokeWidth={1.5} color="var(--proposed-accent)" />
          <span style={{ fontSize: "var(--fsm-12)", color: "var(--text-primary)" }}>{changeset.check.description}</span>
          <span style={{ marginLeft: "auto", fontSize: "var(--fs-11)", color: floor.check.ok ? "var(--accent-thread)" : "var(--accent-error)" }}>
            {floor.check.ok ? "✓ passed" : floor.check.ran ? "✗ failed" : "not run"}
          </span>
        </div>
        {floor.check.pure === false && !floor.check.consented && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-11)", color: "var(--accent-warning)" }}>
            <TriangleAlert size={16} strokeWidth={1.5} />
            not run — {(floor.check.offenses ?? []).length} call{(floor.check.offenses ?? []).length === 1 ? "" : "s"} in this check can't be verified side-effect-free
          </div>
        )}
        {/* PLAN-v7 6b — the check RAN under explicit consent: label it, never
            launder it as pure. */}
        {floor.check.consented && (
          <div data-check-consented style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-11)", color: "var(--accent-warning)" }}>
            <TriangleAlert size={16} strokeWidth={1.5} />
            check ran with real side effects — you approved it ({(floor.check.offenses ?? []).length} unverified call{(floor.check.offenses ?? []).length === 1 ? "" : "s"})
          </div>
        )}
        {floor.check.error && !consentPending && (
          <div style={{ fontSize: "var(--fs-11)", color: "var(--accent-error)" }}>{floor.check.error}</div>
        )}
        {/* PLAN-v7 6b — consent gate for an effectful check. DANGER framing
            (running executes these for real, in the sandbox copy), mirroring
            the SM3 run-to-node effect gate: every detected offense listed for
            INFORMED consent; the button sends the scope-bound token the
            server re-validates against a fresh scan. */}
        {consentPending && (
          <div data-changeset-effect-gate style={{
            background: "color-mix(in oklab, var(--accent-error) 8%, var(--bg-canvas))",
            border: "1px solid color-mix(in oklab, var(--accent-error) 45%, transparent)",
            borderRadius: 6, padding: "8px 10px", fontSize: "var(--fs-11)", lineHeight: 1.5,
          }}>
            <div style={{ color: "var(--accent-error)", fontWeight: 600 }}>
              This check can't be proven safe to auto-run
            </div>
            <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: "var(--fs-11)" }}>
              A check only runs automatically when every call in it is verifiably
              free of side effects. These calls can't be verified — common with
              PyTorch and other dynamic dispatch, and often harmless, but that
              can't be proven. Run the check anyway and they execute for real,
              in a copy of your project:
            </div>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
              {(floor.check.offenses ?? []).map((ef, i) => (
                <div key={i} style={{ color: "var(--text-primary)" }}>
                  <span style={{ color: "var(--accent-error)" }}>
                    {ef.kind === "effect" ? `${EFFECT_LABEL[ef.effectKind ?? ""] ?? ef.effectKind} effect` : "unverified call"}
                  </span>
                  {" · "}{ef.target}
                  <span style={{ color: "var(--text-muted)" }}> ({ef.file}:{ef.line})</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <GateButton
                data-changeset-consent
                accent="error" filled armOnClick resetKey={pending}
                pendingLabel="Running check…"
                onClick={consent}
                style={{ padding: "4px 10px", fontWeight: 600 }}
              >▷ Run the check anyway</GateButton>
              {/* Sitting-2 — the floor can't name the library behind these
                  calls (that unknowability IS the refusal), so the honest
                  standing grant is per-category: unverifiable calls stop
                  asking; proven fs/db/network effects always still gate. */}
              {floor.check.trustToken && (
                <GateButton
                  data-changeset-trust
                  accent="warning" filled armOnClick resetKey={pending}
                  pendingLabel="Running check…"
                  onClick={trustConsent}
                  title="Proven file/db/network effects still ask every run; this only stops re-asking about calls whose purity can't be verified. Lasts until the server restarts."
                  style={{ padding: "4px 10px", fontWeight: 600 }}
                >Run & stop asking about unverifiable calls</GateButton>
              )}
            </div>
          </div>
        )}
        {floor.check.ran && floor.check.output.trim() && (
          <pre style={{
            margin: 0, padding: 6, borderRadius: 4, background: "var(--bg-canvas)",
            fontSize: "var(--fs-11)", color: "var(--text-muted)", maxHeight: 96, overflowY: "auto",
          }}>
            {floor.check.output.trim()}
          </pre>
        )}
      </div>

      {/* M-GF3.5 — the Modify instruction row (open on demand). */}
      {modifyOpen && !modifying && (
        <div data-changeset-modify-row style={{ display: "flex", gap: 6 }}>
          <input
            data-changeset-modify-input
            autoFocus
            value={modifyText}
            onChange={(e) => setModifyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitModify();
              // Escape falls through to the document handler = reject; stop
              // it here so closing the INPUT doesn't close the gate.
              else if (e.key === "Escape") { e.stopPropagation(); setModifyOpen(false); }
            }}
            placeholder="what should change? (Enter to re-draft)"
            style={{
              flex: 1, background: "var(--bg-canvas)", border: "1px solid var(--border-edge)",
              borderRadius: 5, padding: "5px 8px", color: "var(--text-primary)",
              fontSize: "var(--fs-11)", fontFamily: mono, outline: "none",
            }}
          />
          <button
            data-changeset-modify-submit
            onClick={submitModify}
            disabled={!modifyText.trim()}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: "color-mix(in oklab, var(--accent-chat) 14%, transparent)",
              border: "1px solid color-mix(in oklab, var(--accent-chat) 40%, transparent)",
              borderRadius: 5, color: "var(--accent-chat)", fontSize: "var(--fs-11)",
              fontWeight: 700, padding: "5px 10px", fontFamily: mono,
              cursor: modifyText.trim() ? "pointer" : "not-allowed",
              opacity: modifyText.trim() ? 1 : 0.5,
            }}
          >
            <PenLine size={14} strokeWidth={1.5} /> Re-draft
          </button>
        </div>
      )}

      {/* the gate — accept only when the floor is green; Modify re-drafts
          (M-GF3.5: reject moved to the header × / Esc). */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        {!floor.ok && (
          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", marginRight: "auto" }}>
            floor not green — acceptance disabled
          </span>
        )}
        <GateButton
          data-changeset-accept
          accent="thread" filled armOnClick resetKey={pending}
          pendingLabel="Building…"
          disabled={!floor.ok || modifying}
          onClick={accept}
        >
          <Check size={14} strokeWidth={1.5} /> Accept & build
        </GateButton>
        <GateButton
          data-changeset-modify
          accent="chat"
          disabled={modifying}
          onClick={() => setModifyOpen((v) => !v)}
          style={{ borderColor: "var(--border-edge)" }}
        >
          <PenLine size={14} strokeWidth={1.5} /> Modify
        </GateButton>
      </div>
    </div>
  );
}
