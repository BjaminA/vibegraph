// Where clicking a chip goes (2026-10-05, GUI brief M2): every Chip asks
// through one `vg-focus` event, and this decides by the chip's kind.
//   a file, JSON, XML or schema   → the file's view (a folder → its first file)
//   a function                    → the file that defines it
//   a process / thread            → its real thread (`at`, else the id)
//   a zone / store / identity     → its card on the map's Resources lens
//   a rule                        → the Rules panel, on that rule
//   a question                    → the Plan panel
//   a module / library            → the Stack panel
// A chip whose object is nowhere in the project does nothing, quietly — it
// still says what it is on hover.

import { useEffect } from "react";
import { FOCUS_EVENT, type FocusRequest } from "./Chip";

export interface FocusHandlers {
  files: () => string[];
  /** IR nodes by file, to find a function's file */
  functionFile: (name: string) => string | null;
  entryPointIds: () => string[];
  selectFile: (file: string) => void;
  openThread: (entryPointId: string) => void;
  focusMap: (archId: string) => void;
  openRule: (id: string) => void;
  openSheet: (id: "plan" | "stack") => void;
}

export function useFocusRouter(h: FocusHandlers): void {
  useEffect(() => {
    const on = (e: Event) => {
      const r = (e as CustomEvent<FocusRequest & { at?: string }>).detail;
      if (!r) return;
      const target = r.at ?? r.id;
      switch (r.kind) {
        case "path": case "json": case "xml": case "type": {
          const files = h.files();
          const f = files.includes(target) ? target : files.find((x) => x.startsWith(target.endsWith("/") ? target : `${target}/`));
          if (f) h.selectFile(f);
          return;
        }
        case "function": { const f = h.functionFile(target); if (f) h.selectFile(f); return; }
        case "process": if (h.entryPointIds().includes(target)) h.openThread(target); return;
        case "zone": h.focusMap(`topo:zone:${target.split("/").pop()}`); return;
        case "store": h.focusMap(`topo:store:${target}`); return;
        case "identity": h.focusMap(`topo:pr:${target}`); return;
        case "rule": h.openRule(target); return;
        case "question": h.openSheet("plan"); return;
        case "module": h.openSheet("stack"); return;
      }
    };
    window.addEventListener(FOCUS_EVENT, on);
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, [h]);
}
