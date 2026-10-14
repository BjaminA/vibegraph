// The ACCESS GRID (2026-10-12): who may write (W) or read (R) each zone, a
// principal per row and a zone group per column — collapsed to "W n · R m",
// a click opens the group into its zones. On the Resources lens, beside the map.

import React from "react";
import { createPortal } from "react-dom";
import { Grid3x3, X } from "lucide-react";
import type { Topology } from "../../shared/topology_types";
import { GRANT_EDGE_CAP, accessGrid, zoneGroupsOf } from "../../shared/topology_groups";

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)" };
const btn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 4, border: "1px solid var(--border-edge)", borderRadius: 4, padding: "4px 8px", cursor: "pointer", background: "transparent", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)" };

export function AccessGrid({ t }: { t: Topology }) {
  // a store with more grants than the map draws opens on the grid
  const [open, setOpen] = React.useState(() => (t.grants ?? []).filter((g) => g.access === "write").length > GRANT_EDGE_CAP);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const groups = React.useMemo(() => zoneGroupsOf(t), [t]);
  const grid = React.useMemo(() => accessGrid(t), [t]);
  if (!(t.grants ?? []).length) return null;
  if (!open) return <button data-access-grid-open onClick={() => setOpen(true)} style={btn} title="Who may write (W) or read (R) each zone — a role × zone grid"><Grid3x3 size={16} strokeWidth={1.5} />Access grid</button>;
  const grouped = new Set(groups.flatMap((g) => g.zones));
  // columns: each group (collapsed or opened into its zones), then the zones in no group
  const cols: Array<{ key: string; label: string; zones: string[]; group?: string }> = [];
  for (const g of groups) {
    if (expanded.has(g.id)) for (const z of g.zones) cols.push({ key: z, label: z, zones: [z], group: g.id });
    else cols.push({ key: g.id, label: `${g.label} (${g.zones.length})`, zones: g.zones, group: g.id });
  }
  for (const z of (t.zones ?? []).map((x) => x.id).filter((z) => !grouped.has(z))) cols.push({ key: z, label: z, zones: [z] });
  const cellText = (p: string, zones: string[]) => {
    if (zones.length === 1) return grid.cell(p, zones[0]);
    const w = zones.filter((z) => grid.cell(p, z).includes("W")).length, r = zones.filter((z) => grid.cell(p, z).includes("R")).length;
    return [w ? `W ${w}` : "", r ? `R ${r}` : ""].filter(Boolean).join(" · ");
  };
  const toggle = (g: string) => setExpanded((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  // on document.body: the lens bar's backdrop-filter makes it the containing
  // block of a fixed child, which squeezed the grid into a strip with scrollbars
  return createPortal(
    <div data-access-grid style={{ position: "fixed", left: 16, right: 16, top: "calc(var(--vg-lens-bar-bottom, 120px) + 56px)", bottom: 16, zIndex: 34, overflow: "auto",
      background: "var(--bg-node)", border: "1px solid var(--border-edge)", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", color: "var(--text-primary)" }}>
        <Grid3x3 size={16} strokeWidth={1.5} />{`Access grid · ${grid.principals.length} principals × ${(t.zones ?? []).length} zones · W write, R read — click a group to open it`}
        <button aria-label="Close the access grid" onClick={() => setOpen(false)} style={{ ...btn, marginLeft: "auto" }}><X size={16} strokeWidth={1.5} /></button>
      </div>
      <table style={{ borderCollapse: "collapse", ...mono }}>
        <thead>
          <tr>
            <th style={{ position: "sticky", left: 0, background: "var(--bg-node)", textAlign: "left", padding: "4px 8px" }}>principal</th>
            {cols.map((c) => (
              <th key={c.key} data-access-col={c.key} onClick={c.group ? () => toggle(c.group!) : undefined} title={c.zones.join(", ")}
                style={{ padding: "4px 8px", whiteSpace: "nowrap", cursor: c.group ? "pointer" : "default", color: c.group ? "var(--accent-thread)" : "var(--text-secondary)", fontWeight: 500 }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.principals.map((p) => (
            <tr key={p} data-access-row={p}>
              <td style={{ position: "sticky", left: 0, background: "var(--bg-node)", padding: "2px 8px", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{p}</td>
              {cols.map((c) => { const v = cellText(p, c.zones); return (
                <td key={c.key} style={{ padding: "2px 8px", textAlign: "center", whiteSpace: "nowrap", borderTop: "1px solid var(--border-edge)", color: v.includes("W") ? "var(--accent-io-write)" : "var(--text-secondary)" }}>{v}</td>
              ); })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}
