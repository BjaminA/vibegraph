import { useEffect } from "react";
import { bridge, type AstNode, type ProjectFileData, type ExtensionMessage } from "../types";

export interface SelectionBusActions {
  astNodesRef: React.MutableRefObject<AstNode[]>;
  // M18.1 — in directory / thread mode astNodesRef is only populated for
  // the file that's been zoomed into the diagram. A same-file thread
  // click (e.g. the seed, where activeFilePath already matches and no
  // zoom fires) would miss. Resolve from the project IR first, mirroring
  // useEventBus's chatAboutHandler, so the selection lands regardless.
  projectDataRef: React.MutableRefObject<Record<string, ProjectFileData>>;
  setChatContextNode: React.Dispatch<React.SetStateAction<AstNode | null>>;
}

// M5 wave 3 / M7 wave 1 — bridge the document-level vg-selection custom event
// channel (code / diagram / thread surfaces) with the WS layer (MCP set_selection
// broadcasts in; every local emit goes out so a subscribed Claude Code session
// sees the resource update). source="external" marks emits that came back in
// from the server, so they don't bounce.
export function useSelectionBus(
  actions: SelectionBusActions,
  deps: { activeFilePath: string | null },
): void {
  const { astNodesRef, projectDataRef, setChatContextNode } = actions;
  const { activeFilePath } = deps;

  // Local emit → cross-file zoom → set chat context → forward to server.
  useEffect(() => {
    const handler = (e: Event) => {
      const { filePath, irNodeId, source } = (e as CustomEvent<{
        filePath: string; irNodeId: string;
        source: "code" | "diagram" | "thread" | "system" | "external";
      }>).detail;
      if (filePath && filePath !== activeFilePath) {
        document.dispatchEvent(new CustomEvent("vg-zoom-to-file", {
          detail: { filePath },
        }));
      }
      let astNode: AstNode | null = null;
      if (filePath && projectDataRef.current) {
        astNode = projectDataRef.current[filePath]?.nodes.find((n) => n.id === irNodeId) ?? null;
      }
      if (!astNode) {
        astNode = astNodesRef.current.find((n) => n.id === irNodeId) ?? null;
      }
      if (astNode) setChatContextNode(astNode);
      if (source !== "external") {
        bridge.postMessage({
          type: "selection-changed",
          payload: { irNodeId, filePath },
        });
      }
    };
    document.addEventListener("vg-selection", handler);
    return () => document.removeEventListener("vg-selection", handler);
  }, [activeFilePath, astNodesRef, setChatContextNode]);

  // MCP set_selection (server-side) → vg-selection event with source="external".
  useEffect(() => {
    const handler = (msg: ExtensionMessage) => {
      if (msg.type !== "set-selection") return;
      document.dispatchEvent(new CustomEvent("vg-selection", {
        detail: {
          filePath: msg.payload.filePath ?? activeFilePath,
          irNodeId: msg.payload.nodeId,
          source: "external",
        },
      }));
    };
    bridge.onMessage(handler);
    return () => bridge.removeListener(handler);
  }, [activeFilePath]);
}
