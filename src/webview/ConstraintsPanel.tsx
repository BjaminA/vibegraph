// M-CONTRACT.3 (PLAN-M-CONTRACT.md) — the stated-constraints section of
// the Agent Manager board: every constraint with its KIND, SOURCE
// (human / orchestrator / agent — the provenance every prompt line
// carries), scope, and a remove affordance; plus the form a human uses
// to state one. Renders server state only; add/remove are WS messages
// validated server-side (constraint_store.ts).
//
// Aesthetic: muted chips; amber ONLY for agent-stated rows (treat with
// care — nobody reviewed them); tokens throughout, lucide only.

import React, { useState } from "react";
import { X, ListChecks } from "lucide-react";
import type { ConstraintRecord, ConstraintKind, StackPolicy, StackIndexRecord } from "../shared/protocol";
import { bridge } from "./types";

const mono = "var(--font-mono)";
const KINDS: ConstraintKind[] = ["payload-schema", "proxy", "backend-call", "perf-lever", "invariant", "objective", "stack-policy"];
// M-STACK.2 — the rules a stack policy can state; `replace-with` is the
// only one whose `with` is required (validated server-side too).
const RULES: StackPolicy["rule"][] = ["prefer", "require", "forbid", "replace-with"];

function policyLabel(p: StackPolicy): string {
  switch (p.rule) {
    case "require": return `require ${p.tool}`;
    case "prefer": return `prefer ${p.tool}${p.with ? ` over ${p.with}` : ""}`;
    case "forbid": return `forbid ${p.tool}${p.with ? ` in favour of ${p.with}` : ""}`;
    case "replace-with": return `replace ${p.tool} with ${p.with ?? "?"}`;
    // M-CMD.3 — written by the classify pass (and by a person stating what a
    // private SDK is); rendered here, stated through the CLI or MCP.
    case "describe": return `${p.tool} is classified as ${p.role ?? "?"}`;
  }
}

const SOURCE_LABEL: Record<ConstraintRecord["source"], string> = {
  human: "human · authoritative",
  orchestrator: "orchestrator · from the confirmed objective",
  agent: "agent · NOT human-reviewed",
};

function scopeLabel(s: ConstraintRecord["scope"]): string {
  if (s.all) return "all threads";
  const parts: string[] = [];
  if (s.entryPointIds?.length) parts.push(`threads: ${s.entryPointIds.join(", ")}`);
  if (s.files?.length) parts.push(`files: ${s.files.join(", ")}`);
  // M-STACK.2 — a tool scope is DYNAMIC: it follows the facts, so it is
  // labelled differently from the hand-kept lists above.
  if (s.stack?.length) parts.push(`tools: ${s.stack.join(", ")} (any thread that uses them)`);
  return parts.join(" · ") || "(no scope)";
}

function Chip({ children, tone = "muted", title }: { children: React.ReactNode; tone?: "muted" | "warn"; title?: string }) {
  const color = tone === "warn" ? "var(--accent-warning)" : "var(--text-muted)";
  return (
    <span title={title} style={{
      fontSize: "var(--fs-11)", fontFamily: mono, color,
      border: `1px solid color-mix(in oklab, ${color} 45%, transparent)`,
      borderRadius: 4, padding: "1px 6px",
    }}>{children}</span>
  );
}

const inputStyle: React.CSSProperties = {
  background: "color-mix(in oklab, var(--bg-canvas) 60%, transparent)",
  border: "1px solid var(--border-edge)", borderRadius: 6,
  color: "var(--text-primary)", fontFamily: mono, fontSize: "var(--fsm-12)", padding: "6px 8px",
};

/** M-STACK.2 — the Stack panel's "state a policy" hands this in; the form
 *  opens pre-filled on it. One constraint form, two entry points. */
export interface PolicyPrefill {
  tool: string;
  role?: string;
}

