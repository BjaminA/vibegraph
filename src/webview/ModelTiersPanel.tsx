// Model tiers — route spawns by what they do, so mechanical work stops
// paying the Opus per-spawn floor (~$0.25 measured, vs ~$0.04 on Haiku).
//
// Presented by WHAT EACH TIER GOVERNS rather than by role name: "thinker /
// do-er" reads naturally but is ambiguous about where code generation
// sits, and in VibeGraph code generation is the expensive-to-get-wrong
// part. Listing the operations under each picker makes the trade visible
// at the point of choice.
//
// M-PROVIDER — every tier also picks its PROVIDER: the claude CLI (the
// tier's model), a LOCAL Ollama server (an endpoint URL + a model name —
// the app never loads weights itself), or a custom command that speaks the
// `claude -p` contract. Work-run workers are their own tier so the small
// local axe can be handed to them without handing it to the brief and the
// review. The "Test" button probes an endpoint SERVER-side (version, model
// list, a four-token generation with its tokens per second) — the same
// health check a human would run by hand.
import React, { useState } from "react";
import {
  ROUTINE_OPTIONS, THINKING_OPTIONS, WORKER_OPTIONS, TIER_GOVERNS, TIER_LABEL, TIERS,
  DEFAULT_LOCAL, isSafeEndpoint, isSafeModelName, isSafeCommand,
  type ModelTier, type TierOption, type TierSettings, type TierRoute, type ProviderKind,
} from "../shared/model_tiers";
import { belowToolbar, heightBelowToolbar } from "./TopToolbar";

export interface EndpointProbeResult {
  endpoint: string;
  ok: boolean;
  version?: string;
  models?: string[];
  model?: string;
  tokPerSec?: number;
  loadSeconds?: number;
  error?: string;
}

interface Props {
  tiers: TierSettings;
  onChange: (next: TierSettings) => void;
  onClose: () => void;
  /** M-PROVIDER — ask the server to probe an endpoint (and optionally a model). */
  onProbe?: (endpoint: string, model?: string) => void;
  probe?: EndpointProbeResult | null;
  probing?: boolean;
}

const OPTIONS: Record<ModelTier, TierOption[]> = {
  thinking: THINKING_OPTIONS, routine: ROUTINE_OPTIONS, worker: WORKER_OPTIONS,
};

const selectStyle: React.CSSProperties = {
  width: "100%", background: "var(--bg-canvas)",
  border: "1px solid var(--border-edge)", borderRadius: 4,
  color: "var(--text-primary)", fontSize: 12, padding: "4px 8px",
  fontFamily: "monospace", cursor: "pointer",
};
const inputStyle: React.CSSProperties = { ...selectStyle, cursor: "text" };
const optionStyle: React.CSSProperties = { background: "var(--bg-node)", color: "var(--text-primary)" };

function claudeModelOf(tier: ModelTier, tiers: TierSettings): string | null {
  return tier === "thinking" ? tiers.thinking : tier === "routine" ? tiers.routine : (tiers.worker ?? "match");
}

