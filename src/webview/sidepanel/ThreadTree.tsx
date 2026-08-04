// M8.3.2 — Threads tab inside the side panel (PLAN-v2.md §1.4).
//
// Hierarchical list grouped by entry-point kind. Each thread is a
// collapsible row showing its filesReached underneath. Click a thread
// → loads it via vg-load-thread (same path the launchpad uses).
// Click a file row → vg-zoom-to-file (existing event).

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Terminal,
  FlaskConical,
  Code2,
  Pin,
  Network,
  FileCode,
} from "lucide-react";
import type { EntryPoint, ProjectThread } from "../types";

const KIND_ICON: Record<EntryPoint["kind"], React.ComponentType<any>> = {
  route: Globe,
  model: Network,
  cli: Terminal,
  test: FlaskConical,
  public_api: Code2,
  manual: Pin,
};

const KIND_LABEL: Record<EntryPoint["kind"], string> = {
  route: "Routes",
  model: "Models",
  cli: "CLI",
  test: "Tests",
  public_api: "Public API",
  manual: "Manual",
};

interface RowProps {
  entry: EntryPoint;
  thread: ProjectThread | undefined;
  active: boolean;
  onSelect: (entry: EntryPoint) => void;
  onSelectFile: (filePath: string) => void;
}

function ThreadRow({ entry, thread, active, onSelect, onSelectFile }: RowProps) {
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICON[entry.kind];
  const filesReached = thread?.filesReached ?? [];
  const Caret = open ? ChevronDown : ChevronRight;
  return (
    <div data-thread-tree-row data-entry-id={entry.id}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "16px 16px 1fr",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderRadius: 4,
          cursor: "pointer",
          background: active ? "var(--bg-node-hover)" : "transparent",
          fontSize: "var(--fs-13)",
        }}
        onMouseEnter={(e) => {
          if (!active) e.currentTarget.style.background = "var(--bg-node)";
        }}
        onMouseLeave={(e) => {
          if (!active) e.currentTarget.style.background = "transparent";
        }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          aria-label={open ? "collapse" : "expand"}
          style={{
            background: "none", border: "none", padding: 0,
            cursor: "pointer", display: "flex", alignItems: "center",
            color: "var(--text-muted)",
          }}
        >
          {filesReached.length > 1 ? <Caret size={14} strokeWidth={1.5} /> : null}
        </button>
        <Icon size={16} strokeWidth={1.5} color="var(--text-secondary)" />
        <button
          type="button"
          onClick={() => onSelect(entry)}
          style={{
            background: "none", border: "none", padding: 0,
            cursor: "pointer", textAlign: "left",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-13)",
            color: active ? "var(--accent-thread)" : "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {entry.label}
        </button>
      </div>
      {open && filesReached.length > 0 && (
        <div style={{ paddingLeft: 38, display: "flex", flexDirection: "column" }}>
          {filesReached.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onSelectFile(f)}
              data-thread-tree-file={f}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "3px 8px", borderRadius: 4,
                background: "transparent", border: "none",
                cursor: "pointer", textAlign: "left",
                fontSize: "var(--fs-12)", color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-node)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <FileCode size={12} strokeWidth={1.5} />
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ThreadTreeProps {
  entryPoints: EntryPoint[];
  threads: ProjectThread[];
  activeEntryPointId: string | null;
  onSelectEntry: (entry: EntryPoint) => void;
  onSelectFile: (filePath: string) => void;
}

export function ThreadTree({ entryPoints, threads, activeEntryPointId, onSelectEntry, onSelectFile }: ThreadTreeProps) {
  const grouped = React.useMemo(() => {
    const order: EntryPoint["kind"][] = ["route", "model", "cli", "test", "public_api", "manual"];
    return order
      .map((k) => ({ kind: k, items: entryPoints.filter((e) => e.kind === k) }))
      .filter((g) => g.items.length > 0);
  }, [entryPoints]);

  if (entryPoints.length === 0) {
    return (
      <div style={{ padding: 16, fontSize: "var(--fs-12)", color: "var(--text-muted)" }}>
        No entry points detected.
      </div>
    );
  }

  return (
    <div data-thread-tree style={{ padding: "8px 4px", display: "flex", flexDirection: "column", gap: 8 }}>
      {grouped.map((g) => (
        <div key={g.kind}>
          <div style={{
            padding: "4px 8px",
            fontSize: "var(--fs-11)",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}>
            {KIND_LABEL[g.kind]}
          </div>
          {g.items.map((entry) => (
            <ThreadRow
              key={entry.id}
              entry={entry}
              thread={threads.find((t) => t.entryPointId === entry.id)}
              active={entry.id === activeEntryPointId}
              onSelect={onSelectEntry}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
