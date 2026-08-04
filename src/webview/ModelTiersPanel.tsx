// Model tiers — route spawns by what they do, so mechanical work stops
// paying the Opus per-spawn floor (~$0.25 measured, vs ~$0.04 on Haiku).
//
// Presented by WHAT EACH TIER GOVERNS rather than by role name: "thinker /
// do-er" reads naturally but is ambiguous about where code generation
// sits, and in VibeGraph code generation is the expensive-to-get-wrong
// part. Listing the operations under each picker makes the trade visible
// at the point of choice.
import React from "react";
import {
  ROUTINE_OPTIONS, THINKING_OPTIONS, TIER_GOVERNS, TIER_LABEL,
  type TierOption, type TierSettings,
} from "../shared/model_tiers";

interface Props {
  tiers: TierSettings;
  onChange: (next: TierSettings) => void;
  onClose: () => void;
}

function TierRow({ tier, options, value, onPick }: {
  tier: "thinking" | "routine";
  options: TierOption[];
  value: string | null;
  onPick: (v: string | null) => void;
}) {
  const active = options.find((o) => o.id === value) ?? options[0];
  return (
    <div style={{ marginBottom: 20 }}>
      <label
        style={{
          display: "block", fontSize: 11, color: "var(--text-primary)",
          fontWeight: 600, marginBottom: 4,
        }}
      >
        {TIER_LABEL[tier]}
      </label>
      <select
        data-model-tier={tier}
        value={value ?? "__default"}
        onChange={(e) => onPick(e.target.value === "__default" ? null : e.target.value)}
        style={{
          width: "100%", background: "var(--bg-canvas)",
          border: "1px solid var(--border-edge)", borderRadius: 4,
          color: "var(--text-primary)", fontSize: 12, padding: "4px 8px",
          fontFamily: "monospace", cursor: "pointer",
        }}
      >
        {options.map((o) => (
          // The native option list is drawn by the browser and does NOT
          // inherit the select's background on Linux/Chrome — without an
          // explicit opaque colour here the open dropdown lets the canvas
          // through.
          <option
            key={o.id ?? "__default"}
            value={o.id ?? "__default"}
            style={{ background: "var(--bg-node)", color: "var(--text-primary)" }}
          >
            {o.label}
          </option>
        ))}
      </select>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{active.hint}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
        Governs: {TIER_GOVERNS[tier].join(" · ")}
      </div>
    </div>
  );
}

export function ModelTiersPanel({ tiers, onChange, onClose }: Props) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-model-tiers-panel
      style={{
        position: "absolute", top: "var(--vg-chipstrip-h, 56px)", right: 16,
        // --bg-node is the canonical opaque panel surface (hsl(220 12% 12%)),
        // the same one FiltersPanel uses. An earlier --bg-panel here was not
        // a real token, so it resolved to nothing and the canvas showed
        // straight through the panel.
        width: 300, background: "var(--bg-node)",
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
          style={{
            background: "none", border: "none", color: "var(--text-muted)",
            cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0,
          }}
        >
          ×
        </button>
      </div>

      <TierRow
        tier="thinking"
        options={THINKING_OPTIONS}
        value={tiers.thinking}
        onPick={(v) => onChange({ ...tiers, thinking: v })}
      />
      <TierRow
        tier="routine"
        options={ROUTINE_OPTIONS}
        value={tiers.routine}
        onPick={(v) => onChange({ ...tiers, routine: v })}
      />

      {/* The chat is deliberately absent: switching models mid-conversation
          invalidates a model-scoped prompt cache, so it keeps its own
          per-conversation picker in the chat header instead. */}
      <div
        style={{
          fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5,
          borderTop: "1px solid var(--border-edge)", paddingTop: 10,
        }}
      >
        The chat picks its own model in the chat header — switching it
        mid-conversation would drop the cached history.
      </div>
    </div>
  );
}
