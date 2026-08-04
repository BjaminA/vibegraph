// M8.3.2 — thread index launchpad (PLAN-v2.md §1.3).
//
// The default full-canvas view in directory mode on first boot. Replaces
// today's "auto-load the first file" behaviour. One row per detected
// EntryPoint; click → loads that entry point's pre-extracted thread by
// dispatching vg-load-thread (no server round-trip — the envelope
// already shipped every thread).
//
// Sort order: route → cli → test → public_api → manual, alphabetical
// within each group. The discovery script (M8.2.3) already emits the
// list in this order; this component just renders it.
//
// Empty state: when no entry points were detected, prompt the user to
// right-click a function (manual seed UX is M8.3.3).

import React, { useEffect, useState } from "react";
import {
  Globe,
  Terminal,
  FlaskConical,
  Code2,
  Pin,
  Network,
  ChevronRight,
  BookDashed,
  BookText,
  Loader2,
} from "lucide-react";
import { bridge, type EntryPoint, type ProjectThread, type ThreadSkillRecord, type ExtensionMessage } from "../types";
import { skillStateOf, type SkillBadgeState } from "./SkillBadge";

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

const KIND_LABEL: Record<EntryPoint["kind"], string> = {
  route: "Route",
  model: "Model",
  cli: "CLI",
  test: "Test",
  public_api: "Public API",
  manual: "Manual",
};

function filesReachedFor(threads: ProjectThread[], entryPointId: string): number {
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
}

