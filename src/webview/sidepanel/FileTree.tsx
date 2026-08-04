// M8.3.2 — Files tab inside the side panel (PLAN-v2.md §1.4).
//
// Flat-with-folders listing of every .py file in the project. Click →
// vg-zoom-to-file (existing event used by the diagram view). The
// active file is highlighted; selection is purely local to this tree.

import React from "react";
import { FileCode, Folder } from "lucide-react";

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
}

function TreeRow({ node, depth, activeFilePath, onSelectFile }: RowProps) {
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
            activeFilePath={activeFilePath} onSelectFile={onSelectFile} />
        ))}
      </>
    );
  }
  const active = node.path === activeFilePath;
  return (
    <button
      type="button"
      data-file-tree-row={node.path}
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
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--bg-node)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <FileCode size={12} strokeWidth={1.5} color="var(--text-secondary)" />
      {node.name}
    </button>
  );
}

export interface FileTreeProps {
  filePaths: string[];
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
}

export function FileTree({ filePaths, activeFilePath, onSelectFile }: FileTreeProps) {
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
      {tree.map((n, i) => (
        <TreeRow key={n.type === "file" ? n.path : `root/${i}`}
          node={n} depth={0}
          activeFilePath={activeFilePath} onSelectFile={onSelectFile} />
      ))}
    </div>
  );
}
