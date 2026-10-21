// What Claude is told about one direction item (2026-10-20, Ben: "rename the
// options so less confusing and instead of a drop down have the two toggles
// on each rule — tell nothing is redundant as that's the default").
//
// Two switches, the same on a generic skill and on an agreed project rule:
//   Tell Claude up front            its rules once per session, when a prompt
//                                   reaches a thread it applies to;
//   Explain when an edit breaks it  the rule and its reason, beside the
//                                   finding, when an edit trips its check.
// Both off is "not used". A switch flips the moment it is pressed — the
// caller holds the new value until the server's echo replaces it.
import React from "react";
import type { Delivery } from "../../shared/generic_skills_wire";

export const UPFRONT_LABEL = "Tell Claude up front";
export const ONCHECK_LABEL = "Explain when an edit breaks it";

export function Switch({ on, onToggle, label, hint, disabled, data }: {
  on: boolean; onToggle: () => void; label: string; hint: string; disabled?: boolean; data: Record<string, string>;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={disabled || undefined}
      title={hint}
      onClick={() => { if (!disabled) onToggle(); }}
      {...Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v]))}
      data-on={on ? "true" : "false"}
      className="vg-switch"
      style={{
        display: "inline-flex", alignItems: "center", gap: 8, border: "none", background: "transparent", padding: "4px 0",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
        fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: on ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      {/* Neutral, not a hue: inside a panel a selected state is a neutral
          highlight (kinds.css, Ben 2026-10-08) — on is a lit track and a
          bright knob on the right, off a dim outline and a muted knob. */}
      <span aria-hidden className="vg-switch-track" style={{
        position: "relative", flex: "0 0 auto", width: 32, height: 20, borderRadius: 999, boxSizing: "border-box",
        border: `1px solid ${on ? "var(--text-secondary)" : "var(--border-edge)"}`,
        background: on ? "color-mix(in oklab, var(--text-primary) 18%, transparent)" : "transparent",
      }}>
        <span className="vg-switch-knob" style={{
          position: "absolute", top: 3, left: on ? 15 : 3, width: 12, height: 12, borderRadius: 999,
          background: on ? "var(--text-primary)" : "var(--text-muted)",
        }} />
      </span>
      {label}
    </button>
  );
}

/** The two switches. `canCheck` false: nothing checks the rule, so the second
 *  switch is shown off and disabled, with the reason. */
export function DeliverySwitches({ value, onChange, canCheck = true, upfrontHint, data }: {
  value: Delivery; onChange: (patch: Partial<Delivery>) => void; canCheck?: boolean; upfrontHint: string; data: Record<string, string>;
}) {
  return (
    <div data-delivery-switches style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
      <Switch on={value.upfront} onToggle={() => onChange({ upfront: !value.upfront })} label={UPFRONT_LABEL} hint={upfrontHint}
        data={{ ...data, delivery: "upfront" }} />
      <Switch on={canCheck && value.onCheck} onToggle={() => onChange({ onCheck: !value.onCheck })} label={ONCHECK_LABEL}
        disabled={!canCheck}
        hint={canCheck ? "When an edit trips the check this rule is tied to, Claude gets the rule and its reason beside the finding — once per rule per session. Advice: it never blocks." : "Nothing checks this rule, so no edit can trip it — it can only be told up front."}
        data={{ ...data, delivery: "oncheck" }} />
    </div>
  );
}

/** What a control shows before the server answers: the pressed value, held
 *  until EVERY message this panel sent has been answered — then the
 *  server's state alone, so a refused change (or one the server sanitised)
 *  never lingers as a local fiction. Call `answered()` once per reply. */
export function useHeld<T>(): {
  shown: (key: string, server: T) => T;
  press: (key: string, value: T) => void;
  answered: () => void;
} {
  const [held, setHeld] = React.useState<Record<string, T>>({});
  const inFlight = React.useRef(0);
  return {
    shown: (key, server) => (key in held ? held[key] : server),
    press: (key, value) => { inFlight.current += 1; setHeld((h) => ({ ...h, [key]: value })); },
    answered: () => {
      inFlight.current = Math.max(0, inFlight.current - 1);
      if (inFlight.current === 0) setHeld((h) => (Object.keys(h).length ? {} : h));
    },
  };
}
