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
import type { ArchModelRecord, ConstraintRecord, ConstraintKind, EntryPoint, StackPolicy, StackIndexRecord } from "../shared/protocol";
import type { RuleScope } from "../shared/scope_route";
import { bridge } from "./types";
import { ScopePicker } from "./rules/ScopePicker";
import { buildScopeGroups, scopeOfPicked, type ScopeInput } from "./rules/scopeGroups";

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

/** The typed escape hatch: comma-separated thread ids (they hold a ":") and paths. */
function parseTyped(raw: string): RuleScope {
  const parts = raw.split(",").map((s) => s.trim()).filter((s) => s && s !== "all");
  const entryPointIds = parts.filter((s) => s.includes(":"));
  const files = parts.filter((s) => !s.includes(":"));
  return { ...(entryPointIds.length ? { entryPointIds } : {}), ...(files.length ? { files } : {}) };
}

export function ConstraintsPanel({ constraints, stack, prefill, onPrefillConsumed, formOnly = false, entryPoints, threads, architecture, files }: {
  constraints: ConstraintRecord[];
  /** M-STACK.1 facts — feeds the tool multi-select. Absent = no index yet. */
  stack?: StackIndexRecord;
  prefill?: PolicyPrefill | null;
  onPrefillConsumed?: () => void;
  /** 2026-10-05 — the Rules panel lists the rules itself (ItemFrame); it
   *  takes only the "state one" form from here. */
  formOnly?: boolean;
  /** 2026-10-19 (PLAN-M-RULES M1) — the facts the grouped scope picker is
   *  read from; each absent one leaves its groups out. */
  entryPoints?: EntryPoint[];
  threads?: ReadonlyArray<{ entryPointId: string | null; filesReached: string[] }>;
  architecture?: ArchModelRecord | null;
  files?: readonly string[];
}) {
  const [kind, setKind] = useState<ConstraintKind>("invariant");
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  // the scope: picked chips (scopeGroups keys) or every thread
  const [picked, setPicked] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  // M-STACK.2 — the structured policy.
  const [rule, setRule] = useState<StackPolicy["rule"]>("prefer");
  const [policyTool, setPolicyTool] = useState("");
  const [policyWith, setPolicyWith] = useState("");

  const toolNames = React.useMemo(
    () => [...new Set((stack?.tools ?? []).map((t) => t.tool))],
    [stack],
  );
  const scopeInput: ScopeInput = React.useMemo(() => ({
    entryPoints: entryPoints ?? [], threads: threads ?? [], stack: stack ?? null, architecture: architecture ?? null, files: files ?? [],
  }), [entryPoints, threads, stack, architecture, files]);

  React.useEffect(() => {
    if (!prefill) return;
    setFormOpen(true);
    setKind("stack-policy");
    setPolicyTool(prefill.tool);
    setPicked([`stack:${prefill.tool}`]);
    setAll(false);
    onPrefillConsumed?.();
    // `prefill` is a one-shot instruction from the Stack panel, not state.
  }, [prefill]);

  const add = () => {
    if (!text.trim()) return;
    const groups = buildScopeGroups(scopeInput);
    const opts = groups.flatMap((g) => g.subgroups.flatMap((s) => s.options)).filter((o) => picked.includes(o.key));
    // a picked tool the groups no longer list (no stack index yet) still scopes by its name
    for (const k of picked) if (k.startsWith("stack:") && !opts.some((o) => o.key === k)) opts.push({ key: k, kind: "module", label: "", title: "", adds: { stack: [k.slice(6)] }, reaches: 0 });
    const merged = scopeOfPicked([...opts, { key: "typed", kind: "path", label: "", title: "", adds: parseTyped(typed), reaches: 0 }]);
    const scopeObj: RuleScope = all || (!merged.entryPointIds?.length && !merged.files?.length && !merged.stack?.length) ? { all: true } : merged;
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
    setPicked([]);
    setAll(false);
    setTyped("");
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

      {!formOnly && constraints.length === 0 && !formOpen && (
        <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
          None stated. Workers still receive each thread's IR-derived contract (data in/out, calls, round trips).
        </span>
      )}

      {!formOnly && constraints.map((c) => (
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
            <input data-constraint-scope value={typed} onChange={(e) => setTyped(e.target.value)}
              placeholder="or type paths / thread ids: api/, db.py, api/app.py:create_order"
              title="Added to what is picked below: a path ending / is a folder; a thread id holds a ':'"
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

          {/* 2026-10-19 (PLAN-M-RULES M1) — the scope, grouped: processes,
              threads, scripts, protocols, code, then the folded libraries and
              runtime; a tool chip is the M-STACK.2 dynamic scope (every
              thread whose stack uses it, including files that adopt it later). */}
          <ScopePicker input={scopeInput} picked={picked} onPicked={setPicked} all={all} onAll={setAll} typed={parseTyped(typed)} />

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