function IndexRow({ entry, filesReached, skillState, onSelect }: RowProps) {
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

function GroupHeader({ kind, count }: GroupHeaderProps) {
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

export interface ThreadIndexProps {
  entryPoints: EntryPoint[];
  threads: ProjectThread[];
  /** M-SKILL.3 — skill lifecycle per entryPointId, for the coverage dots. */
  threadSkills?: Record<string, ThreadSkillRecord>;
  onSelectEntry: (entry: EntryPoint) => void;
  /** Open the whole-project VibeReadme panel (omit to hide the action). */
  onOpenVibeReadme?: () => void;
  /** none | fresh | stale — mirrors the README badge's own state. */
  vibeReadmeState?: "none" | "fresh" | "stale";
}

export function ThreadIndex({ entryPoints, threads, threadSkills, onSelectEntry, onOpenVibeReadme, vibeReadmeState }: ThreadIndexProps) {
  // Group while preserving the discovery script's sort order.
  const grouped = React.useMemo(() => {
    const order: EntryPoint["kind"][] = ["route", "model", "cli", "test", "public_api", "manual"];
    return order
      .map((k) => ({ kind: k, items: entryPoints.filter((e) => e.kind === k) }))
      .filter((g) => g.items.length > 0);
  }, [entryPoints]);

  // M-SKILL.4 — coverage sweep progress (local: this launchpad started it).
  const [sweep, setSweep] = useState<
    | { phase: "idle" }
    | { phase: "running"; done: number; total: number; current: string }
    | { phase: "done"; line: string }
  >({ phase: "idle" });

  useEffect(() => {
    const handler = (msg: ExtensionMessage) => {
      if (msg.type === "skill-sweep-progress") {
        setSweep({ phase: "running", done: msg.payload.done, total: msg.payload.total, current: msg.payload.entryPointId });
      } else if (msg.type === "skill-sweep-done") {
        if (msg.payload.error) {
          setSweep({ phase: "done", line: msg.payload.error });
        } else if (msg.payload.summary) {
          const s = msg.payload.summary;
          const failedPart = s.failed.length > 0 ? `, ${s.failed.length} not grounded` : "";
          setSweep({ phase: "done", line: `${s.drafted.length} drafted${failedPart} — review drafts to ratify.` });
        }
      }
    };
    bridge.onMessage(handler);
    return () => bridge.removeListener(handler);
  }, []);

  // Threads still needing a draft (anything short of ratified-and-fresh).
  const sweepCount = entryPoints.filter((e) => skillStateOf(threadSkills?.[e.id]) !== "ratified").length;
  const startSweep = () => {
    if (sweep.phase === "running") return;
    setSweep({ phase: "running", done: 0, total: sweepCount, current: "starting…" });
    bridge.postMessage({ type: "skill-sweep-start", payload: {} });
  };

  if (entryPoints.length === 0) {
    return (
      <div
        data-thread-index
        data-empty
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: 16,
          padding: 32,
          color: "var(--text-secondary)",
          fontSize: "var(--fs-14)",
        }}
      >
        <Pin size={32} strokeWidth={1.5} color="var(--text-muted)" />
        <div style={{ textAlign: "center", maxWidth: 420, lineHeight: 1.5 }}>
          No entry points detected. Right-click any function in the diagram or
          file tree to start a thread from there.
        </div>
      </div>
    );
  }

  return (
    <div
      data-thread-index
      style={{
        height: "100%",
        overflow: "auto",
        background: "var(--bg-canvas)",
      }}
    >
      <div style={{
        maxWidth: 880,
        margin: "0 auto",
        // Clear the wrapped toolbar at narrow widths (the title sat under it).
        padding: "max(32px, calc(var(--vg-toolbar-bottom, 43px) + 8px)) 16px 64px",
      }}>
        <div style={{
          fontSize: "var(--fs-20)",
          fontWeight: 500,
          color: "var(--text-primary)",
          padding: "0 16px 8px",
        }}>
          Threads
        </div>
        <div style={{
          fontSize: "var(--fs-13)",
          color: "var(--text-secondary)",
          padding: "0 16px 16px",
        }}>
          {entryPoints.length} entry point{entryPoints.length === 1 ? "" : "s"} detected.
          Click to trace a thread from the seed.
        </div>
        {/* M-SKILL.4 — coverage sweep: quiet header action + live progress. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 16px 16px", minHeight: 28 }}>
          {sweep.phase === "running" ? (
            <span
              data-skill-sweep-progress
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-12)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
            >
              <Loader2 size={14} strokeWidth={1.5} className="vg-spin" />
              drafting {sweep.done} / {sweep.total} — {sweep.current}
            </span>
          ) : (
            <>
              {/* 2026-08-04 — the whole-project VibeReadme belongs HERE: the
                  launchpad is where you land not knowing what the project is,
                  and the chip strip that carried READMEs only exists inside a
                  thread. Chip state comes from the same readme-status the
                  badge uses. */}
              {onOpenVibeReadme && (
                <button
                  data-vibereadme-open
                  data-vibereadme-state={vibeReadmeState ?? "none"}
                  onClick={onOpenVibeReadme}
                  title="What this project is and how it is organised — written by VibeGraph from the code"
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "none",
                    border: `1px solid ${vibeReadmeState === "stale" ? "var(--accent-warning)" : "var(--border-edge)"}`,
                    borderRadius: 6, padding: "4px 12px", cursor: "pointer",
                    color: vibeReadmeState === "fresh" ? "var(--accent-thread)" : "var(--text-secondary)",
                    fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)",
                  }}
                >
                  <BookText size={14} strokeWidth={1.5} />
                  {vibeReadmeState === "fresh" ? "VibeReadme"
                    : vibeReadmeState === "stale" ? "VibeReadme · stale"
                    : "VibeReadme"}
                </button>
              )}
              {sweepCount > 0 && (
                <button
                  data-skill-sweep
                  onClick={startSweep}
                  title="One drafting agent per thread — this can take a while. Every result stays a draft until you ratify it."
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "none", border: "1px solid var(--border-edge)", borderRadius: 6,
                    padding: "4px 12px", cursor: "pointer",
                    color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)",
                  }}
                >
                  <BookDashed size={14} strokeWidth={1.5} />
                  Draft missing skills ({sweepCount})
                </button>
              )}
              {sweep.phase === "done" && (
                <span data-skill-sweep-summary style={{ fontSize: "var(--fs-12)", color: "var(--text-muted)" }}>
                  {sweep.line}
                </span>
              )}
            </>
          )}
        </div>
        {grouped.map((g) => (
          <div key={g.kind}>
            <GroupHeader kind={g.kind} count={g.items.length} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {g.items.map((entry) => (
                <IndexRow
                  key={entry.id}
                  entry={entry}
                  filesReached={filesReachedFor(threads, entry.id)}
                  skillState={skillStateOf(threadSkills?.[entry.id])}
                  onSelect={onSelectEntry}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
