// M8.3.2 — left-side panel with `Threads | Files` toggle (PLAN-v2.md §1.4).
//
// Always visible in directory mode. Persists tab choice to
// localStorage (`vg.sidepanel.tab`). Default Threads on first boot.
// Fixed 280px wide; consumers (App.tsx) leave room for it on the
// canvas side.

import React, { useEffect, useState } from "react";
import { ThreadTree } from "./ThreadTree";
import { FileTree } from "./FileTree";
import type { EntryPoint, ProjectThread } from "../types";

const STORAGE_KEY = "vg.sidepanel.tab";
type Tab = "threads" | "files";

function readStoredTab(): Tab {
  if (typeof localStorage === "undefined") return "threads";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "files" ? "files" : "threads";
  } catch {
    return "threads";
  }
}

function writeStoredTab(tab: Tab): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, tab); } catch { /* ignore */ }
}

export interface SidePanelProps {
  entryPoints: EntryPoint[];
  threads: ProjectThread[];
  filePaths: string[];
  activeFilePath: string | null;
  activeEntryPointId: string | null;
  onSelectEntry: (entry: EntryPoint) => void;
  onSelectFile: (filePath: string) => void;
}

export function SidePanel(props: SidePanelProps) {
  const [tab, setTab] = useState<Tab>(() => readStoredTab());
  useEffect(() => { writeStoredTab(tab); }, [tab]);

  return (
    <div
      data-side-panel
      data-active-tab={tab}
      style={{
        position: "fixed",
        top: 0,
        bottom: 0,
        left: 0,
        width: 280,
        background: "var(--bg-canvas)",
        borderRight: "1px solid var(--border-edge)",
        display: "flex",
        flexDirection: "column",
        zIndex: 600,
      }}
    >
      <div style={{
        padding: 12,
        borderBottom: "1px solid var(--border-edge)",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 4,
      }}>
        {(["threads", "files"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            data-side-panel-tab={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 10px",
              borderRadius: 4,
              border: "1px solid",
              borderColor: tab === t ? "var(--border-edge)" : "transparent",
              background: tab === t ? "var(--bg-node-hover)" : "transparent",
              color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: "var(--fs-13)",
              textTransform: "capitalize",
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "threads" ? (
          <ThreadTree
            entryPoints={props.entryPoints}
            threads={props.threads}
            activeEntryPointId={props.activeEntryPointId}
            onSelectEntry={props.onSelectEntry}
            onSelectFile={props.onSelectFile}
          />
        ) : (
          <FileTree
            filePaths={props.filePaths}
            activeFilePath={props.activeFilePath}
            onSelectFile={props.onSelectFile}
          />
        )}
      </div>
    </div>
  );
}
