import React from "react";
import { X } from "lucide-react";

export interface NodeFilters {
  showImports: boolean;
  showAssignments: boolean;
  showCalls: boolean;
  showReturns: boolean;
  showDunders: boolean;
  showDocstrings: boolean;
  // M-FV.3 (W3) — edge visibility, OFF by default. Structure (contains)
  // nesting lines are redundant with the M-FV.2 indentation; flow
  // (call/reference) lines are revealed on demand so they don't tangle.
  showStructureEdges: boolean;
  showFlowEdges: boolean;
}

export const DEFAULT_FILTERS: NodeFilters = {
  showImports: true,
  showAssignments: true,
  showCalls: true,
  showReturns: true,
  showDunders: true,
  showDocstrings: true,
  showStructureEdges: false,
  showFlowEdges: false,
};

// Edge-family toggles, rendered in their own section. The file view has no
// thread extraction, so the brief's "per-thread" toggle is realised as
// per-family (the grouping the IR actually carries); the two together are
// the all-on/all-off master.
const EDGE_ITEMS: Array<{ key: keyof NodeFilters; label: string; hint?: string }> = [
  { key: "showFlowEdges", label: "Flow lines", hint: "call / reference flow (thread-style)" },
  { key: "showStructureEdges", label: "Structure lines", hint: "contains / nesting" },
];

interface Props {
  filters: NodeFilters;
  onChange: (next: NodeFilters) => void;
  onClose: () => void;
}

const ITEMS: Array<{ key: keyof NodeFilters; label: string; hint?: string }> = [
  { key: "showImports", label: "Imports", hint: "import / from-import statements" },
  { key: "showAssignments", label: "Assignments", hint: "x = ..." },
  { key: "showCalls", label: "Calls", hint: "function call expressions" },
  { key: "showReturns", label: "Returns / Raises" },
  { key: "showDunders", label: "Dunder methods", hint: "__init__, __repr__, ..." },
  { key: "showDocstrings", label: "Docstrings" },
];

export function FiltersPanel({ filters, onChange, onClose }: Props) {
  const toggle = (key: keyof NodeFilters) => {
    onChange({ ...filters, [key]: !filters[key] });
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 56,
        right: 18,
        width: 240,
        background: "var(--bg-node)",
        border: "1px solid var(--border-edge)",
        borderRadius: 8,
        boxShadow: "var(--shadow-panel)",
        zIndex: 870,
        fontFamily: "monospace",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-edge)",
        }}
      >
        <span style={{ color: "var(--accent-thread)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", flex: 1 }}>
          Filters
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Close"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
      <div style={{ padding: "6px 4px" }}>
        {ITEMS.map((item) => (
          <label
            key={item.key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 5,
              cursor: "pointer",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in oklab, var(--accent-thread) 6%, transparent)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <input
              type="checkbox"
              checked={filters[item.key]}
              onChange={() => toggle(item.key)}
              style={{ marginTop: 2, accentColor: "var(--accent-thread)" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: filters[item.key] ? "var(--text-primary)" : "var(--text-muted)", fontSize: 11, fontWeight: 600 }}>
                {item.label}
              </div>
              {item.hint && (
                <div style={{ color: "var(--border-edge)", fontSize: 9, marginTop: 1 }}>{item.hint}</div>
              )}
            </div>
          </label>
        ))}
      </div>

      {/* ── edges section ── */}
      <div style={{ padding: "4px 12px 0", borderTop: "1px solid var(--border-edge)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, color: "var(--accent-thread)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Edges
        </span>
        <button
          data-edges-master
          onClick={() => {
            const anyOn = filters.showFlowEdges || filters.showStructureEdges;
            onChange({ ...filters, showFlowEdges: !anyOn, showStructureEdges: !anyOn });
          }}
          title="Toggle all edges"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-muted)", fontSize: 10, padding: 0, fontFamily: "monospace",
          }}
        >
          {filters.showFlowEdges || filters.showStructureEdges ? "all off" : "all on"}
        </button>
      </div>
      <div style={{ padding: "4px 4px 6px" }}>
        {EDGE_ITEMS.map((item) => (
          <label
            key={item.key}
            data-edge-toggle={item.key}
            style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: "6px 10px", borderRadius: 5, cursor: "pointer", transition: "background 0.1s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in oklab, var(--accent-thread) 6%, transparent)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <input
              type="checkbox"
              checked={filters[item.key]}
              onChange={() => toggle(item.key)}
              style={{ marginTop: 2, accentColor: "var(--accent-thread)" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: filters[item.key] ? "var(--text-primary)" : "var(--text-muted)", fontSize: 11, fontWeight: 600 }}>
                {item.label}
              </div>
              {item.hint && (
                <div style={{ color: "var(--border-edge)", fontSize: 9, marginTop: 1 }}>{item.hint}</div>
              )}
            </div>
          </label>
        ))}
      </div>

      <div
        style={{
          padding: "6px 12px 8px",
          borderTop: "1px solid var(--border-edge)",
          display: "flex",
          gap: 6,
        }}
      >
        <button
          onClick={() => onChange({
            ...filters, // preserve edge toggles — these buttons act on nodes
            showImports: true, showAssignments: true, showCalls: true,
            showReturns: true, showDunders: true, showDocstrings: true,
          })}
          style={{
            flex: 1,
            background: "color-mix(in oklab, var(--accent-thread) 10%, transparent)",
            border: "1px solid color-mix(in oklab, var(--accent-thread) 30%, transparent)",
            borderRadius: 5,
            color: "var(--accent-thread)",
            fontSize: 10,
            padding: "4px 8px",
            cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          Show all
        </button>
        <button
          onClick={() => onChange({
            ...filters, // preserve edge toggles
            showImports: false, showAssignments: false, showCalls: false,
            showReturns: false, showDunders: false, showDocstrings: true,
          })}
          style={{
            flex: 1,
            background: "color-mix(in oklab, var(--text-muted) 15%, transparent)",
            border: "1px solid var(--border-edge)",
            borderRadius: 5,
            color: "var(--text-secondary)",
            fontSize: 10,
            padding: "4px 8px",
            cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          Defs only
        </button>
      </div>
    </div>
  );
}
