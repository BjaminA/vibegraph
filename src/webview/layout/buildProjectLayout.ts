import type { Node } from "@xyflow/react";
import type { AstNode, ProjectFileData } from "../types";

// Browser-safe basename — avoids pulling in node:path for the webview.
function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

// Stage-5 project view: each file becomes a single ModuleNode laid out in a
// 4-wide grid. Click-through to the file view is handled via the
// "vg-zoom-to-file" custom event dispatched from ModuleNode.
export function buildProjectLayout(files: Record<string, ProjectFileData>): Node[] {
  return Object.entries(files).map(([filePath, data], i) => ({
    id: `module::${filePath}`,
    type: "moduleNode" as const,
    position: { x: 80 + (i % 4) * 360, y: 60 + Math.floor(i / 4) * 180 },
    data: {
      filePath,
      fileName: basename(filePath),
      functionCount: data.nodes.filter((n: AstNode) => n.type === "function_def").length,
      classCount: data.nodes.filter((n: AstNode) => n.type === "class_def").length,
      nodeCount: data.nodes.length,
    },
    style: { width: 300, height: 100 },
    draggable: true,
  }));
}

export { basename };
