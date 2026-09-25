// Keep the EXPORTED architecture documents in step with a decision made in
// the GUI (2026-09-25). Ratifying a proposal rewrote `.vibegraph/
// architecture.json` and the live map — and left `.vibegraph/knowledge/
// architecture.md`, the page a plain Claude reads, saying "no group is
// stated" until someone re-ran the export. The documents an agent reads must
// not lag the decision a person just made.
//
// Rewrites only the architecture files an earlier export or `architecture`
// command ALREADY wrote (no folder is created, no file is added), from the
// server's live model. The header says it came from the live server, with no
// commit: the facts are the current parse, which may be ahead of the commit
// the export recorded. `architecture.archify.json` is not rewritten — it
// needs the git provenance only the CLI resolves — and the return value
// names it when it is left behind.

import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ArchModelRecord, EntryPoint, SystemTier } from "../shared/protocol.ts";
import type { ThreadGraph } from "../webview/system/threadInteraction.ts";
import { buildSystemMap } from "./system_map.ts";
import { renderSystemMapMd } from "./system_map_md.ts";
import { renderArchHtml } from "./arch_html.ts";

export const ARCH_EXPORT_DIRS = [join(".vibegraph", "knowledge"), join(".vibegraph", "architecture-map")];

export interface ArchRefreshResult { written: string[]; stale: string[] }

export function refreshExportedArchitecture(
  root: string,
  model: ArchModelRecord,
  ctx: { entryPoints: EntryPoint[]; system: SystemTier | null; threadGraph: ThreadGraph | null; tool: string },
): ArchRefreshResult {
  const written: string[] = [];
  const stale: string[] = [];
  const title = basename(root);
  let map: ReturnType<typeof buildSystemMap> | null = null;
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  for (const rel of ARCH_EXPORT_DIRS) {
    const dir = join(root, rel);
    if (!existsSync(join(dir, "architecture.md")) && !existsSync(join(dir, "architecture.vibegraph.json"))) continue;
    map ??= buildSystemMap(model, { title, commit: null, tool: ctx.tool, entryPoints: ctx.entryPoints, system: ctx.system, threadGraph: ctx.threadGraph });
    const files: Array<[string, () => string]> = [
      ["architecture.md", () => renderSystemMapMd(map!)],
      ["architecture.vibegraph.json", () => json(map)],
      ["architecture.html", () => renderArchHtml(model, { title, tool: ctx.tool })],
      ["architecture.json", () => json(model)],
    ];
    for (const [name, render] of files) {
      const p = join(dir, name);
      if (!existsSync(p)) continue;
      writeFileSync(p, render());
      written.push(join(rel, name));
    }
    if (existsSync(join(dir, "architecture.archify.json"))) stale.push(join(rel, "architecture.archify.json"));
  }
  return { written, stale };
}
