// The file view's CODE mode, wired: a per-viewer toggle (remembered in
// localStorage), the file's source fetched through the existing
// get-file-source message, and the canvas's nodes / edges swapped for the
// code blocks of code_layout.ts. Kept out of App.tsx, which is over its size
// budget already.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { bridge, type AstNode } from "../types";
import { applyFilters } from "./filters";
import type { NodeFilters } from "../FiltersPanel";
import { buildCodeLayout, CODE_CHAR_W, type LineMeasure } from "./code_layout";
import { languageForPath } from "../../shared/languages";

const KEY = "vg-file-view-mode";

// Each line's painted width in the editor font at 12px, measured by a canvas
// once the fonts have loaded: a block is sized to hold its longest line whole,
// so the width must come from what the browser paints — including full-width
// and fallback-font glyphs a character count gets wrong — not from a constant.
function useLineMeasure(): LineMeasure {
  const [m, setM] = useState<LineMeasure>(CODE_CHAR_W);
  useEffect(() => {
    let live = true;
    const make = () => {
      try {
        const family = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace";
        const ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) return;
        ctx.font = `12px ${family}`;
        const cache = new Map<string, number>();
        if (live) setM(() => (line: string) => {
          let w = cache.get(line);
          if (w === undefined) { w = ctx.measureText(line).width; cache.set(line, w); }
          return w;
        });
      } catch { /* keep the fallback */ }
    };
    make();
    document.fonts?.ready.then(make).catch(() => {});
    return () => { live = false; };
  }, []);
  return m;
}

export function useFileCodeMode(): [boolean, () => void] {
  const [on, setOn] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === "code"; } catch { return false; }
  });
  const toggle = useCallback(() => setOn((m) => {
    const next = !m;
    try { localStorage.setItem(KEY, next ? "code" : "cards"); } catch { /* per-viewer convenience only */ }
    return next;
  }), []);
  return [on, toggle];
}

export function useFileCodeView(args: {
  enabled: boolean;
  activeFilePath: string | null;
  fileSource: string | null;
  astNodes: AstNode[];
  hiddenNodeIds: Set<string>;
  nodeFilters: NodeFilters;
  /** the card layout's nodes: a new array after every (re)parse */
  cardNodes: Node[];
  /** every edge (reference edges drive the call-flow layout) */
  edges: Edge[];
  /** the edges the card view would draw (after the family toggles) */
  displayedEdges: Edge[];
}): { nodes: Node[]; edges: Edge[] } | null {
  const { enabled, activeFilePath, fileSource, astNodes, hiddenNodeIds, nodeFilters, cardNodes, edges, displayedEdges } = args;
  const measure = useLineMeasure();

  // The source: asked for when code mode opens, the file changes, or the
  // file re-parses (an edit changes the text as well as the IR).
  useEffect(() => {
    if (!enabled || !activeFilePath) return;
    bridge.postMessage({ type: "get-file-source", payload: { filePath: activeFilePath } });
  }, [enabled, activeFilePath, cardNodes]);

  const layout = useMemo(() => {
    if (!enabled || !fileSource || !activeFilePath || !astNodes.length) return null;
    const refEdges = edges
      .filter((e) => (e.data as { kind?: string } | undefined)?.kind === "reference")
      .map((e) => ({ source: e.source, target: e.target }));
    const language = languageForPath(activeFilePath)?.monacoLanguage ?? "plaintext";
    return buildCodeLayout(applyFilters(astNodes, hiddenNodeIds, nodeFilters), refEdges, fileSource, language, measure);
    // cardNodes: the trigger that astNodes (a ref) changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fileSource, activeFilePath, cardNodes, hiddenNodeIds, nodeFilters, edges, measure]);

  return useMemo(() => {
    if (!layout) return null;
    const mapped = displayedEdges.map(layout.mapEdge).filter((e): e is Edge => !!e);
    return { nodes: layout.nodes, edges: mapped };
  }, [layout, displayedEdges]);
}
