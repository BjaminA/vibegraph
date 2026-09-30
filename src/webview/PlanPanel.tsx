// The PLAN panel (2026-09-30): the hypothetical project, objective first, and
// how the code measures up — each planned item with its status (PROPOSED /
// agreed / promoted) and its verdict (realised / drifted / not built …).
//
// The person at this panel is the one who AGREES: proposals arrive from Claude
// (MCP vibegraph_plan_edit, the chat) or the CLI, and are agreed, dropped or —
// for a planned rule — promoted into constraints.json here. Everything goes
// through the server's plan_ops, the same rules as every other door. Planned
// threads are drawn here as their primary chain; a realised one opens the
// real thread. The architecture map's Plan / Overlay views draw the rest.

import React, { useState } from "react";
import { DraftingCompass, X, Check, Trash2, ArrowUpRight, ExternalLink } from "lucide-react";
import type { Plan, PlanFinding, PlanSection, PlanVerdict } from "../shared/plan_types";
import { planItemId } from "../shared/plan_types";
import { belowToolbar, heightBelowToolbar } from "./TopToolbar";
import { usePlanState, sendPlanOp, promotePlanRule } from "./usePlanState";

const small: React.CSSProperties = { fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 };
const btn: React.CSSProperties = {
  background: "none", border: "1px solid var(--border-edge)", borderRadius: 4, color: "var(--text-secondary)",
  cursor: "pointer", padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--fs-11)", fontFamily: "var(--font-ui)",
};
const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--bg-canvas)", color: "var(--text-primary)",
  border: "1px solid var(--border-edge)", borderRadius: 4, padding: 8, fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", resize: "vertical",
};

const VERDICT_TONE: Record<PlanVerdict, string> = {
  realised: "var(--accent-thread)", pass: "var(--accent-thread)",
  drifted: "var(--accent-warning)", unverifiable: "var(--accent-warning)", unverified: "var(--text-muted)",
  "not-built": "var(--text-muted)", unanchored: "var(--text-muted)", prose: "var(--text-muted)",
  violated: "var(--accent-error)",
};

function Chip({ text, tone, title, dashed }: { text: string; tone: string; title?: string; dashed?: boolean }) {
  return (
    <span title={title} style={{
      fontSize: "var(--fs-11)", color: tone, border: `1px ${dashed ? "dashed" : "solid"} color-mix(in oklab, ${tone} 55%, transparent)`,
      borderRadius: 4, padding: "0 4px", whiteSpace: "nowrap",
    }}>{text}</span>
  );
}

const SECTION_TITLE: Record<PlanSection, string> = {
  processes: "Processes", stack: "Stack", boundaries: "Data boundaries", threads: "Threads (primary steps)", policies: "Planned rules (advice until promoted)", open: "Open questions",
};

function describe(section: PlanSection, it: any): { name: string; sub: string } {
  switch (section) {
    case "processes": return { name: it.label && it.label !== it.id ? `${it.id} — ${it.label}` : it.id, sub: `${it.kind}${it.at ? ` · ${it.at}` : ""}${it.serves ? ` · serves: ${it.serves}` : ""}` };
    case "stack": return { name: it.tool, sub: `${it.role}${it.why ? ` · ${it.why}` : ""}` };
    case "boundaries": return { name: `${it.id}  ${it.from} → ${it.to}`, sub: `${it.protocol ?? ""}${it.carries?.length ? ` {${it.carries.join(", ")}}` : ""}` };
    case "threads": return { name: it.id, sub: `${it.entry}${it.process ? ` in ${it.process}` : ""} · serves: ${it.serves}` };
    case "policies": return { name: `${it.id}  ${it.text}`, sub: `why: ${it.why}${it.check ? ` · checked: ${it.check.rule}` : ""}` };
    default: return { name: it.id, sub: it.text };
  }
}

function Item({ section, it, finding }: { section: PlanSection; it: any; finding?: PlanFinding }) {
  const { name, sub } = describe(section, it);
  const id = planItemId(section, it);
  const statusTone = it.status === "agreed" || it.status === "promoted" ? "var(--text-secondary)" : "var(--proposed-border)";
  return (
    <div data-plan-item={`${section}:${id}`} data-plan-status={it.status} data-plan-verdict={finding?.verdict}
      style={{ borderLeft: "2px dashed var(--proposed-border)", padding: "4px 0 4px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--text-primary)" }}>{name}</span>
        <Chip text={it.status === "proposed" ? "PROPOSED" : it.status === "promoted" ? `promoted · ${it.constraintId}` : it.status} tone={statusTone} dashed={it.status === "proposed"} />
        {finding && <Chip text={finding.verdict} tone={VERDICT_TONE[finding.verdict]} title={finding.detail} />}
      </div>
      {sub && <div style={small}>{sub}</div>}
      {section === "threads" && (
        <div data-plan-chain style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--text-secondary)", opacity: 0.8 }}>
          {it.primary.join("  →  ")}
        </div>
      )}
      {finding?.detail && <div style={{ ...small, fontStyle: "italic" }}>{finding.detail}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {it.status === "proposed" && (
          <button data-plan-agree style={btn} onClick={() => sendPlanOp({ op: "agree", section, id })} title="Agree to this planned item">
            <Check size={12} strokeWidth={1.5} /> Agree
          </button>
        )}
        {it.status !== "promoted" && (
          <button data-plan-drop style={btn} onClick={() => sendPlanOp({ op: "drop", section, id })} title="Drop it (kept on the record)">
            <Trash2 size={12} strokeWidth={1.5} /> Drop
          </button>
        )}
        {section === "policies" && it.status !== "promoted" && (
          <button data-plan-promote style={btn} onClick={() => promotePlanRule(id)}
            title="Copy it into .vibegraph/constraints.json as a human-stated rule — checked by `check` and the hooks, and it may block">
            <ArrowUpRight size={12} strokeWidth={1.5} /> Promote
          </button>
        )}
        {finding?.entryPointId && (
          <button data-plan-open-thread style={btn} onClick={() => document.dispatchEvent(new CustomEvent("vg-open-thread", { detail: { entryPointId: finding.entryPointId } }))}
            title="Open the real thread it matched">
            <ExternalLink size={12} strokeWidth={1.5} /> Thread
          </button>
        )}
      </div>
    </div>
  );
}

