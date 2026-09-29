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
import { Pin, ChevronRight, ChevronDown, ListTree, List, BookDashed, BookText, Loader2 } from "lucide-react";
import { bridge, type EntryPoint, type ProjectThread, type ThreadSkillRecord, type ExtensionMessage } from "../types";
import { skillStateOf } from "./SkillBadge";
import { nestThreads, type NestedRow } from "./threadNesting";
import { deriveThreadCalls } from "../system/threadInteraction";
import { IndexRow, GroupHeader, filesReachedFor } from "./ThreadIndexRow";

const LAYOUT_KEY = "vg-thread-index-layout";

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

  // Thread hierarchy (2026-09-29): nested by default — a thread sits under
  // the thread whose walk reaches its head — and the flat list one toggle
  // away. Every thread still appears exactly once either way.
  const [layout, setLayout] = useState<"nested" | "flat">(() => {
    try { return localStorage.getItem(LAYOUT_KEY) === "flat" ? "flat" : "nested"; } catch { return "nested"; }
  });
  const chooseLayout = (l: "nested" | "flat") => {
    setLayout(l);
    try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* per-viewer convenience only */ }
  };
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const epById = React.useMemo(() => new Map(entryPoints.map((e) => [e.id, e])), [entryPoints]);
  const nesting = React.useMemo(() => {
    const order = grouped.flatMap((g) => g.items.map((e) => e.id));
    const edges = deriveThreadCalls(threads, entryPoints).edges;
    return nestThreads(order, edges);
  }, [grouped, threads, entryPoints]);
  const hasNesting = nesting.some((r) => r.depth > 0);
  const nestedGroups = React.useMemo(() => {
    if (layout === "flat" || !hasNesting) {
      return grouped.map((g) => ({ kind: g.kind, rows: g.items.map((e) => ({ id: e.id, depth: 0, parent: null, callers: [], childCount: 0 } as NestedRow)) }));
    }
    const out: Array<{ kind: EntryPoint["kind"]; rows: NestedRow[] }> = [];
    for (const row of nesting) {
      const kind = row.depth === 0 ? epById.get(row.id)!.kind : out[out.length - 1].kind;
      if (row.depth === 0 && out[out.length - 1]?.kind !== kind) out.push({ kind, rows: [] });
      out[out.length - 1].rows.push(row);
    }
    return out;
  }, [layout, hasNesting, grouped, nesting, epById]);
  const parentOf = React.useMemo(() => new Map(nesting.map((r) => [r.id, r.parent])), [nesting]);
  // A row is hidden when any ancestor it is placed under is folded.
  const hiddenBy = (id: string): boolean => {
    if (layout === "flat") return false;
    for (let p = parentOf.get(id); p; p = parentOf.get(p)) if (collapsed.has(p)) return true;
    return false;
  };
  const nameOf = (id: string) => epById.get(id)?.qualifiedName ?? id;
  const nestNote = (row: NestedRow): string | null => {
    if (row.parent) {
      const more = row.callers.length - 1;
      return `sub-thread of ${nameOf(row.parent)}${more > 0 ? ` · also called from ${more} other thread${more === 1 ? "" : "s"}` : ""}`;
    }
    return row.callers.length ? `called from ${row.callers.length} thread${row.callers.length === 1 ? "" : "s"} in a cycle` : null;
  };

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
              {hasNesting && (
                <button
                  data-thread-index-layout={layout}
                  onClick={() => chooseLayout(layout === "nested" ? "flat" : "nested")}
                  title={layout === "nested"
                    ? "Threads sit under the thread whose walk reaches them — show every thread as one flat list"
                    : "Show sub-threads under the threads that call them"}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, marginLeft: "auto",
                    background: "none", border: "1px solid var(--border-edge)", borderRadius: 6,
                    padding: "4px 12px", cursor: "pointer",
                    color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)",
                  }}
                >
                  {layout === "nested" ? <List size={14} strokeWidth={1.5} /> : <ListTree size={14} strokeWidth={1.5} />}
                  {layout === "nested" ? "Flat list" : "Nest sub-threads"}
                </button>
              )}
            </>
          )}
        </div>
        {nestedGroups.map((g) => (
          <div key={g.kind}>
            <GroupHeader kind={g.kind} count={g.rows.length} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {g.rows.map((row) => {
                if (hiddenBy(row.id)) return null;
                const entry = epById.get(row.id)!;
                return (
                  <div
                    key={row.id}
                    data-thread-index-item
                    data-depth={row.depth}
                    style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: Math.min(row.depth, 4) * 24 }}
                  >
                    {layout === "nested" && (
                      row.childCount > 0 ? (
                        <button
                          type="button"
                          data-thread-index-fold={row.id}
                          aria-expanded={!collapsed.has(row.id)}
                          title={`${row.childCount} sub-thread${row.childCount === 1 ? "" : "s"} — the threads this one's walk passes through`}
                          onClick={() => setCollapsed((s) => {
                            const n = new Set(s);
                            if (n.has(row.id)) n.delete(row.id); else n.add(row.id);
                            return n;
                          })}
                          style={{ display: "flex", alignItems: "center", gap: 2, background: "none", border: "none", padding: 4, cursor: "pointer", color: "var(--text-muted)", fontSize: "var(--fs-11)", width: 32 }}
                        >
                          {collapsed.has(row.id)
                            ? <ChevronRight size={16} strokeWidth={1.5} />
                            : <ChevronDown size={16} strokeWidth={1.5} />}
                          {row.childCount}
                        </button>
                      ) : <span style={{ width: 32, flex: "none" }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <IndexRow
                        entry={entry}
                        filesReached={filesReachedFor(threads, entry.id)}
                        skillState={skillStateOf(threadSkills?.[entry.id])}
                        onSelect={onSelectEntry}
                        note={layout === "nested" ? nestNote(row) : null}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
