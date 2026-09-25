// M-STACK.3 (PLAN-M-STACK.md) — the Stack panel: what this project is
// actually built ON, grouped by role, with the EVIDENCE behind each tool
// and the POLICIES stated about it.
//
// The panel is the human-readable face of the same index the brief, the
// workers and the chat read, so it holds the same floor: a fact carries
// evidence and never a source label; a policy carries provenance and
// never presents as fact; a tool the taxonomy cannot classify is listed
// as unclassified rather than dropped. "State a policy" does not write
// anything — it opens the constraint form pre-filled, because a policy is
// a human decision, not a consequence of a fact.
//
// Aesthetic: ModelTiersPanel's shell (--bg-node surface, top-right dock),
// muted chips, thread accent for project funnels, amber only for
// agent-stated policies and manifest-only evidence. lucide only.

import React from "react";
import { Boxes, FileWarning, GitMerge, ScrollText } from "lucide-react";
import type { ConstraintRecord, StackIndexRecord, StackToolRecord } from "../shared/protocol";
import { ROLE_LABEL, ROLE_ORDER, type StackRole } from "../shared/stack_taxonomy";
import { belowToolbar, heightBelowToolbar } from "./TopToolbar";

const mono = "var(--font-mono)";

function policiesFor(constraints: ConstraintRecord[], tool: string): ConstraintRecord[] {
  return constraints.filter((c) => c.policy?.tool === tool || c.policy?.with === tool || c.scope.stack?.includes(tool));
}

function policyLabel(c: ConstraintRecord): string {
  const p = c.policy;
  if (!p) return c.text;
  switch (p.rule) {
    case "require": return `require ${p.tool}`;
    case "prefer": return `prefer ${p.tool}${p.with ? ` over ${p.with}` : ""}`;
    case "forbid": return `forbid ${p.tool}${p.with ? ` in favour of ${p.with}` : ""}`;
    case "replace-with": return `replace ${p.tool} with ${p.with ?? "?"}`;
    case "describe": return `${p.tool} is classified as ${p.role ?? "?"}`;
  }
}

function ToolRow({ tool, constraints, onStatePolicy }: {
  tool: StackToolRecord;
  constraints: ConstraintRecord[];
  onStatePolicy: (tool: string, role: string) => void;
}) {
  const bound = policiesFor(constraints, tool.tool);
  const configOnly = tool.evidence.every((e) => e.kind === "config");
  const files = [...new Set(tool.evidence.map((e) => e.file))];
  return (
    <div data-stack-tool={tool.tool} data-stack-role={tool.role} data-stack-origin={tool.origin}
      style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {tool.origin === "project" && <GitMerge size={13} strokeWidth={1.5} color="var(--accent-thread)" />}
        <span style={{
          fontFamily: mono, fontSize: "var(--fsm-12)",
          color: tool.origin === "project" ? "var(--accent-thread)" : "var(--text-primary)",
        }}>{tool.tool}</span>
        {tool.version && <span style={{ fontFamily: mono, fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>v{tool.version}</span>}
        {tool.wraps?.length ? (
          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
            project funnel wrapping {tool.wraps.join(", ")}
          </span>
        ) : null}
        <span style={{ marginLeft: "auto" }} />
        <button data-stack-state-policy={tool.tool} onClick={() => onStatePolicy(tool.tool, tool.role)}
          title={`State a policy about ${tool.tool} — opens the constraint form, scoped to every thread that uses it`}
          style={{
            background: "none", border: "1px solid var(--border-edge)", borderRadius: 4,
            color: "var(--text-muted)", cursor: "pointer", padding: "1px 6px",
            fontSize: "var(--fs-11)", fontFamily: mono,
          }}>+ policy</button>
      </div>
      <div data-stack-evidence={tool.tool} style={{ fontSize: "var(--fs-11)", color: configOnly ? "var(--accent-warning)" : "var(--text-muted)", lineHeight: 1.5 }}>
        {configOnly && <FileWarning size={11} strokeWidth={1.5} style={{ verticalAlign: "-1px", marginRight: 4 }} />}
        {configOnly
          ? `${tool.evidence.length} manifest/config line(s) — no code parsed for this tool`
          : `${tool.evidence.length} site(s) · ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` +${files.length - 3} more` : ""}`}
        {tool.threads.length > 0 && ` · ${tool.threads.length} thread(s)`}
      </div>
      {/* M-BOUNDARY.2 — presence and use are different facts. `threads` is
          every thread whose files hold this tool; `calledOn` is the ones
          with a boundary that actually reaches it. A tool present but never
          called is a dead dependency or a resolution gap, and saying so is
          the point of keeping the two apart. */}
      {tool.calledOn && tool.threads.length > 0 && (
        <div data-stack-called={tool.tool} data-stack-called-count={tool.calledOn.length}
          style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 }}>
          {tool.calledOn.length === 0
            ? `present in ${tool.threads.length} thread(s), called on none`
            : `called on ${tool.calledOn.length} thread(s)${
              tool.threads.length > tool.calledOn.length
                ? `; present in ${tool.threads.length - tool.calledOn.length} more`
                : ""}`}
        </div>
      )}
      {bound.map((c) => (
        <div key={c.id} data-stack-policy={`${tool.tool}:${c.id}`}
          style={{
            fontSize: "var(--fs-11)", lineHeight: 1.5, paddingLeft: 10,
            borderLeft: `2px solid color-mix(in oklab, ${c.source === "agent" ? "var(--accent-warning)" : "var(--accent-thread)"} 55%, transparent)`,
            color: "var(--text-muted)",
          }}>
          <span style={{ fontFamily: mono }}>{policyLabel(c)}</span>
          {" — "}
          {c.text}
          <span style={{ fontFamily: mono }}> [{c.id} · {c.source}-stated]</span>
        </div>
      ))}
    </div>
  );
}