function Section({ plan, section, findings }: { plan: Plan; section: PlanSection; findings: PlanFinding[] }) {
  const items = (plan[section] as any[]).filter((i) => i.status !== "dropped");
  if (!items.length) return null;
  if (section === "open") {
    return (
      <div data-plan-section="open" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: "var(--fs-12)", color: "var(--text-secondary)" }}>{SECTION_TITLE.open}</div>
        {items.map((q) => (
          <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...small, color: "var(--text-primary)", flex: 1 }}>{q.id} {q.text}</span>
            <button style={btn} onClick={() => sendPlanOp({ op: "drop", section: "open", id: q.id })} title="Answered — remove the question">
              <Check size={12} strokeWidth={1.5} /> Answered
            </button>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div data-plan-section={section} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: "var(--fs-12)", color: "var(--text-secondary)" }}>{SECTION_TITLE[section]}</div>
      {items.map((it) => {
        const id = planItemId(section, it);
        return <Item key={id} section={section} it={it} finding={findings.find((f) => f.section === section && f.id === id)} />;
      })}
    </div>
  );
}

export function PlanPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { plan, reconcile, error, message } = usePlanState();
  const [objective, setObjective] = useState("");
  if (!open) return null;
  const findings = reconcile?.findings ?? [];
  return (
    <div data-plan-panel style={{
      position: "absolute", top: belowToolbar(16), right: 16, width: 480, boxSizing: "border-box",
      maxHeight: heightBelowToolbar(16), overflowY: "auto", background: "var(--bg-node)",
      border: "1px dashed var(--proposed-border)", borderRadius: 6, padding: 16, zIndex: 60,
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", gap: 16,
      fontFamily: "var(--font-ui)", color: "var(--text-primary)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <DraftingCompass size={16} strokeWidth={1.5} />
        <span style={{ fontSize: "var(--fs-13)", fontWeight: 600 }}>Plan</span>
        {plan && <span style={small}>revision {plan.revision}{plan.closed ? " · closed" : ""}</span>}
        <span style={{ flex: 1 }} />
        <button aria-label="Close plan panel" style={{ ...btn, border: "none" }} onClick={onClose}><X size={16} strokeWidth={1.5} /></button>
      </div>
      <div data-plan-banner style={{ ...small, border: "1px dashed var(--proposed-border)", borderRadius: 4, padding: 8 }}>
        Hypothetical — a plan, not the code. It will change, and nothing in it is true of the project until the code says so. Claude proposes; you agree, drop or promote.
      </div>
      {error && <div data-plan-error style={{ ...small, color: "var(--accent-error)" }}>{error}</div>}
      {message && !error && <div style={small}>{message}</div>}

      {!plan ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={small}>No plan yet. Start one with its objective — one line: what it is for. Then ask Claude (the chat, or a hooked Claude Code session) to propose processes, stack, data boundaries, primary threads and rules; they arrive here to agree or drop. On the command line: <code>vibegraph-knowledge plan init</code>.</div>
          <textarea data-plan-objective-input rows={2} style={field} placeholder="e.g. Operators see every pump's wear forecast within a minute of a reading" value={objective} onChange={(e) => setObjective(e.target.value)} />
          <button data-plan-start style={btn} disabled={!objective.trim()} onClick={() => sendPlanOp({ op: "set-objective", text: objective.trim() })}>
            <DraftingCompass size={12} strokeWidth={1.5} /> Start the plan
          </button>
        </div>
      ) : (
        <>
          <div data-plan-objective>
            <div style={small}>Objective</div>
            <div style={{ fontSize: "var(--fs-14)", lineHeight: 1.4 }}>{plan.objective}</div>
          </div>
          {reconcile && (
            <div data-plan-counts style={{ display: "flex", gap: 8, flexWrap: "wrap" }} title={reconcile.limits.join("\n")}>
              {Object.entries(reconcile.counts).map(([k, n]) => <Chip key={k} text={`${n} ${k}`} tone={VERDICT_TONE[k as PlanVerdict] ?? "var(--text-muted)"} />)}
              <span style={small}>plan vs code — hover for what it cannot see</span>
            </div>
          )}
          {(["processes", "stack", "boundaries", "threads", "policies", "open"] as PlanSection[]).map((s) => <Section key={s} plan={plan} section={s} findings={findings} />)}
          {plan.changelog.length > 0 && (
            <div data-plan-changelog style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: "var(--fs-12)", color: "var(--text-secondary)" }}>Recent changes</div>
              {plan.changelog.slice(-5).reverse().map((c, i) => <div key={i} style={small}>rev {c.rev} · {c.by} · {c.change}</div>)}
            </div>
          )}
          <div>
            <button data-plan-close style={btn} onClick={() => sendPlanOp({ op: plan.closed ? "reopen" : "close" })}
              title={plan.closed ? "Send the plan to hooked sessions again" : "Stop sending the plan to hooked sessions (kept on disk)"}>
              {plan.closed ? "Reopen the plan" : "Close the plan"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
