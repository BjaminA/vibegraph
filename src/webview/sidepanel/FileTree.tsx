// M8.3.2 — Files tab inside the side panel (PLAN-v2.md §1.4).
//
// Flat-with-folders listing of every .py file in the project. Click →
// vg-zoom-to-file (existing event used by the diagram view). The
// active file is highlighted; selection is purely local to this tree.

import React from "react";
import { FileCode, Folder, AlertTriangle, History } from "lucide-react";

/** 2026-09-28 — what the export knows about a file, shown in the tree
 *  (envelope `insight` + each file's IR): nothing reaches it, it was only
 *  partly parsed, it changed since the knowledge export. */
export interface FileStatus { unreached?: boolean; dropped?: number; changed?: boolean }

interface FileNode {
  type: "file";
  name: string;
  path: string;
}
interface FolderNode {
  type: "folder";
  name: string;
  children: TreeNode[];
}
type TreeNode = FileNode | FolderNode;

function buildTree(filePaths: string[]): TreeNode[] {
  // Group by directory. Single flat dir → no folder wrappers; nested
  // → standard tree. The render layout (flat-with-folders) folds
  // single-child chains so the user doesn't see "src > main >
  // module > file.py" wasted indentation — each segment is its own
  // visual layer.
  const root: { [key: string]: any } = { __children: [] };
  for (const fp of filePaths.slice().sort()) {
    const parts = fp.split("/");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      cur[seg] = cur[seg] ?? { __children: [] };
      cur = cur[seg];
    }
    cur.__children.push({ type: "file", name: parts[parts.length - 1], path: fp });
  }
  function walk(node: any): TreeNode[] {
    const out: TreeNode[] = [];
    for (const key of Object.keys(node)) {
      if (key === "__children") continue;
      out.push({ type: "folder", name: key, children: walk(node[key]) });
    }
    out.push(...node.__children);
    return out;
  }
  return walk(root);
}

interface RowProps {
  node: TreeNode;
  depth: number;
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  status?: Record<string, FileStatus>;
}

function TreeRow({ node, depth, activeFilePath, onSelectFile, status }: RowProps) {
  if (node.type === "folder") {
    return (
      <>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: `3px 8px 3px ${8 + depth * 12}px`,
          fontSize: "var(--fs-12)",
          color: "var(--text-muted)",
          textTransform: "none",
        }}>
          <Folder size={12} strokeWidth={1.5} />
          {node.name}
        </div>
        {node.children.map((c, i) => (
          <TreeRow key={c.type === "file" ? c.path : `${node.name}/${i}`}
            node={c} depth={depth + 1}
            activeFilePath={activeFilePath} onSelectFile={onSelectFile} status={status} />
        ))}
      </>
    );
  }
  const active = node.path === activeFilePath;
  const st = status?.[node.path];
  const why = [
    st?.unreached ? "no entry point reaches anything in this file (reachability.md)" : null,
    st?.dropped ? `only partly parsed: ${st.dropped} construct(s) dropped — read the source before trusting it` : null,
    st?.changed ? "changed since the knowledge export — its contracts describe the old file" : null,
  ].filter(Boolean).join("\n");
  return (
    <button
      type="button"
      data-file-tree-row={node.path}
      data-file-unreached={st?.unreached ? "true" : undefined}
      data-file-partial={st?.dropped ? "true" : undefined}
      data-file-changed={st?.changed ? "true" : undefined}
      title={why || undefined}
      onClick={() => onSelectFile(node.path)}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: `3px 8px 3px ${8 + depth * 12}px`,
        background: active ? "var(--bg-node-hover)" : "transparent",
        border: "none",
        cursor: "pointer", textAlign: "left", width: "100%",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        color: active ? "var(--accent-thread)" : "var(--text-primary)",
        opacity: st?.unreached && !active ? 0.55 : 1,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--bg-node)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <FileCode size={12} strokeWidth={1.5} color="var(--text-secondary)" />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>
      {st?.dropped ? <AlertTriangle size={12} strokeWidth={1.5} color="var(--accent-warning)" aria-label="partly parsed" /> : null}
      {st?.changed ? <History size={12} strokeWidth={1.5} color="var(--text-secondary)" aria-label="changed since export" /> : null}
    </button>
  );
}

export interface FileTreeProps {
  filePaths: string[];
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  status?: Record<string, FileStatus>;
}

export function FileTree({ filePaths, activeFilePath, onSelectFile, status }: FileTreeProps) {
  const tree = React.useMemo(() => buildTree(filePaths), [filePaths]);
  if (filePaths.length === 0) {
    return (
      <div style={{ padding: 16, fontSize: "var(--fs-12)", color: "var(--text-muted)" }}>
        No Python files in this project.
      </div>
    );
  }
  return (
    <div data-file-tree style={{ padding: "8px 0", display: "flex", flexDirection: "column" }}>
      {status && Object.keys(status).length > 0 && (
        <div data-file-tree-legend style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "0 8px 8px", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
          <span style={{ opacity: 0.55 }}>dim = nothing reaches</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} strokeWidth={1.5} color="var(--accent-warning)" />partly parsed</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><History size={12} strokeWidth={1.5} />changed since export</span>
        </div>
      )}
      {tree.map((n, i) => (
        <TreeRow key={n.type === "file" ? n.path : `root/${i}`}
          node={n} depth={0}
          activeFilePath={activeFilePath} onSelectFile={onSelectFile} status={status} />
      ))}
    </div>
  );
}
