import { useEffect, useRef, useState } from "react";
import type { Node } from "@xyflow/react";

// Diff-based enter/exit motion for React Flow nodes.
//
// - New node IDs → className `vg-node-enter` for one render cycle (the CSS
//   keyframe runs and detaches; we don't re-apply on subsequent re-renders).
// - Removed node IDs → ghost records pushed onto an exit list, auto-removed
//   after 160ms via setTimeout. App.tsx renders ghosts in a sibling overlay
//   layer — not inside ReactFlow's tree, since RF drops nodes synchronously.

const EXIT_MS = 160;

export type ExitGhost = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function useNodeMotion(nodes: Node[]): {
  decoratedNodes: Node[];
  exitGhosts: ExitGhost[];
} {
  const prevNodesRef = useRef<Node[]>([]);
  const enteredOnceRef = useRef<Set<string>>(new Set());
  const [exitGhosts, setExitGhosts] = useState<ExitGhost[]>([]);

  useEffect(() => {
    const prev = prevNodesRef.current;
    const prevIds = new Set(prev.map((n) => n.id));
    const currentIds = new Set(nodes.map((n) => n.id));

    // Removed: prev minus current → ghosts.
    const removed = prev.filter((n) => !currentIds.has(n.id));
    if (removed.length > 0) {
      const ghosts: ExitGhost[] = removed.map((n) => ({
        id: `${n.id}-${Date.now()}`,
        x: n.position.x,
        y: n.position.y,
        width: (n.style?.width as number) ?? 240,
        height: (n.style?.height as number) ?? 80,
      }));
      setExitGhosts((prev) => [...prev, ...ghosts]);
      const ids = ghosts.map((g) => g.id);
      setTimeout(() => {
        setExitGhosts((prev) => prev.filter((g) => !ids.includes(g.id)));
      }, EXIT_MS);
    }

    // Added: clear from "entered once" if reused later.
    for (const n of nodes) {
      if (!prevIds.has(n.id)) enteredOnceRef.current.add(n.id);
    }
    // Drop entries no longer in graph so re-add re-animates.
    for (const id of Array.from(enteredOnceRef.current)) {
      if (!currentIds.has(id)) enteredOnceRef.current.delete(id);
    }

    prevNodesRef.current = nodes;
  }, [nodes]);

  // Apply enter className to nodes the first time they appear. Subsequent
  // renders keep the class (cheap; the CSS animation has `both` fill so the
  // node stays at its final state — the keyframe doesn't re-run on renders).
  const decoratedNodes: Node[] = nodes.map((n) => {
    if (enteredOnceRef.current.has(n.id)) {
      const existing = (n.className ?? "").split(" ").filter(Boolean);
      if (!existing.includes("vg-node-enter")) {
        existing.push("vg-node-enter");
      }
      return { ...n, className: existing.join(" ") };
    }
    return n;
  });

  return { decoratedNodes, exitGhosts };
}