function TierRow({ tier, tiers, onChange, probe }: {
  tier: ModelTier;
  tiers: TierSettings;
  onChange: (next: TierSettings) => void;
  probe?: EndpointProbeResult | null;
}) {
  const options = OPTIONS[tier];
  const route: TierRoute = tiers.routes?.[tier] ?? { provider: "claude" };
  const provider: ProviderKind = route.provider;
  const claudeValue = claudeModelOf(tier, tiers);
  const active = options.find((o) => o.id === claudeValue) ?? options[0];
  const local = tiers.local ?? DEFAULT_LOCAL;
  const setRoute = (next: TierRoute | null) => {
    const routes = { ...(tiers.routes ?? {}) };
    if (next) routes[tier] = next; else delete routes[tier];
    onChange({ ...tiers, routes });
  };
  const setClaudeModel = (v: string | null) => {
    onChange(tier === "thinking" ? { ...tiers, thinking: v } : tier === "routine" ? { ...tiers, routine: v } : { ...tiers, worker: v });
  };
  const floorWarning = tier !== "routine" && provider !== "claude";
  return (
    <div data-model-tier-row={tier} style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 11, color: "var(--text-primary)", fontWeight: 600, marginBottom: 4 }}>
        {TIER_LABEL[tier]}
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <select
          data-model-provider={tier}
          value={provider}
          onChange={(e) => {
            const p = e.target.value as ProviderKind;
            setRoute(p === "claude" ? null : p === "ollama" ? { provider: "ollama" } : { provider: "command", command: "" });
          }}
          style={selectStyle}
        >
          <option value="claude" style={optionStyle}>Claude</option>
          <option value="ollama" style={optionStyle}>Local (Ollama)</option>
          <option value="command" style={optionStyle}>Custom command</option>
        </select>
        {provider === "claude" && (
          <select
            data-model-tier={tier}
            value={claudeValue ?? "__default"}
            onChange={(e) => setClaudeModel(e.target.value === "__default" ? null : e.target.value)}
            style={selectStyle}
          >
            {options.map((o) => (
              // The native option list is drawn by the browser and does NOT
              // inherit the select's background on Linux/Chrome — without an
              // explicit opaque colour here the open dropdown lets the canvas
              // through.
              <option key={o.id ?? "__default"} value={o.id ?? "__default"} style={optionStyle}>{o.label}</option>
            ))}
          </select>
        )}
        {provider === "ollama" && (
          <select
            data-model-local-model={tier}
            value={route.model ?? ""}
            onChange={(e) => setRoute({ ...route, provider: "ollama", ...(e.target.value ? { model: e.target.value } : { model: undefined }) })}
            style={selectStyle}
            title="Which local model this tier uses (blank = the Local defaults below)"
          >
            <option value="" style={optionStyle}>{`default (${local.model})`}</option>
            {(probe?.models ?? []).filter((m) => m !== local.model).map((m) => (
              <option key={m} value={m} style={optionStyle}>{m}</option>
            ))}
            {route.model && route.model !== local.model && !(probe?.models ?? []).includes(route.model) && (
              <option value={route.model} style={optionStyle}>{route.model}</option>
            )}
          </select>
        )}
        {provider === "command" && (
          <input
            data-model-command={tier}
            value={route.command ?? ""}
            placeholder="node /path/to/shim.mjs …"
            onChange={(e) => setRoute({ provider: "command", command: e.target.value })}
            style={{ ...inputStyle, ...(route.command && !isSafeCommand(route.command) ? { borderColor: "var(--accent-error)" } : {}) }}
            title="A program that speaks the claude -p contract; spawned without a shell"
          />
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
        {provider === "claude" ? active.hint
          : provider === "ollama" ? `Local server at ${route.endpoint ?? local.endpoint}`
          : "Your command receives the same arguments claude would; its stdout must be the claude -p result JSON."}
      </div>
      {floorWarning && (
        <div data-model-floor-warning={tier} style={{ fontSize: 11, color: "var(--accent-warning)", marginTop: 4, lineHeight: 1.5 }}>
          A floor can reject this tier's output (edits go through the chokepoint; skills and explain are grounding-gated).
          A weak local model here means retries and escalations, not silent damage.
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
        Governs: {TIER_GOVERNS[tier].join(" · ")}
      </div>
    </div>
  );
}

export function ModelTiersPanel({ tiers, onChange, onClose, onProbe, probe, probing }: Props) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const local = tiers.local ?? DEFAULT_LOCAL;
  const [endpointDraft, setEndpointDraft] = useState(local.endpoint);
  const [modelDraft, setModelDraft] = useState(local.model);
  const endpointOk = isSafeEndpoint(endpointDraft);
  const modelOk = isSafeModelName(modelDraft);
  const commitLocal = () => {
    if (!endpointOk || !modelOk) return;
    onChange({ ...tiers, local: { endpoint: endpointDraft.replace(/\/+$/, ""), model: modelDraft } });
  };
  const anyLocal = TIERS.some((t) => tiers.routes?.[t]?.provider === "ollama");

  return (
    <div
      data-model-tiers-panel
      style={{
        // Was `var(--vg-chipstrip-h, 56px)` — a HEIGHT used as a top offset,
        // which ignored the toolbar band and slid under it once the band
        // wrapped. See belowToolbar's note.
        position: "absolute", top: belowToolbar(16), right: 16,
        // --bg-node is the canonical opaque panel surface (hsl(220 12% 12%)),
        // the same one FiltersPanel uses. An earlier --bg-panel here was not
        // a real token, so it resolved to nothing and the canvas showed
        // straight through the panel.
        // border-box: padding and border sit outside maxHeight otherwise.
        width: 360, boxSizing: "border-box",
        maxHeight: heightBelowToolbar(16), overflowY: "auto", background: "var(--bg-node)",
        border: "1px solid var(--border-edge)", borderRadius: 6,
        padding: 16, zIndex: 60,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>Models</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          title="Close"
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
        >
          ×
        </button>
      </div>

      {TIERS.map((tier) => (
        <TierRow key={tier} tier={tier} tiers={tiers} onChange={onChange} probe={probe} />
      ))}

      {/* M-PROVIDER — the local server every "Local (Ollama)" choice falls back to; the chat's "Local" option uses it too. */}
      <div data-model-local style={{ borderTop: "1px solid var(--border-edge)", paddingTop: 12, marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 11, color: "var(--text-primary)", fontWeight: 600, marginBottom: 4 }}>
          Local server (Ollama)
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
          <input
            data-model-local-endpoint
            value={endpointDraft}
            onChange={(e) => setEndpointDraft(e.target.value)}
            onBlur={commitLocal}
            placeholder="http://localhost:11434"
            style={{ ...inputStyle, ...(endpointOk ? {} : { borderColor: "var(--accent-error)" }) }}
            title="Ollama's HTTP endpoint — WSL reaches a Windows server at localhost under mirrored networking"
          />
          <div style={{ display: "flex", gap: 6 }}>
            <input
              data-model-local-name
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              onBlur={commitLocal}
              list="vg-local-models"
              placeholder="qwen2.5-coder:7b"
              style={{ ...inputStyle, flex: 1, ...(modelOk ? {} : { borderColor: "var(--accent-error)" }) }}
            />
            <datalist id="vg-local-models">
              {(probe?.models ?? []).map((m) => <option key={m} value={m} />)}
            </datalist>
            <button
              data-model-local-test
              disabled={!endpointOk || !!probing}
              onClick={() => { commitLocal(); onProbe?.(endpointDraft.replace(/\/+$/, ""), modelOk ? modelDraft : undefined); }}
              style={{
                background: "none", border: "1px solid var(--border-edge)", borderRadius: 4,
                color: endpointOk ? "var(--accent-thread)" : "var(--text-muted)", fontSize: 11, padding: "4px 10px",
                cursor: endpointOk ? "pointer" : "not-allowed",
              }}
              title="Probe the server: version, model list, and a four-token generation"
            >
              {probing ? "Testing…" : "Test"}
            </button>
          </div>
        </div>
        {probe && (
          <div
            data-model-probe-result
            data-model-probe-ok={probe.ok ? "true" : "false"}
            style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5, color: probe.ok && !probe.error ? "var(--accent-thread)" : "var(--accent-warning)" }}
          >
            {probe.ok
              ? `Ollama ${probe.version} · ${(probe.models ?? []).length} model(s)${probe.tokPerSec !== undefined ? ` · ${probe.model}: ${probe.tokPerSec} tok/s (load ${probe.loadSeconds ?? 0}s)` : ""}${probe.error ? ` · ${probe.error}` : ""}`
              : `${probe.endpoint}: ${probe.error ?? "not reachable"}`}
          </div>
        )}
        {!anyLocal && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
            No tier uses the local server yet — pick “Local (Ollama)” on a tier above, or “Local” in the chat's model picker.
          </div>
        )}
      </div>

      {/* The chat is deliberately absent: switching models mid-conversation
          invalidates a model-scoped prompt cache, so it keeps its own
          per-conversation picker in the chat header instead. */}
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, borderTop: "1px solid var(--border-edge)", paddingTop: 10 }}>
        The chat picks its own model in the chat header — switching it
        mid-conversation would drop the cached history. Its “Local” option uses the server above.
      </div>
    </div>
  );
}