export function ConstraintsPanel({ constraints, stack, prefill, onPrefillConsumed }: {
  constraints: ConstraintRecord[];
  /** M-STACK.1 facts — feeds the tool multi-select. Absent = no index yet. */
  stack?: StackIndexRecord;
  prefill?: PolicyPrefill | null;
  onPrefillConsumed?: () => void;
}) {
  const [kind, setKind] = useState<ConstraintKind>("invariant");
  const [text, setText] = useState("");
  const [scope, setScope] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  // M-STACK.2 — tool scope + the structured policy.
  const [scopeStack, setScopeStack] = useState<string[]>([]);
  const [rule, setRule] = useState<StackPolicy["rule"]>("prefer");
  const [policyTool, setPolicyTool] = useState("");
  const [policyWith, setPolicyWith] = useState("");

  const toolNames = React.useMemo(
    () => [...new Set((stack?.tools ?? []).map((t) => t.tool))],
    [stack],
  );

  React.useEffect(() => {
    if (!prefill) return;
    setFormOpen(true);
    setKind("stack-policy");
    setPolicyTool(prefill.tool);
    setScopeStack([prefill.tool]);
    setScope("");
    onPrefillConsumed?.();
    // `prefill` is a one-shot instruction from the Stack panel, not state.
  }, [prefill]);

  const toggleTool = (t: string) =>
    setScopeStack((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const add = () => {
    if (!text.trim()) return;
    const raw = scope.trim();
    const scopeObj: { all?: boolean; entryPointIds?: string[]; files?: string[]; stack?: string[] } =
      !raw || raw === "all"
        ? (scopeStack.length ? {} : { all: true })
        : {
          entryPointIds: raw.split(",").map((s) => s.trim()).filter((s) => s.includes(":")),
          files: raw.split(",").map((s) => s.trim()).filter((s) => s && !s.includes(":")),
        };
    if (scopeStack.length) scopeObj.stack = scopeStack;
    bridge.postMessage({
      type: "add-constraint",
      payload: {
        kind, text, scope: scopeObj,
        ...(kind === "stack-policy"
          ? { policy: { tool: policyTool.trim(), rule, ...(policyWith.trim() ? { with: policyWith.trim() } : {}) } }
          : {}),
      },
    });
    setText("");
    setFormOpen(false);
    setScopeStack([]);
    setPolicyTool("");
    setPolicyWith("");
  };

  return (
    <div data-constraints-panel style={{
      border: "1px solid var(--border-edge)", borderRadius: 10, padding: "10px 14px",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ListChecks size={14} strokeWidth={1.5} color="var(--text-muted)" />
        <span style={{ fontSize: "var(--fs-12)", fontWeight: 700 }}>Constraints</span>
        <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", fontFamily: mono }}>
          stated facts the IR cannot see — routed to threads by scope, injected with their source
        </span>
        <span style={{ marginLeft: "auto" }} />
        <button data-constraint-form-toggle onClick={() => setFormOpen((v) => !v)}
          style={{ background: "none", border: "1px solid var(--border-edge)", borderRadius: 4,
            color: "var(--text-muted)", cursor: "pointer", padding: "2px 8px", fontSize: "var(--fs-11)", fontFamily: mono }}>
          {formOpen ? "cancel" : "+ state one"}
        </button>
      </div>

      {constraints.length === 0 && !formOpen && (
        <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
          None stated. Workers still receive each thread's IR-derived contract (data in/out, calls, round trips).
        </span>
      )}

      {constraints.map((c) => (
        <div key={c.id} data-constraint-row={c.id} data-constraint-source={c.source}
          style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: "var(--fs-12)", lineHeight: 1.5 }}>
          <Chip>{c.kind}</Chip>
          <Chip tone={c.source === "agent" ? "warn" : "muted"} title={c.note}>{SOURCE_LABEL[c.source]}</Chip>
          <span style={{ flex: 1 }}>
            {/* M-STACK.2 — the policy imperative leads; the human sentence follows. */}
            {c.policy && (
              <span data-constraint-policy={c.id} style={{ fontFamily: mono, color: "var(--accent-thread)" }}>
                {policyLabel(c.policy)} —{" "}
              </span>
            )}
            {c.text}
            <span style={{ color: "var(--text-muted)", fontFamily: mono, fontSize: "var(--fs-11)" }}> — {scopeLabel(c.scope)}</span>
          </span>
          <button data-constraint-remove={c.id} title="Remove this constraint"
            onClick={() => bridge.postMessage({ type: "remove-constraint", payload: { id: c.id } })}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}>
            <X size={13} strokeWidth={1.5} />
          </button>
        </div>
      ))}

      {formOpen && (
        <div data-constraint-form style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select data-constraint-kind value={kind} onChange={(e) => setKind(e.target.value as ConstraintKind)} style={inputStyle}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input data-constraint-scope value={scope} onChange={(e) => setScope(e.target.value)}
              placeholder="all · or files/threads: api/, db.py, api/app.py:create_order"
              style={{ ...inputStyle, flex: 1, minWidth: 240 }} />
          </div>

          {/* M-STACK.2 — the structured policy. Only kind stack-policy carries
              one; the server refuses it on any other kind, so the fields only
              exist here. */}
          {kind === "stack-policy" && (
            <div data-constraint-policy-form style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select data-constraint-rule value={rule} onChange={(e) => setRule(e.target.value as StackPolicy["rule"])} style={inputStyle}>
                {RULES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <input data-constraint-policy-tool value={policyTool} onChange={(e) => setPolicyTool(e.target.value)}
                list="vg-stack-tools" placeholder="tool (e.g. requests)" style={{ ...inputStyle, width: 200 }} />
              <input data-constraint-policy-with value={policyWith} onChange={(e) => setPolicyWith(e.target.value)}
                list="vg-stack-tools"
                placeholder={rule === "replace-with" ? "use this instead (required)" : "instead of / over (optional)"}
                style={{ ...inputStyle, width: 220 }} />
              <datalist id="vg-stack-tools">
                {toolNames.map((t) => <option key={t} value={t} />)}
              </datalist>
            </div>
          )}

          {/* M-STACK.2 — TOOL scope, fed by the stack index: a constraint
              scoped this way reaches every thread whose stack uses the tool,
              including files that adopt it later. */}
          {toolNames.length > 0 && (
            <div data-constraint-stack-scope style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", fontFamily: mono, marginRight: 4 }}>
                or scope by tool ·
              </span>
              {toolNames.map((t) => {
                const on = scopeStack.includes(t);
                return (
                  <button key={t} data-stack-scope-chip={t} onClick={() => toggleTool(t)}
                    title={on ? `Remove ${t} from this constraint's scope` : `Scope this constraint to every thread that uses ${t}`}
                    style={{
                      background: on ? "color-mix(in oklab, var(--accent-thread) 16%, transparent)" : "none",
                      border: `1px solid color-mix(in oklab, ${on ? "var(--accent-thread)" : "var(--text-muted)"} 45%, transparent)`,
                      borderRadius: 4, padding: "1px 6px", cursor: "pointer",
                      color: on ? "var(--accent-thread)" : "var(--text-muted)",
                      fontSize: "var(--fs-11)", fontFamily: mono,
                    }}>{t}</button>
                );
              })}
            </div>
          )}

          <textarea data-constraint-text value={text} onChange={(e) => setText(e.target.value)} rows={2}
            placeholder="e.g. every /orders payload keeps {id, customer, total}; the gateway batches order-item inserts"
            style={{ ...inputStyle, resize: "vertical" }} />
          <div>
            <button data-constraint-add onClick={add}
              style={{
                background: "color-mix(in oklab, var(--accent-thread) 16%, transparent)",
                border: "1px solid color-mix(in oklab, var(--accent-thread) 55%, transparent)",
                borderRadius: 4, color: "var(--accent-thread)", padding: "4px 12px",
                cursor: "pointer", fontSize: "var(--fs-11)", fontFamily: mono, fontWeight: 600,
              }}>State constraint (as human)</button>
          </div>
        </div>
      )}
    </div>
  );
}
