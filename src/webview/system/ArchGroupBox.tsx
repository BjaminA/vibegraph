// M-ARCH.4 — a deployment / trust boundary on the architecture map: a
// STATED group (solid, the config accent — a person wrote it) or a PROPOSED
// one (dashed ghost — a model suggested it and nobody has ratified it; with
// no cited evidence it is fainter still and says INFERRED). Never derived:
// the code does not say which host a process runs on. Sits beneath the
// cards (zIndex 0); the box is sized by the layout, never by the proposer.

import React from "react";
import { Server, Globe, Network, ShieldCheck, Cpu, Building2, Layers } from "lucide-react";
import type { ArchGroupRecord } from "../../shared/protocol";

const KIND_ICON: Record<string, typeof Server> = {
  host: Server, region: Globe, subnet: Network, network: Network, trust: ShieldCheck,
  process: Cpu, account: Building2, zone: Layers,
};

export function ArchGroupBox({ data, selected }: { data: { group: ArchGroupRecord; trustLens?: boolean }; selected?: boolean }) {
  const g = data.group;
  const Icon = KIND_ICON[g.kind] ?? Layers;
  const proposed = g.source === "proposed";
  const inferred = proposed && !(g.evidence?.length);
  const tone = proposed ? "var(--proposed-border)" : "var(--accent-config)";
  const mix = data.trustLens ? 70 : 45;
  return (
    <div
      data-arch-group={g.id}
      data-arch-group-kind={g.kind}
      data-arch-group-source={g.source}
      data-arch-group-inferred={inferred ? "true" : "false"}
      title={proposed
        ? (inferred ? "Proposed by a model with NO cited evidence — inferred, not ratified" : `Proposed by a model, citing ${g.evidence!.join(", ")} — not ratified`)
        : "Stated in .vibegraph/architecture.json"}
      style={{
        width: "100%", height: "100%", boxSizing: "border-box",
        border: `1px ${proposed ? "dashed" : "solid"} color-mix(in oklab, ${tone} ${selected ? 90 : mix}%, transparent)`,
        borderRadius: 16,
        background: `color-mix(in oklab, ${tone} ${data.trustLens ? 8 : 4}%, transparent)`,
        opacity: inferred ? 0.6 : 1,
        pointerEvents: "all",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", overflow: "hidden",
        fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", color: tone,
      }}>
        <Icon size={16} strokeWidth={1.5} />
        {/* One line, always: a wrapped name ran under the first card (overlap audit). */}
        <span data-arch-group-label title={g.label} style={{ color: "var(--text-primary)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{g.label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--text-muted)", flexShrink: 0 }}>{g.kind}</span>
        {proposed && (
          <span data-arch-group-chip style={{
            fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: tone,
            border: `1px solid color-mix(in oklab, ${tone} 45%, transparent)`, borderRadius: 4, padding: "0 4px", flexShrink: 0, whiteSpace: "nowrap",
          }}>{inferred ? "proposed · INFERRED" : "proposed"}</span>
        )}
      </div>
    </div>
  );
}