export function StackPanel({ stack, constraints, onClose, onStatePolicy }: {
  stack: StackIndexRecord | null;
  constraints: ConstraintRecord[];
  onClose: () => void;
  onStatePolicy: (tool: string, role: string) => void;
}) {
  const tools = stack?.tools ?? [];
  const byRole = new Map<StackRole, StackToolRecord[]>();
  for (const t of tools) {
    if (!byRole.has(t.role as StackRole)) byRole.set(t.role as StackRole, []);
    byRole.get(t.role as StackRole)!.push(t);
  }
  return (
    <div data-stack-panel style={{
      // `var(--vg-chipstrip-h, 56px)` was the strip's HEIGHT used as a top
      // OFFSET, so the panel sat 56px from the viewport top and ignored the
      // toolbar entirely. Fine while the band was one row (48px); at 1280px
      // it wraps to 82 and at 1100 to 116, and the panel's own header went
      // behind it.
      position: "absolute", top: belowToolbar(16), right: 16,
      // border-box, or the panel's own 16px padding and 1px border sit
      // OUTSIDE maxHeight and it overruns the viewport by 34px — which the
      // old 80vh hid only because 80vh left room to spare.
      width: 420, boxSizing: "border-box",
      maxHeight: heightBelowToolbar(16), overflowY: "auto", background: "var(--bg-node)",
      border: "1px solid var(--border-edge)", borderRadius: 6,
      padding: 16, zIndex: 60, boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Boxes size={14} strokeWidth={1.5} color="var(--text-muted)" />
        <span style={{ fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text-primary)" }}>Stack</span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} title="Close"
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>
          ×
        </button>
      </div>
      <div style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
        What the code imports, calls and declares — IR fact, with the evidence behind each. A decision <em>about</em> a tool is a stated policy and is shown beneath it.
      </div>

      {tools.length === 0 && (
        <div style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 }}>
          No tools detected. In single-file mode there is no project to index; in a project this means nothing outside the language's own standard library is imported.
        </div>
      )}

      {ROLE_ORDER.filter((r) => byRole.has(r)).map((role) => (
        <div key={role} data-stack-role-group={role} style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: "var(--fs-11)", fontFamily: mono, fontWeight: 600,
            color: role === "unknown" ? "var(--accent-warning)" : "var(--text-primary)",
            borderBottom: "1px solid var(--border-edge)", paddingBottom: 2, marginBottom: 4,
          }}>
            {role === "unknown" ? "unclassified — named, never guessed" : ROLE_LABEL[role]}
          </div>
          {byRole.get(role)!.map((t) => (
            <ToolRow key={`${t.tool}:${t.role}`} tool={t} constraints={constraints} onStatePolicy={onStatePolicy} />
          ))}
        </div>
      ))}

      <div style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5, borderTop: "1px solid var(--border-edge)", paddingTop: 10, display: "flex", gap: 6 }}>
        <ScrollText size={12} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Versions come only from a manifest (requirements*.txt / pyproject.toml / package.json) — no manifest, no version claimed. Nothing here installs or changes a dependency.
        </span>
      </div>
    </div>
  );
}
