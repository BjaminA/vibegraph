// M8.3.2 — one row of the Threads launchpad (ThreadIndex.tsx), and the kind
// group header. Split out 2026-09-29 when the nested list grew the index.

import React from "react";
import { Globe, Terminal, FlaskConical, Code2, Pin, Network, ChevronRight } from "lucide-react";
import type { EntryPoint, ProjectThread } from "../types";
import type { SkillBadgeState } from "./SkillBadge";


// M-SKILL.3 — launchpad skill-coverage dot: one glance answers "which
// threads have ratified guidance". Same three state colours as the badge.
const DOT_COLOUR: Record<SkillBadgeState, string> = {
  none: "var(--border-edge)",
  draft: "var(--proposed-border)",
  ratified: "var(--accent-thread)",
  stale: "var(--accent-warning)",
};
const DOT_TITLE: Record<SkillBadgeState, string> = {
  none: "No thread skill",
  draft: "Thread skill drafted — awaiting ratification",
  ratified: "Thread skill ratified",
  stale: "Thread skill stale — re-draft to refresh",
};

const KIND_ICON: Record<EntryPoint["kind"], React.ComponentType<any>> = {
  route: Globe,
  model: Network,
  cli: Terminal,
  test: FlaskConical,
  public_api: Code2,
  manual: Pin,
};

export const KIND_LABEL: Record<EntryPoint["kind"], string> = {
  route: "Route",
  model: "Model",
  cli: "CLI",
  test: "Test",
  public_api: "Public API",
  manual: "Manual",
};

export function filesReachedFor(threads: ProjectThread[], entryPointId: string): number {
  const t = threads.find((t) => t.entryPointId === entryPointId);
  return t?.filesReached?.length ?? 0;
}

function frameworkChip(framework: string | null | undefined): string | null {
  if (!framework) return null;
  // Capitalise — Inter 11px reads better with sentence-cased framework
  // names than lowercase.
  return framework[0].toUpperCase() + framework.slice(1);
}

interface RowProps {
  entry: EntryPoint;
  filesReached: number;
  skillState: SkillBadgeState;
  onSelect: (entry: EntryPoint) => void;
  /** Nested list: "sub-thread of X · also called from N". */
  note?: string | null;
}

export function IndexRow({ entry, filesReached, skillState, onSelect, note }: RowProps) {
  const Icon = KIND_ICON[entry.kind];
  const fw = frameworkChip(entry.framework);
  return (
    <button
      type="button"
      data-thread-index-row
      data-entry-id={entry.id}
      data-entry-kind={entry.kind}
      onClick={() => onSelect(entry)}
      style={{
        display: "grid",
        gridTemplateColumns: "20px 1fr auto auto auto auto",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "12px 16px",
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "left",
        color: "var(--text-primary)",
        transition: "background-color var(--motion-hover-dur, 120ms) var(--easing-standard, cubic-bezier(0.2,0,0,1)), border-color 120ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-node-hover)";
        e.currentTarget.style.borderColor = "var(--border-edge)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      <Icon size={20} strokeWidth={1.5} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-13)",
          color: "var(--text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {entry.qualifiedName}
        </div>
        {/* M-FS6 — the row a user picks a route BY shows the route:
            "POST /expenses", not just the handler's function name. The
            IR has carried this metadata since M8.2; only the thread
            seed's badge surfaced it. */}
        {entry.kind === "route" && typeof entry.metadata?.route === "string" && (
          <div
            data-entry-route
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-12)",
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {typeof entry.metadata?.method === "string" ? `${entry.metadata.method} ` : ""}
            {entry.metadata.route}
          </div>
        )}
        {entry.summary && (
          <div style={{
            fontSize: "var(--fs-12)",
            color: "var(--text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {entry.summary}
          </div>
        )}
        {note && (
          <div data-thread-index-note style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
            {note}
          </div>
        )}
      </div>
      {fw && (
        <span style={{
          fontSize: "var(--fs-11)",
          color: "var(--text-muted)",
          padding: "2px 6px",
          border: "1px solid var(--border-edge)",
          borderRadius: 4,
          whiteSpace: "nowrap",
        }}>
          {fw}
        </span>
      )}
      <span style={{
        fontSize: "var(--fs-11)",
        color: "var(--text-muted)",
        whiteSpace: "nowrap",
      }}>
        {filesReached === 0 ? "—" : `${filesReached} file${filesReached === 1 ? "" : "s"}`}
      </span>
      <span
        data-skill-state={skillState}
        title={DOT_TITLE[skillState]}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: DOT_COLOUR[skillState],
          justifySelf: "center",
        }}
      />
      <ChevronRight size={16} strokeWidth={1.5} color="var(--text-muted)" />
    </button>
  );
}

interface GroupHeaderProps {
  kind: EntryPoint["kind"];
  count: number;
}

export function GroupHeader({ kind, count }: GroupHeaderProps) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "16px 16px 8px",
      fontSize: "var(--fs-11)",
      color: "var(--text-muted)",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
    }}>
      <span>{KIND_LABEL[kind]}</span>
      <span style={{ opacity: 0.6 }}>{count}</span>
    </div>
  );
}
